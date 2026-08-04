import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUN_STATES,
  canTransition,
  validateGrowthPlan,
  validateGrowthRun,
  validateStep,
} from '../scripts/growth_run_contract.mjs';
import { step, validRun } from './helpers.mjs';

const NORMAL = [
  'intake',
  'planning',
  'ready',
  'running_internal',
  'awaiting_approval',
  'running_approved',
  'reviewing',
  'completed',
];
const EXCEPTIONAL = [
  'retrying',
  'missing_input',
  'evidence_conflict',
  'boundary_blocked',
  'cost_stopped',
  'paused',
  'failed',
];
const ALL_STATES = [...NORMAL, ...EXCEPTIONAL];
const LEGAL_TRANSITIONS = new Map([
  ['intake', ['planning', 'missing_input', 'failed']],
  ['planning', ['ready', 'missing_input', 'evidence_conflict', 'failed']],
  ['ready', ['running_internal', 'paused']],
  [
    'running_internal',
    ['awaiting_approval', 'reviewing', 'retrying', 'boundary_blocked'],
  ],
  [
    'awaiting_approval',
    ['running_approved', 'paused', 'boundary_blocked'],
  ],
  ['running_approved', ['reviewing', 'retrying', 'cost_stopped']],
  ['reviewing', ['completed', 'planning', 'failed']],
  ['retrying', ['running_internal', 'running_approved', 'failed']],
]);

function validPlan() {
  return {
    schemaVersion: 1,
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    steps: [
      step('collect-input'),
      step('build-candidate', ['collect-input']),
      step('review-candidate', ['build-candidate']),
    ],
    executionOrder: [
      'collect-input',
      'build-candidate',
      'review-candidate',
    ],
  };
}

function changingGetter(source, field, firstValue, laterValue) {
  let reads = 0;
  const result = { ...source };
  Object.defineProperty(result, field, {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? firstValue : laterValue;
    },
  });
  return result;
}

function withAbnormalArrayPrototype(items) {
  const result = [...items];
  Object.setPrototypeOf(result, Object.create(Array.prototype));
  return result;
}

test('run states preserve the exact ordered normal and exceptional groups', () => {
  assert.deepEqual([...RUN_STATES.normal], NORMAL);
  assert.deepEqual([...RUN_STATES.exceptional], EXCEPTIONAL);
  assert.equal(Object.isFrozen(RUN_STATES), true);
  assert.equal(Object.isFrozen(RUN_STATES.normal), true);
  assert.equal(Object.isFrozen(RUN_STATES.exceptional), true);
});

test('planned approval transitions return the specified true and false results', () => {
  assert.equal(canTransition('running_internal', 'awaiting_approval'), true);
  assert.equal(canTransition('awaiting_approval', 'running_approved'), true);
  assert.equal(canTransition('awaiting_approval', 'completed'), false);
});

test('canTransition accepts every legal edge and rejects every other state pair', () => {
  for (const from of ALL_STATES) {
    const legalTargets = new Set(LEGAL_TRANSITIONS.get(from) ?? []);
    for (const to of ALL_STATES) {
      assert.equal(
        canTransition(from, to),
        legalTargets.has(to),
        `${from} -> ${to}`,
      );
    }
  }

  for (const unknown of ['', 'unknown', undefined, null]) {
    assert.equal(canTransition(unknown, 'planning'), false);
    assert.equal(canTransition('intake', unknown), false);
  }
});

test('validateGrowthRun returns an independent frozen canonical run', () => {
  const source = validRun();
  const result = validateGrowthRun(source);

  assert.deepEqual(result, source);
  assert.notEqual(result, source);
  assert.equal(Object.isFrozen(result), true);
  source.state = 'failed';
  assert.equal(result.state, 'intake');
});

test('validateGrowthRun rejects missing and unexpected fields', () => {
  const missing = validRun();
  delete missing.capabilityId;

  assert.throws(() => validateGrowthRun(missing), /missing|required|capabilityId/u);
  assert.throws(
    () => validateGrowthRun({ ...validRun(), unexpected: true }),
    /unexpected|field/u,
  );
});

test('validateGrowthRun rejects schema, identifier, state and sequence violations', () => {
  for (const value of [
    { ...validRun(), schemaVersion: 2 },
    { ...validRun(), enterpriseId: '../enterprise' },
    { ...validRun(), businessProjectId: '../project' },
    { ...validRun(), taskId: '../task' },
    { ...validRun(), runId: 'x' },
    { ...validRun(), capabilityId: 'NOT_SAFE' },
    { ...validRun(), state: 'unknown' },
    { ...validRun(), sequence: 0 },
    { ...validRun(), sequence: 1.5 },
    { ...validRun(), sequence: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => validateGrowthRun(value));
  }
});

test('validateGrowthRun requires canonical ordered ISO timestamps', () => {
  for (const value of [
    { ...validRun(), createdAt: 'not-a-date' },
    { ...validRun(), createdAt: '2026-07-29T00:00:00Z' },
    { ...validRun(), updatedAt: '2026-07-29T00:00:00+00:00' },
    {
      ...validRun(),
      createdAt: '2026-07-29T00:00:01.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
  ]) {
    assert.throws(() => validateGrowthRun(value), /createdAt|updatedAt|time|ISO/u);
  }
});

test('validateGrowthRun enforces only supplied expected identity fields', () => {
  const expectedIdentity = {
    enterpriseId: validRun().enterpriseId,
    businessProjectId: validRun().businessProjectId,
    runId: validRun().runId,
  };

  assert.deepEqual(validateGrowthRun(validRun(), expectedIdentity), validRun());
  assert.throws(
    () => validateGrowthRun(
      { ...validRun(), enterpriseId: 'other' },
      expectedIdentity,
    ),
    /identity/u,
  );
  assert.throws(
    () => validateGrowthRun(validRun(), { runId: 'run-999' }),
    /identity/u,
  );
  assert.throws(
    () => validateGrowthRun(validRun(), { taskId: validRun().taskId }),
    /identity|unexpected|field/u,
  );
});

test('validateGrowthRun rejects expected identity accessors without invoking them', () => {
  let getterReads = 0;
  const expectedIdentity = {};
  Object.defineProperty(expectedIdentity, 'enterpriseId', {
    enumerable: true,
    get() {
      getterReads += 1;
      return validRun().enterpriseId;
    },
  });

  assert.throws(
    () => validateGrowthRun(validRun(), expectedIdentity),
    /accessor|data property/u,
  );
  assert.equal(getterReads, 0);
});

test('expected identity getters cannot mutate the validated run to bypass identity checks', () => {
  const source = validRun();
  const originalEnterpriseId = source.enterpriseId;
  const expectedIdentity = {};
  Object.defineProperty(expectedIdentity, 'enterpriseId', {
    enumerable: true,
    get() {
      source.enterpriseId = 'other';
      return 'other';
    },
  });

  assert.throws(
    () => validateGrowthRun(source, expectedIdentity),
    /accessor|data property|identity/u,
  );
  assert.equal(source.enterpriseId, originalEnterpriseId);
});

test('validateStep returns an independent deeply frozen canonical step', () => {
  const source = step('build-candidate', ['collect-input']);
  const result = validateStep(source);

  assert.deepEqual(result, source);
  assert.notEqual(result, source);
  assert.notEqual(result.dependsOn, source.dependsOn);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.dependsOn), true);
  source.dependsOn.push('later');
  assert.deepEqual(result.dependsOn, ['collect-input']);
});

test('validateStep rejects field, retry, timeout, dependency and approval violations', () => {
  const missing = step('build-candidate');
  delete missing.timeoutMs;
  const cases = [
    missing,
    { ...step('build-candidate'), extra: true },
    { ...step('x') },
    { ...step('build-candidate'), maximumAttempts: 0 },
    { ...step('build-candidate'), maximumAttempts: 4 },
    { ...step('build-candidate'), maximumAttempts: 1.5 },
    { ...step('build-candidate'), timeoutMs: 0 },
    { ...step('build-candidate'), timeoutMs: 900001 },
    { ...step('build-candidate'), timeoutMs: 1.5 },
    { ...step('build-candidate'), dependsOn: 'collect-input' },
    {
      ...step('build-candidate'),
      dependsOn: ['collect-input', 'collect-input'],
    },
    { ...step('build-candidate'), dependsOn: ['build-candidate'] },
    { ...step('build-candidate'), dependsOn: ['../unsafe'] },
    { ...step('build-candidate'), requiresApproval: 1 },
  ];

  for (const value of cases) assert.throws(() => validateStep(value));
});

test('validateGrowthPlan returns a deeply frozen canonical plan', () => {
  const source = validPlan();
  const result = validateGrowthPlan(source);

  assert.deepEqual(result, source);
  assert.notEqual(result, source);
  assert.notEqual(result.steps, source.steps);
  assert.notEqual(result.executionOrder, source.executionOrder);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.steps), true);
  assert.equal(Object.isFrozen(result.executionOrder), true);
  assert.ok(result.steps.every((item) => (
    Object.isFrozen(item) && Object.isFrozen(item.dependsOn)
  )));
  source.steps[0].stepId = 'changed';
  assert.equal(result.steps[0].stepId, 'collect-input');
});

test('validateGrowthPlan rejects field, schema, identifier and empty-step violations', () => {
  const missing = validPlan();
  delete missing.runId;
  const cases = [
    missing,
    { ...validPlan(), extra: true },
    { ...validPlan(), schemaVersion: 2 },
    { ...validPlan(), runId: '../run' },
    { ...validPlan(), capabilityId: 'INVALID' },
    { ...validPlan(), steps: [] },
  ];

  for (const value of cases) assert.throws(() => validateGrowthPlan(value));
});

test('validateGrowthPlan rejects duplicate step and execution identifiers', () => {
  const duplicateStep = validPlan();
  duplicateStep.steps[1] = step('collect-input');
  const duplicateOrder = validPlan();
  duplicateOrder.executionOrder[1] = 'collect-input';

  assert.throws(() => validateGrowthPlan(duplicateStep), /duplicate|unique/u);
  assert.throws(() => validateGrowthPlan(duplicateOrder), /duplicate|unique/u);
});

test('validateGrowthPlan requires execution order to exactly match all steps', () => {
  const unknown = validPlan();
  unknown.executionOrder[2] = 'unknown-step';
  const tooShort = validPlan();
  tooShort.executionOrder.pop();
  const tooLong = validPlan();
  tooLong.executionOrder.push('extra-step');

  for (const value of [unknown, tooShort, tooLong]) {
    assert.throws(() => validateGrowthPlan(value), /executionOrder|step|match|length/u);
  }
});

test('validateGrowthPlan rejects unknown and out-of-order dependencies', () => {
  const unknown = validPlan();
  unknown.steps[1] = step('build-candidate', ['unknown-step']);
  const outOfOrder = validPlan();
  outOfOrder.executionOrder = [
    'build-candidate',
    'collect-input',
    'review-candidate',
  ];

  assert.throws(() => validateGrowthPlan(unknown), /dependency|dependsOn|unknown/u);
  assert.throws(() => validateGrowthPlan(outOfOrder), /dependency|before|order/u);
});

test('validateStep rejects single-hole and mixed sparse dependency arrays', () => {
  const singleHole = step('build-candidate');
  singleHole.dependsOn = new Array(1);
  const mixedSparse = step('build-candidate');
  mixedSparse.dependsOn = ['collect-input', , 'review-input'];

  for (const value of [singleHole, mixedSparse]) {
    assert.throws(() => validateStep(value), /dense|hole|sparse/u);
  }
});

test('validators ignore overwritten input map methods and still validate elements', () => {
  const dependencyBypass = step('build-candidate', ['../unsafe']);
  dependencyBypass.dependsOn.map = () => [];

  const invalidStep = step('../unsafe');
  const stepBypass = {
    ...validPlan(),
    steps: [invalidStep],
    executionOrder: [],
  };
  stepBypass.steps.map = () => [];

  const orderBypass = validPlan();
  orderBypass.executionOrder[0] = '../unsafe';
  orderBypass.executionOrder.map = () => [
    'collect-input',
    'build-candidate',
    'review-candidate',
  ];

  assert.throws(() => validateStep(dependencyBypass), /invalid|unsafe/u);
  assert.throws(() => validateGrowthPlan(stepBypass), /invalid|unsafe/u);
  assert.throws(() => validateGrowthPlan(orderBypass), /invalid|unsafe/u);
});

test('validators reject arrays with nonstandard prototypes', () => {
  const dependencyPrototype = step('build-candidate');
  dependencyPrototype.dependsOn = withAbnormalArrayPrototype(['collect-input']);

  const stepPrototype = validPlan();
  stepPrototype.steps = withAbnormalArrayPrototype(stepPrototype.steps);

  const orderPrototype = validPlan();
  orderPrototype.executionOrder = withAbnormalArrayPrototype(
    orderPrototype.executionOrder,
  );

  assert.throws(() => validateStep(dependencyPrototype), /prototype/u);
  assert.throws(() => validateGrowthPlan(stepPrototype), /prototype/u);
  assert.throws(() => validateGrowthPlan(orderPrototype), /prototype/u);
});

test('validateGrowthPlan rejects sparse step arrays before reading their entries', () => {
  const singleHole = validPlan();
  singleHole.steps = new Array(1);
  singleHole.executionOrder = ['collect-input'];

  const mixedSparse = validPlan();
  mixedSparse.steps = [
    step('collect-input'),
    ,
    step('review-candidate', ['collect-input']),
  ];

  for (const value of [singleHole, mixedSparse]) {
    assert.throws(() => validateGrowthPlan(value), /dense|hole|sparse/u);
  }
});

test('validateGrowthPlan rejects sparse execution order arrays', () => {
  const singleHole = validPlan();
  singleHole.steps = [step('collect-input')];
  singleHole.executionOrder = new Array(1);

  const mixedSparse = validPlan();
  mixedSparse.executionOrder = [
    'collect-input',
    ,
    'review-candidate',
  ];

  for (const value of [singleHole, mixedSparse]) {
    assert.throws(() => validateGrowthPlan(value), /dense|hole|sparse/u);
  }
});

test('validateGrowthRun rejects changing state and sequence accessors', () => {
  for (const value of [
    changingGetter(validRun(), 'state', 'intake', 'unknown'),
    changingGetter(validRun(), 'sequence', 1, 0),
  ]) {
    assert.throws(() => validateGrowthRun(value), /accessor|data property/u);
  }
});

test('validateStep rejects changing validation-field accessors', () => {
  for (const value of [
    changingGetter(step('build-candidate'), 'maximumAttempts', 1, 0),
    changingGetter(step('build-candidate'), 'timeoutMs', 1000, 0),
    changingGetter(step('build-candidate'), 'requiresApproval', false, 'false'),
    changingGetter(step('build-candidate'), 'dependsOn', [], '../unsafe'),
  ]) {
    assert.throws(() => validateStep(value), /accessor|data property/u);
  }
});

test('validateGrowthPlan rejects changing array accessors', () => {
  const source = validPlan();
  for (const value of [
    changingGetter(source, 'steps', source.steps, '../unsafe'),
    changingGetter(
      source,
      'executionOrder',
      source.executionOrder,
      '../unsafe',
    ),
  ]) {
    assert.throws(() => validateGrowthPlan(value), /accessor|data property/u);
  }
});

test('growth run validators reject top-level Proxies before invoking traps', () => {
  const runProbe = contractProxyTrapProbe(validRun());
  assertContractProxyRejected(
    () => validateGrowthRun(runProbe.proxy),
    runProbe,
  );

  const identityProbe = contractProxyTrapProbe({
    enterpriseId: validRun().enterpriseId,
  });
  assertContractProxyRejected(
    () => validateGrowthRun(validRun(), identityProbe.proxy),
    identityProbe,
  );

  const stepProbe = contractProxyTrapProbe(step('build-candidate'));
  assertContractProxyRejected(
    () => validateStep(stepProbe.proxy),
    stepProbe,
  );

  const planProbe = contractProxyTrapProbe(validPlan());
  assertContractProxyRejected(
    () => validateGrowthPlan(planProbe.proxy),
    planProbe,
  );
});

test('growth run validators reject nested array and element Proxies without traps', () => {
  const dependenciesProbe = contractProxyTrapProbe(['collect-input']);
  assertContractProxyRejected(
    () => validateStep({
      ...step('build-candidate'),
      dependsOn: dependenciesProbe.proxy,
    }),
    dependenciesProbe,
  );

  const stepsProbe = contractProxyTrapProbe(validPlan().steps);
  assertContractProxyRejected(
    () => validateGrowthPlan({
      ...validPlan(),
      steps: stepsProbe.proxy,
    }),
    stepsProbe,
  );

  const stepProbe = contractProxyTrapProbe(step('collect-input'));
  const planWithProxyStep = validPlan();
  planWithProxyStep.steps[0] = stepProbe.proxy;
  assertContractProxyRejected(
    () => validateGrowthPlan(planWithProxyStep),
    stepProbe,
  );

  const orderProbe = contractProxyTrapProbe(validPlan().executionOrder);
  assertContractProxyRejected(
    () => validateGrowthPlan({
      ...validPlan(),
      executionOrder: orderProbe.proxy,
    }),
    orderProbe,
  );
});

function contractProxyTrapProbe(target) {
  let trapCalls = 0;
  const fail = (trapName) => {
    trapCalls += 1;
    throw new Error(`SENTINEL_CONTRACT_PROXY_TRAP_${trapName}`);
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

function assertContractProxyRejected(callback, probe) {
  let captured;
  try {
    callback();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error, 'expected Proxy input to be rejected');
  assert.match(captured.message, /proxy/iu);
  assert.doesNotMatch(captured.message, /SENTINEL/iu);
  assert.equal(probe.trapCalls(), 0);
}
