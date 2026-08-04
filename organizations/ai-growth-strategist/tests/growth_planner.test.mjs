import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { createGrowthPlan } from '../scripts/growth_planner.mjs';
import { step } from './helpers.mjs';

test('createGrowthPlan creates the baseline execution order', () => {
  const result = createGrowthPlan({
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [
      step('intake'),
      step('evidence', ['intake']),
      step('analyze', ['evidence']),
    ],
  });

  assert.deepEqual(result.executionOrder, [
    'intake',
    'evidence',
    'analyze',
  ]);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion',
    'runId',
    'capabilityId',
    'steps',
    'executionOrder',
  ]);
});

test('createGrowthPlan rejects dependency cycles', () => {
  assert.throws(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps: [
        step('step-a', ['step-b']),
        step('step-b', ['step-a']),
      ],
    }),
    /cycle/iu,
  );
});

test('createGrowthPlan rejects duplicate step identifiers', () => {
  assert.throws(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps: [
        step('step-a'),
        step('step-a'),
      ],
    }),
    /duplicate|unique/iu,
  );
});

test('createGrowthPlan rejects unknown dependencies', () => {
  assert.throws(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps: [
        step('step-a', ['step-unknown']),
      ],
    }),
    /dependency|unknown/iu,
  );
});

test('createGrowthPlan uses stable input order throughout a complex DAG', () => {
  const input = {
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [
      step('step-final', ['step-left', 'step-right']),
      step('step-root-b'),
      step('step-left', ['step-root-a']),
      step('step-root-a'),
      step('step-right', ['step-root-b']),
    ],
  };

  const first = createGrowthPlan(input);
  const second = createGrowthPlan(input);

  assert.deepEqual(first.executionOrder, [
    'step-root-b',
    'step-root-a',
    'step-left',
    'step-right',
    'step-final',
  ]);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});

test('createGrowthPlan preserves caller order for multiple root steps', () => {
  const result = createGrowthPlan({
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [
      step('step-root-c'),
      step('step-root-a'),
      step('step-root-b'),
    ],
  });

  assert.deepEqual(result.executionOrder, [
    'step-root-c',
    'step-root-a',
    'step-root-b',
  ]);
});

test('createGrowthPlan rejects top-level getters without invoking any field', () => {
  const getterCalls = {
    runId: 0,
    capabilityId: 0,
    steps: 0,
  };
  const values = {
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [step('step-a')],
  };
  const input = {};

  for (const field of Object.keys(values)) {
    Object.defineProperty(input, field, {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls[field] += 1;
        throw new Error(`SENTINEL_TOP_LEVEL_GETTER_${field}`);
      },
    });
  }

  const error = captureError(() => createGrowthPlan(input));
  assert.match(error.message, /accessor|data property/iu);
  assert.doesNotMatch(error.message, /SENTINEL/iu);
  assert.deepEqual(getterCalls, {
    runId: 0,
    capabilityId: 0,
    steps: 0,
  });
});

test('createGrowthPlan requires exact top-level own data fields', () => {
  const missing = {
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
  };
  const unexpected = {
    ...missing,
    steps: [step('step-a')],
    extra: true,
  };
  const symbolKey = {
    ...missing,
    steps: [step('step-a')],
    [Symbol('extra')]: true,
  };

  assert.throws(() => createGrowthPlan(missing), /missing|required|steps/iu);
  assert.throws(() => createGrowthPlan(unexpected), /unexpected|field/iu);
  assert.throws(() => createGrowthPlan(symbolKey), /unexpected|symbol|field/iu);
});

test('createGrowthPlan rejects every Proxy layer before invoking a trap', () => {
  const topLevelProbe = proxyTrapProbe({
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [step('step-a')],
  });
  assertProxyRejected(
    () => createGrowthPlan(topLevelProbe.proxy),
    topLevelProbe,
  );

  const stepsProbe = proxyTrapProbe([step('step-a')]);
  assertProxyRejected(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps: stepsProbe.proxy,
    }),
    stepsProbe,
  );

  const stepProbe = proxyTrapProbe(step('step-a'));
  assertProxyRejected(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps: [stepProbe.proxy],
    }),
    stepProbe,
  );

  const dependsOnProbe = proxyTrapProbe([]);
  assertProxyRejected(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps: [{
        ...step('step-a'),
        dependsOn: dependsOnProbe.proxy,
      }],
    }),
    dependsOnProbe,
  );
});

test('createGrowthPlan does not modify caller input', () => {
  const input = {
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [
      step('step-a'),
      step('step-b', ['step-a']),
    ],
  };
  const before = structuredClone(input);

  const result = createGrowthPlan(input);

  assert.deepEqual(input, before);
  assert.notEqual(result.steps, input.steps);
  assert.notEqual(result.steps[0], input.steps[0]);
  assert.notEqual(result.steps[1].dependsOn, input.steps[1].dependsOn);
});

test('createGrowthPlan returns a deeply frozen canonical copy', () => {
  const result = createGrowthPlan({
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [
      step('step-a'),
      step('step-b', ['step-a']),
    ],
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.steps), true);
  assert.equal(Object.isFrozen(result.steps[0]), true);
  assert.equal(Object.isFrozen(result.steps[1].dependsOn), true);
  assert.equal(Object.isFrozen(result.executionOrder), true);
  assert.throws(() => {
    result.executionOrder.push('step-c');
  }, TypeError);
  assert.throws(() => {
    result.steps[0].stepId = 'step-changed';
  }, TypeError);
});

test('createGrowthPlan rejects empty, sparse and accessor-index step arrays', () => {
  const sparse = new Array(1);
  const accessorIndex = [step('step-a')];
  let getterCalls = 0;
  Object.defineProperty(accessorIndex, '0', {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('SENTINEL_ARRAY_ELEMENT_GETTER');
    },
  });

  for (const steps of [[], sparse]) {
    assert.throws(
      () => createGrowthPlan({
        runId: 'run-001',
        capabilityId: 'growth-opportunity-analysis',
        steps,
      }),
      /array|data property|dense|empty|non-empty|sparse/iu,
    );
  }

  const error = captureError(() => createGrowthPlan({
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: accessorIndex,
  }));
  assert.match(error.message, /data property/iu);
  assert.doesNotMatch(error.message, /SENTINEL/iu);
  assert.equal(getterCalls, 0);
});

test('createGrowthPlan rejects step arrays with a nonstandard prototype', () => {
  const steps = [step('step-a')];
  Object.setPrototypeOf(steps, null);

  assert.throws(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps,
    }),
    /prototype/iu,
  );
});

test('createGrowthPlan rejects overwritten array methods without calling them', () => {
  const methodNames = ['map', 'forEach'];
  for (const methodName of methodNames) {
    const steps = [step('step-a')];
    Object.defineProperty(steps, methodName, {
      configurable: true,
      enumerable: false,
      value() {
        throw new Error(`${methodName} must not run`);
      },
    });
    assert.throws(
      () => createGrowthPlan({
        runId: 'run-001',
        capabilityId: 'growth-opportunity-analysis',
        steps,
      }),
      /own property|override|unexpected/iu,
    );
  }

  const steps = [step('step-a')];
  Object.defineProperty(steps, Symbol.iterator, {
    configurable: true,
    value() {
      throw new Error('iterator must not run');
    },
  });
  assert.throws(
    () => createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps,
    }),
    /own property|override|unexpected/iu,
  );
});

test('createGrowthPlan delegates malicious step getter rejection to validateStep', () => {
  const malicious = step('step-a');
  let getterCalls = 0;
  Object.defineProperty(malicious, 'stepId', {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('SENTINEL_STEP_GETTER');
    },
  });

  const error = captureError(() => createGrowthPlan({
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [malicious],
  }));
  assert.match(error.message, /accessor|data property/iu);
  assert.doesNotMatch(error.message, /SENTINEL/iu);
  assert.equal(getterCalls, 0);
});

test(
  'createGrowthPlan handles a large reverse-ordered DAG within the complexity budget',
  { timeout: 10_000 },
  () => {
    const size = 12_000;
    const steps = [];
    for (let index = size; index >= 1; index -= 1) {
      const stepId = largeStepId(index);
      const dependsOn = index === 1
        ? []
        : [largeStepId(index - 1)];
      steps.push(step(stepId, dependsOn));
    }

    const startedAt = performance.now();
    const result = createGrowthPlan({
      runId: 'run-001',
      capabilityId: 'growth-opportunity-analysis',
      steps,
    });
    const elapsedMs = performance.now() - startedAt;

    assert.equal(result.executionOrder.length, size);
    assert.equal(result.executionOrder[0], largeStepId(1));
    assert.equal(result.executionOrder.at(-1), largeStepId(size));
    assert.ok(
      elapsedMs < 1_500,
      `large DAG planning exceeded 1500ms: ${elapsedMs.toFixed(1)}ms`,
    );
  },
);

function captureError(callback) {
  let captured;
  try {
    callback();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error, 'expected callback to throw an Error');
  return captured;
}

function proxyTrapProbe(target) {
  let trapCalls = 0;
  const fail = (trapName) => {
    trapCalls += 1;
    throw new Error(`SENTINEL_PROXY_TRAP_${trapName}`);
  };
  const handler = {
    get: () => fail('get'),
    set: () => fail('set'),
    has: () => fail('has'),
    ownKeys: () => fail('ownKeys'),
    getPrototypeOf: () => fail('getPrototypeOf'),
    setPrototypeOf: () => fail('setPrototypeOf'),
    isExtensible: () => fail('isExtensible'),
    preventExtensions: () => fail('preventExtensions'),
    getOwnPropertyDescriptor: () => fail('getOwnPropertyDescriptor'),
    defineProperty: () => fail('defineProperty'),
    deleteProperty: () => fail('deleteProperty'),
  };

  return {
    proxy: new Proxy(target, handler),
    trapCalls: () => trapCalls,
  };
}

function assertProxyRejected(callback, probe) {
  const error = captureError(callback);
  assert.match(error.message, /proxy/iu);
  assert.doesNotMatch(error.message, /SENTINEL/iu);
  assert.equal(probe.trapCalls(), 0);
}

function largeStepId(index) {
  return `step-${String(index).padStart(5, '0')}`;
}
