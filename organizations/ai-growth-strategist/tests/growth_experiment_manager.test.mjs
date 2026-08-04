import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXTERNAL_ACTIONS,
  createGrowthExperiment,
  evaluateGrowthExperiment,
} from '../scripts/growth_experiment_manager.mjs';

const ACTIONS = [
  'publish_content',
  'paid_media',
  'contact_customer',
  'change_price',
  'change_refund_rule',
  'brand_commitment',
  'deal_commitment',
  'write_external_system',
];

function experiment(overrides = {}) {
  return {
    id: 'experiment-001',
    hypothesis: 'diagnostic content improves voluntary signup',
    experimentObject: 'consented newsletter audience',
    control: 'current diagnostic content sequence',
    sample: 'randomized consenting newsletter recipients',
    metric: 'signup rate per delivered message',
    secondaryMetrics: ['qualified reply rate'],
    riskMetrics: ['complaint rate'],
    baseline: 0.02,
    target: 0.025,
    maximumDays: 30,
    maximumCost: 'no paid media',
    stopConditions: ['complaint rate rises'],
    dataCollectionMethod: 'consent-aware delivery and signup event aggregation',
    reviewAt: '2026-08-28T00:00:00.000Z',
    externalActions: ['publish_content'],
    ...overrides,
  };
}

function proxyTrapProbe(target) {
  let trapCalls = 0;
  const fail = (name) => {
    trapCalls += 1;
    throw new Error(`SENTINEL_EXPERIMENT_PROXY_${name}`);
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

test('external actions expose exact immutable readonly-set semantics', () => {
  assert.deepEqual([...EXTERNAL_ACTIONS], ACTIONS);
  assert.equal(EXTERNAL_ACTIONS.size, ACTIONS.length);
  assert.equal(EXTERNAL_ACTIONS.has('publish_content'), true);
  assert.equal(EXTERNAL_ACTIONS.has('internal_analysis'), false);
  assert.equal(EXTERNAL_ACTIONS.add, undefined);
  assert.equal(EXTERNAL_ACTIONS.delete, undefined);
  assert.equal(EXTERNAL_ACTIONS.clear, undefined);
  assert.equal(Object.isFrozen(EXTERNAL_ACTIONS), true);
  assert.throws(() => {
    EXTERNAL_ACTIONS.has = () => false;
  }, TypeError);
  assert.deepEqual([...EXTERNAL_ACTIONS.values()], ACTIONS);
});

test('approval classification is immune to Set prototype pollution', () => {
  const descriptors = Object.fromEntries(
    ['has', 'values', 'add'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(Set.prototype, name),
    ]),
  );
  let captured;
  let definition;
  let hasPublish;
  let values;
  let iterated;
  try {
    for (const name of ['has', 'values', 'add']) {
      Object.defineProperty(Set.prototype, name, {
        ...descriptors[name],
        value() {
          throw new Error(`SENTINEL_SET_PROTOTYPE_${name}`);
        },
      });
    }
    definition = createGrowthExperiment(experiment());
    hasPublish = EXTERNAL_ACTIONS.has('publish_content');
    values = [...EXTERNAL_ACTIONS.values()];
    iterated = [...EXTERNAL_ACTIONS];
  } catch (error) {
    captured = error;
  } finally {
    for (const name of ['has', 'values', 'add']) {
      Object.defineProperty(Set.prototype, name, descriptors[name]);
    }
  }
  assert.ifError(captured);
  assert.equal(definition.requiresApproval, true);
  assert.equal(hasPublish, true);
  assert.deepEqual(values, ACTIONS);
  assert.deepEqual(iterated, ACTIONS);
});

test('creates the planned experiment and marks approval requirements', () => {
  const definition = createGrowthExperiment(experiment());
  assert.deepEqual(Object.keys(definition), [
    'id',
    'hypothesis',
    'experimentObject',
    'control',
    'sample',
    'metric',
    'secondaryMetrics',
    'riskMetrics',
    'baseline',
    'target',
    'maximumDays',
    'maximumCost',
    'stopConditions',
    'dataCollectionMethod',
    'reviewAt',
    'externalActions',
    'requiresApproval',
  ]);
  assert.equal(definition.requiresApproval, true);
  assert.equal(createGrowthExperiment(experiment({
    externalActions: [],
  })).requiresApproval, false);
});

test('evaluates the plan example, lower targets and failed thresholds', () => {
  const definition = createGrowthExperiment(experiment());
  assert.deepEqual(evaluateGrowthExperiment({
    definition,
    observedMetric: 0.026,
    stopTriggered: false,
  }), { decision: 'success' });
  assert.deepEqual(evaluateGrowthExperiment({
    definition,
    observedMetric: 0.024,
    stopTriggered: false,
  }), { decision: 'failed' });

  const lower = createGrowthExperiment(experiment({
    baseline: 100,
    target: 80,
    externalActions: [],
  }));
  assert.deepEqual(evaluateGrowthExperiment({
    definition: lower,
    observedMetric: 79,
    stopTriggered: false,
  }), { decision: 'success' });
  assert.deepEqual(evaluateGrowthExperiment({
    definition: lower,
    observedMetric: 81,
    stopTriggered: false,
  }), { decision: 'failed' });
});

test('stop is highest priority and missing observation is inconclusive', () => {
  const definition = createGrowthExperiment(experiment());
  assert.deepEqual(evaluateGrowthExperiment({
    definition,
    observedMetric: null,
    stopTriggered: true,
  }), {
    decision: 'stopped',
    reason: 'stop condition triggered',
  });
  assert.deepEqual(evaluateGrowthExperiment({
    definition,
    observedMetric: null,
    stopTriggered: false,
  }), {
    decision: 'inconclusive',
    reason: 'observed metric is missing',
  });
});

test('requires every approved experiment field and rejects empty text', () => {
  for (const field of [
    'experimentObject',
    'control',
    'sample',
    'secondaryMetrics',
    'riskMetrics',
    'dataCollectionMethod',
    'reviewAt',
  ]) {
    const input = experiment();
    delete input[field];
    assert.throws(
      () => createGrowthExperiment(input),
      new RegExp(`${field}|missing|required`, 'iu'),
    );
  }
  for (const [field, value] of [
    ['hypothesis', ''],
    ['experimentObject', ''],
    ['control', ''],
    ['sample', ''],
    ['metric', ''],
    ['maximumCost', ''],
    ['dataCollectionMethod', ''],
  ]) {
    assert.throws(
      () => createGrowthExperiment(experiment({ [field]: value })),
      new RegExp(`${field}|required`, 'iu'),
    );
  }
});

test('rejects equal/non-finite metrics, invalid review time and day boundaries', () => {
  for (const overrides of [
    { baseline: null },
    { target: null },
    { baseline: Number.NaN },
    { target: Number.POSITIVE_INFINITY },
    { baseline: 1, target: 1 },
  ]) {
    assert.throws(
      () => createGrowthExperiment(experiment(overrides)),
      /baseline|target|finite|equal|different/iu,
    );
  }
  for (const maximumDays of [0, 366, 1.5, null]) {
    assert.throws(
      () => createGrowthExperiment(experiment({ maximumDays })),
      /maximumDays|integer|365/iu,
    );
  }
  assert.equal(createGrowthExperiment(experiment({
    maximumDays: 1,
  })).maximumDays, 1);
  assert.equal(createGrowthExperiment(experiment({
    maximumDays: 365,
  })).maximumDays, 365);
  for (const reviewAt of ['invalid', '2026-08-28T00:00:00Z']) {
    assert.throws(
      () => createGrowthExperiment(experiment({ reviewAt })),
      /reviewAt|ISO|time/iu,
    );
  }
});

test('requires dense unique non-empty metric, condition and action arrays', () => {
  for (const field of ['secondaryMetrics', 'riskMetrics']) {
    for (const value of [[], [''], ['same', 'same']]) {
      assert.throws(
        () => createGrowthExperiment(experiment({ [field]: value })),
        new RegExp(`${field}|metric|non-empty|duplicate|unique|required`, 'iu'),
      );
    }
  }
  for (const stopConditions of [
    [],
    [''],
    ['same', 'same'],
  ]) {
    assert.throws(
      () => createGrowthExperiment(experiment({ stopConditions })),
      /stopConditions|condition|non-empty|duplicate|unique|required/iu,
    );
  }
  for (const externalActions of [
    ['publish_content', 'publish_content'],
    ['send-secret-email'],
    ['../escape'],
  ]) {
    assert.throws(
      () => createGrowthExperiment(experiment({ externalActions })),
      /externalActions|action|duplicate|unsupported|invalid|unsafe/iu,
    );
  }
  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => createGrowthExperiment(experiment({ stopConditions: sparse })),
    /dense|sparse|hole/iu,
  );
});

test('rejects oversized experiment arrays before walking sparse indexes', () => {
  for (const [field, maximum] of [
    ['secondaryMetrics', 100],
    ['riskMetrics', 100],
    ['stopConditions', 100],
    ['externalActions', 32],
  ]) {
    const sparse = [];
    sparse.length = 10_000_000;
    assert.throws(
      () => createGrowthExperiment(experiment({ [field]: sparse })),
      new RegExp(`${field}|size limit|${maximum}`, 'iu'),
    );
  }
});

test('evaluation strictly validates definition and observation input', () => {
  const definition = createGrowthExperiment(experiment());
  assert.throws(
    () => evaluateGrowthExperiment({
      definition: { ...definition, requiresApproval: false },
      observedMetric: 0.026,
      stopTriggered: false,
    }),
    /requiresApproval|approval|definition/iu,
  );
  assert.throws(
    () => evaluateGrowthExperiment({
      definition,
      observedMetric: Number.NaN,
      stopTriggered: false,
    }),
    /observedMetric|finite/iu,
  );
  assert.throws(
    () => evaluateGrowthExperiment({
      definition,
      observedMetric: 0.026,
      stopTriggered: 'false',
    }),
    /stopTriggered|boolean/iu,
  );
  assert.throws(
    () => evaluateGrowthExperiment({
      definition,
      observedMetric: 0.026,
      stopTriggered: false,
      extra: true,
    }),
    /unexpected|field/iu,
  );
});

test('rejects accessors, sparse arrays and Proxies without executing user code', () => {
  let getterCalls = 0;
  const input = experiment();
  Object.defineProperty(input, 'metric', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'signup rate';
    },
  });
  assert.throws(
    () => createGrowthExperiment(input),
    /accessor|data property/iu,
  );
  assert.equal(getterCalls, 0);

  let nestedGetterCalls = 0;
  const secondaryMetrics = ['qualified reply rate'];
  Object.defineProperty(secondaryMetrics, '0', {
    enumerable: true,
    configurable: true,
    get() {
      nestedGetterCalls += 1;
      return 'qualified reply rate';
    },
  });
  assert.throws(
    () => createGrowthExperiment(experiment({ secondaryMetrics })),
    /secondaryMetrics|data property|accessor/iu,
  );
  assert.equal(nestedGetterCalls, 0);

  const experimentProbe = proxyTrapProbe(experiment());
  assertProxyRejected(
    () => createGrowthExperiment(experimentProbe.proxy),
    experimentProbe,
  );
  const metricsProbe = proxyTrapProbe(['qualified reply rate']);
  assertProxyRejected(
    () => createGrowthExperiment(experiment({
      secondaryMetrics: metricsProbe.proxy,
    })),
    metricsProbe,
  );
  const evaluationProbe = proxyTrapProbe({
    definition: createGrowthExperiment(experiment()),
    observedMetric: 0.026,
    stopTriggered: false,
  });
  assertProxyRejected(
    () => evaluateGrowthExperiment(evaluationProbe.proxy),
    evaluationProbe,
  );
});

test('returns deeply frozen independent definitions and decisions', () => {
  const input = experiment();
  const definition = createGrowthExperiment(input);
  input.stopConditions[0] = 'mutated';
  input.externalActions.length = 0;

  assert.deepEqual(definition.stopConditions, ['complaint rate rises']);
  assert.deepEqual(definition.secondaryMetrics, ['qualified reply rate']);
  assert.deepEqual(definition.riskMetrics, ['complaint rate']);
  assert.deepEqual(definition.externalActions, ['publish_content']);
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.secondaryMetrics), true);
  assert.equal(Object.isFrozen(definition.riskMetrics), true);
  assert.equal(Object.isFrozen(definition.stopConditions), true);
  assert.equal(Object.isFrozen(definition.externalActions), true);
  const decision = evaluateGrowthExperiment({
    definition,
    observedMetric: 0.026,
    stopTriggered: false,
  });
  assert.equal(Object.isFrozen(decision), true);
  assert.throws(() => {
    decision.decision = 'failed';
  }, TypeError);
});
