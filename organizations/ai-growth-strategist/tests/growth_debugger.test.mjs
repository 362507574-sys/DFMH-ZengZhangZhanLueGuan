import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAILURE_POLICIES,
  classifyGrowthFailure,
  createGrowthFailureDecision,
} from '../scripts/growth_debugger.mjs';

const POLICY_CASES = Object.freeze([
  ['input_missing', false, 0],
  ['evidence_invalid', false, 0],
  ['evidence_conflict', false, 0],
  ['planning_dependency_failed', false, 0],
  ['tool_timeout', true, 2],
  ['tool_schema_changed', true, 2],
  ['contract_failed', true, 3],
  ['boundary_violation', false, 0],
  ['metric_anomaly', false, 0],
  ['experiment_contaminated', false, 0],
  ['cost_limit_reached', false, 0],
]);

function timeline() {
  return [
    {
      sequence: 1,
      from: null,
      to: 'intake',
      at: '2026-07-29T10:00:00.000Z',
    },
    {
      sequence: 2,
      from: 'intake',
      to: 'planning',
      at: '2026-07-29T10:01:00.000Z',
    },
    {
      sequence: 3,
      from: 'planning',
      to: 'ready',
      at: '2026-07-29T10:02:00.000Z',
    },
    {
      sequence: 4,
      from: 'ready',
      to: 'running_internal',
      at: '2026-07-29T10:03:00.000Z',
    },
  ];
}

function failure(overrides = {}) {
  return {
    code: 'ETIMEDOUT',
    message: 'growth analysis tool timed out',
    rootCauseId: 'root-cause-001',
    rootCauseOccurrences: 1,
    timeline: timeline(),
    ...overrides,
  };
}

function proxyTrapProbe(target, sentinel) {
  let trapCalls = 0;
  const fail = (name) => {
    trapCalls += 1;
    throw new Error(`${sentinel}_${name}`);
  };
  return {
    proxy: new Proxy(target, {
      get: () => fail('get'),
      set: () => fail('set'),
      has: () => fail('has'),
      ownKeys: () => fail('ownKeys'),
      getPrototypeOf: () => fail('getPrototypeOf'),
      getOwnPropertyDescriptor: () => fail('getOwnPropertyDescriptor'),
    }),
    trapCalls: () => trapCalls,
  };
}

function assertProxyRejected(callback, probe) {
  assert.throws(callback, (error) => {
    assert.match(error.message, /proxy/iu);
    assert.doesNotMatch(error.message, /SENTINEL/iu);
    return true;
  });
  assert.equal(probe.trapCalls(), 0);
}

test('failure policies expose exactly eleven deeply immutable policy records', () => {
  assert.deepEqual(Object.keys(FAILURE_POLICIES), POLICY_CASES.map(([code]) => code));
  assert.equal(Object.isFrozen(FAILURE_POLICIES), true);
  for (const [category, retryable, maximumAttempts] of POLICY_CASES) {
    assert.deepEqual(FAILURE_POLICIES[category], {
      retryable,
      maximumAttempts,
    });
    assert.equal(Object.isFrozen(FAILURE_POLICIES[category]), true);
    assert.throws(() => {
      FAILURE_POLICIES[category].retryable = !retryable;
    }, TypeError);
  }
  assert.throws(() => {
    FAILURE_POLICIES.unknown = { retryable: true, maximumAttempts: 99 };
  }, TypeError);
});

test('planned ETIMEDOUT classification returns the exact independent frozen result', () => {
  const first = classifyGrowthFailure({ code: 'ETIMEDOUT' });
  const second = classifyGrowthFailure({ code: 'ETIMEDOUT' });
  assert.deepEqual(first, {
    category: 'tool_timeout',
    retryable: true,
    maximumAttempts: 2,
  });
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
});

test('every exact category code and uppercase form maps to its policy', () => {
  for (const [category, retryable, maximumAttempts] of POLICY_CASES) {
    for (const code of [category, category.toUpperCase()]) {
      assert.deepEqual(classifyGrowthFailure({ code }), {
        category,
        retryable,
        maximumAttempts,
      });
    }
  }
  for (const code of ['ETIMEDOUT', 'TIMEOUT']) {
    assert.equal(classifyGrowthFailure({ code }).category, 'tool_timeout');
  }
  assert.deepEqual(classifyGrowthFailure({ code: 'BOUNDARY_VIOLATION' }), {
    category: 'boundary_violation',
    retryable: false,
    maximumAttempts: 0,
  });
});

test('unknown and inexact failure codes fail closed instead of defaulting to retry', () => {
  for (const code of [
    'UNKNOWN_FAILURE',
    'timeout',
    ' TOOL_TIMEOUT',
    'TOOL_TIMEOUT ',
    '',
    null,
    123,
  ]) {
    assert.throws(
      () => classifyGrowthFailure({ code }),
      /unsupported|code/iu,
      String(code),
    );
  }
});

test('classifier requires one exact stable own data property without executing user code', () => {
  for (const value of [
    null,
    [],
    {},
    { code: 'ETIMEDOUT', extra: true },
    Object.create({ code: 'ETIMEDOUT' }),
  ]) {
    assert.throws(() => classifyGrowthFailure(value), /plain|missing|unexpected|code/iu);
  }

  let getterCalls = 0;
  const getterInput = {};
  Object.defineProperty(getterInput, 'code', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'ETIMEDOUT';
    },
  });
  assert.throws(
    () => classifyGrowthFailure(getterInput),
    /accessor|data property/iu,
  );
  assert.equal(getterCalls, 0);

  const probe = proxyTrapProbe(
    { code: 'ETIMEDOUT' },
    'SENTINEL_CLASSIFIER_PROXY',
  );
  assertProxyRejected(() => classifyGrowthFailure(probe.proxy), probe);
});

test('same retryable root cause retries only before the third occurrence', () => {
  for (const rootCauseOccurrences of [1, 2]) {
    assert.equal(
      createGrowthFailureDecision(failure({ rootCauseOccurrences })).nextState,
      'retrying',
    );
  }
  for (const rootCauseOccurrences of [3, 4]) {
    assert.equal(
      createGrowthFailureDecision(failure({ rootCauseOccurrences })).nextState,
      'failed',
    );
  }
});

test('contract failure also becomes failed on its third occurrence', () => {
  for (const rootCauseOccurrences of [1, 2]) {
    assert.equal(
      createGrowthFailureDecision(failure({
        code: 'CONTRACT_FAILED',
        rootCauseOccurrences,
      })).nextState,
      'retrying',
    );
  }
  assert.equal(
    createGrowthFailureDecision(failure({
      code: 'CONTRACT_FAILED',
      rootCauseOccurrences: 3,
    })).nextState,
    'failed',
  );
});

test('non-retryable categories map to their explicit terminal or paused states', () => {
  const cases = [
    ['INPUT_MISSING', 'missing_input'],
    ['EVIDENCE_INVALID', 'evidence_conflict'],
    ['EVIDENCE_CONFLICT', 'evidence_conflict'],
    ['PLANNING_DEPENDENCY_FAILED', 'failed'],
    ['BOUNDARY_VIOLATION', 'boundary_blocked'],
    ['METRIC_ANOMALY', 'paused'],
    ['EXPERIMENT_CONTAMINATED', 'paused'],
    ['COST_LIMIT_REACHED', 'cost_stopped'],
  ];
  for (const [code, nextState] of cases) {
    const decision = createGrowthFailureDecision(failure({ code }));
    assert.equal(decision.retryable, false, code);
    assert.equal(decision.maximumAttempts, 0, code);
    assert.equal(decision.nextState, nextState, code);
  }
});

test('decision preserves last error and full timeline in a deeply frozen independent copy', () => {
  const source = failure({
    code: 'TOOL_SCHEMA_CHANGED',
    message: 'schema field was removed',
    rootCauseId: 'schema-change-001',
    rootCauseOccurrences: 2,
  });
  const expectedTimeline = timeline();
  const result = createGrowthFailureDecision(source);

  assert.deepEqual(result, {
    schemaVersion: 1,
    category: 'tool_schema_changed',
    retryable: true,
    maximumAttempts: 2,
    nextState: 'retrying',
    lastError: {
      code: 'TOOL_SCHEMA_CHANGED',
      message: 'schema field was removed',
      rootCauseId: 'schema-change-001',
      rootCauseOccurrences: 2,
    },
    timeline: expectedTimeline,
  });
  assert.notEqual(result.timeline, source.timeline);
  assert.notEqual(result.timeline[0], source.timeline[0]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.lastError), true);
  assert.equal(Object.isFrozen(result.timeline), true);
  assert.equal(result.timeline.every((item) => Object.isFrozen(item)), true);
  assert.throws(() => {
    result.lastError.message = 'changed';
  }, TypeError);
  assert.throws(() => {
    result.timeline[0].to = 'failed';
  }, TypeError);

  source.timeline[0].to = 'failed';
  source.message = 'source changed';
  assert.equal(result.timeline[0].to, 'intake');
  assert.equal(result.lastError.message, 'schema field was removed');
});

test('decision requires exact stable fields and bounded scalar values', () => {
  for (const value of [
    null,
    [],
    { ...failure(), extra: true },
    (() => {
      const value = failure();
      delete value.message;
      return value;
    })(),
  ]) {
    assert.throws(
      () => createGrowthFailureDecision(value),
      /plain|unexpected|missing|required/iu,
    );
  }
  for (const message of ['', '   ', 'x'.repeat(4_001), null]) {
    assert.throws(
      () => createGrowthFailureDecision(failure({ message })),
      /message|required|size|4000/iu,
    );
  }
  for (const rootCauseId of ['', 'UPPERCASE', '../unsafe', 'a']) {
    assert.throws(
      () => createGrowthFailureDecision(failure({ rootCauseId })),
      /rootCauseId|unsafe|invalid/iu,
    );
  }
  for (const rootCauseOccurrences of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createGrowthFailureDecision(failure({ rootCauseOccurrences })),
      /rootCauseOccurrences|positive|integer/iu,
    );
  }
});

test('decision rejects malformed, oversized and accessor-backed timelines', () => {
  const sparse = new Array(2);
  sparse[0] = timeline()[0];
  const abnormalPrototype = timeline();
  Object.setPrototypeOf(abnormalPrototype, Object.create(Array.prototype));
  const extraProperty = timeline();
  extraProperty.extra = true;
  const oversized = Array.from({ length: 10_001 }, (_, index) => ({
    sequence: index + 1,
    from: index === 0 ? null : 'intake',
    to: 'intake',
    at: '2026-07-29T10:00:00.000Z',
  }));

  for (const invalidTimeline of [
    null,
    [],
    sparse,
    abnormalPrototype,
    extraProperty,
    oversized,
  ]) {
    assert.throws(
      () => createGrowthFailureDecision(failure({ timeline: invalidTimeline })),
      /timeline|array|dense|property|size|non-empty/iu,
    );
  }

  let indexGetterCalls = 0;
  const getterTimeline = [timeline()[0]];
  Object.defineProperty(getterTimeline, '0', {
    enumerable: true,
    get() {
      indexGetterCalls += 1;
      return timeline()[0];
    },
  });
  assert.throws(
    () => createGrowthFailureDecision(failure({ timeline: getterTimeline })),
    /timeline|data property|accessor/iu,
  );
  assert.equal(indexGetterCalls, 0);
});

test('decision validates every event field, sequence, state, transition and time', () => {
  const first = timeline()[0];
  const cases = [
    [{ ...first, extra: true }, /unexpected|field/iu],
    [{ ...first, sequence: 2 }, /sequence/iu],
    [{ ...first, from: 'planning' }, /first|from|transition/iu],
    [{ ...first, to: 'unknown' }, /state/iu],
    [{ ...first, at: '2026-07-29T10:00:00Z' }, /ISO|timestamp|canonical/iu],
  ];
  for (const [event, pattern] of cases) {
    assert.throws(
      () => createGrowthFailureDecision(failure({ timeline: [event] })),
      pattern,
    );
  }

  const invalidTransition = timeline().slice(0, 2);
  invalidTransition[1] = {
    ...invalidTransition[1],
    to: 'completed',
  };
  assert.throws(
    () => createGrowthFailureDecision(failure({ timeline: invalidTransition })),
    /transition/iu,
  );

  const brokenChain = timeline().slice(0, 3);
  brokenChain[2] = {
    ...brokenChain[2],
    from: 'intake',
  };
  assert.throws(
    () => createGrowthFailureDecision(failure({ timeline: brokenChain })),
    /chain|from/iu,
  );

  const decreasingTime = timeline().slice(0, 2);
  decreasingTime[1] = {
    ...decreasingTime[1],
    at: '2026-07-29T09:59:59.000Z',
  };
  assert.throws(
    () => createGrowthFailureDecision(failure({ timeline: decreasingTime })),
    /time|non-decreasing/iu,
  );
});

test('decision and nested event getters or Proxies are rejected without execution', () => {
  let decisionGetterCalls = 0;
  const getterDecision = failure();
  Object.defineProperty(getterDecision, 'message', {
    enumerable: true,
    get() {
      decisionGetterCalls += 1;
      return 'must not run';
    },
  });
  assert.throws(
    () => createGrowthFailureDecision(getterDecision),
    /accessor|data property/iu,
  );
  assert.equal(decisionGetterCalls, 0);

  let eventGetterCalls = 0;
  const getterEvent = timeline()[0];
  Object.defineProperty(getterEvent, 'to', {
    enumerable: true,
    get() {
      eventGetterCalls += 1;
      return 'intake';
    },
  });
  assert.throws(
    () => createGrowthFailureDecision(failure({ timeline: [getterEvent] })),
    /accessor|data property/iu,
  );
  assert.equal(eventGetterCalls, 0);

  const decisionProbe = proxyTrapProbe(
    failure(),
    'SENTINEL_DECISION_PROXY',
  );
  assertProxyRejected(
    () => createGrowthFailureDecision(decisionProbe.proxy),
    decisionProbe,
  );

  const timelineProbe = proxyTrapProbe(
    timeline(),
    'SENTINEL_TIMELINE_PROXY',
  );
  assertProxyRejected(
    () => createGrowthFailureDecision(failure({ timeline: timelineProbe.proxy })),
    timelineProbe,
  );

  const eventProbe = proxyTrapProbe(
    timeline()[0],
    'SENTINEL_EVENT_PROXY',
  );
  assertProxyRejected(
    () => createGrowthFailureDecision(failure({ timeline: [eventProbe.proxy] })),
    eventProbe,
  );
});

test('classification and decisions ignore Set and Map prototype pollution', () => {
  const setHas = Object.getOwnPropertyDescriptor(Set.prototype, 'has');
  const mapGet = Object.getOwnPropertyDescriptor(Map.prototype, 'get');
  let captured;
  let classification;
  let decision;
  try {
    Object.defineProperty(Set.prototype, 'has', {
      ...setHas,
      value() {
        throw new Error('SENTINEL_SET_PROTOTYPE_HAS');
      },
    });
    Object.defineProperty(Map.prototype, 'get', {
      ...mapGet,
      value() {
        throw new Error('SENTINEL_MAP_PROTOTYPE_GET');
      },
    });
    classification = classifyGrowthFailure({ code: 'ETIMEDOUT' });
    decision = createGrowthFailureDecision(failure());
  } catch (error) {
    captured = error;
  } finally {
    Object.defineProperty(Set.prototype, 'has', setHas);
    Object.defineProperty(Map.prototype, 'get', mapGet);
  }
  assert.ifError(captured);
  assert.equal(classification.category, 'tool_timeout');
  assert.equal(decision.nextState, 'retrying');
});
