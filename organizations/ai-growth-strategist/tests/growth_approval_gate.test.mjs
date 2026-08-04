import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXTERNAL_ACTIONS,
  assertExternalActionAllowed,
  createGrowthApprovalGate,
} from '../scripts/growth_approval_gate.mjs';
import {
  EXTERNAL_ACTIONS as EXPERIMENT_EXTERNAL_ACTIONS,
} from '../scripts/growth_experiment_manager.mjs';
import {
  createGrowthRunStore,
  createGrowthRunStoreForTest,
  isTrustedGrowthRunStore,
} from '../scripts/growth_run_store.mjs';
import { projectFixture, validRun } from './helpers.mjs';

const ACTIONS = Object.freeze([
  'publish_content',
  'paid_media',
  'contact_customer',
  'change_price',
  'change_refund_rule',
  'brand_commitment',
  'deal_commitment',
  'write_external_system',
]);

function identity(overrides = {}) {
  const run = validRun();
  return {
    enterpriseId: run.enterpriseId,
    businessProjectId: run.businessProjectId,
    runId: run.runId,
    ...overrides,
  };
}

function approval(overrides = {}) {
  const now = Date.now();
  return {
    approvalId: 'approval-001',
    runId: 'run-001',
    allowedActions: [...ACTIONS],
    decision: 'approved',
    decidedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    enterpriseId: identity().enterpriseId,
    businessProjectId: identity().businessProjectId,
    runId: identity().runId,
    action: 'publish_content',
    approvalId: 'approval-001',
    ...overrides,
  };
}

async function advanceToAwaitingApproval(store) {
  await store.initialize(validRun());
  for (const [expectedState, nextState] of [
    ['intake', 'planning'],
    ['planning', 'ready'],
    ['ready', 'running_internal'],
    ['running_internal', 'awaiting_approval'],
  ]) {
    await store.transition(identity(), { expectedState, nextState });
  }
}

async function prepareApprovedRun(store, approvalValue = approval()) {
  await advanceToAwaitingApproval(store);
  await store.recordApproval(identity(), approvalValue, {
    expectedRevision: 0,
  });
  await store.transition(identity(), {
    expectedState: 'awaiting_approval',
    nextState: 'running_approved',
  });
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

test('approval gate re-exports the exact experiment manager action object', () => {
  assert.equal(EXTERNAL_ACTIONS, EXPERIMENT_EXTERNAL_ACTIONS);
  assert.deepEqual([...EXTERNAL_ACTIONS], ACTIONS);
  assert.equal(Object.isFrozen(EXTERNAL_ACTIONS), true);
});

test('gate only accepts an unforgeably branded run store', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  assert.equal(isTrustedGrowthRunStore(store), true);

  const copies = [
    {},
    { consumeExternalApproval: store.consumeExternalApproval },
    { ...store },
    Object.assign({}, store),
    Object.create(store),
    new Proxy(store, {}),
  ];
  for (const runStore of copies) {
    assert.equal(isTrustedGrowthRunStore(runStore), false);
    assert.throws(
      () => createGrowthApprovalGate({ runStore }),
      /trusted|run store|brand/iu,
    );
  }

  const gate = createGrowthApprovalGate({ runStore: store });
  assert.deepEqual(Object.keys(gate), ['authorizeExternalAction']);
  assert.equal(Object.isFrozen(gate), true);
  assert.equal(typeof gate.authorizeExternalAction, 'function');
});

test('gate rejects test stores and later production stores for the same canonical root', async (t) => {
  const root = await projectFixture(t);
  const authoritative = await createGrowthRunStore({ projectRoot: root });
  const testStore = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: () => new Date('2000-01-01T00:00:00.000Z'),
  });
  const laterProductionStore = await createGrowthRunStore({
    projectRoot: root,
  });

  assert.equal(isTrustedGrowthRunStore(authoritative), true);
  assert.equal(isTrustedGrowthRunStore(testStore), false);
  assert.equal(isTrustedGrowthRunStore(laterProductionStore), false);
  assert.throws(
    () => createGrowthApprovalGate({ runStore: testStore }),
    /trusted|run store|brand/iu,
  );
  assert.throws(
    () => createGrowthApprovalGate({ runStore: laterProductionStore }),
    /trusted|run store|brand/iu,
  );
  assert.doesNotThrow(
    () => createGrowthApprovalGate({ runStore: authoritative }),
  );
});

test('gate options require one exact stable data property without traps', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  for (const value of [
    undefined,
    null,
    [],
    {},
    { runStore: store, extra: true },
  ]) {
    assert.throws(
      () => createGrowthApprovalGate(value),
      /plain|runStore|missing|unexpected/iu,
    );
  }

  let getterCalls = 0;
  const getterOptions = {};
  Object.defineProperty(getterOptions, 'runStore', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return store;
    },
  });
  assert.throws(
    () => createGrowthApprovalGate(getterOptions),
    /accessor|data property/iu,
  );
  assert.equal(getterCalls, 0);

  const probe = proxyTrapProbe(
    { runStore: store },
    'SENTINEL_GATE_OPTIONS_PROXY',
  );
  assertProxyRejected(() => createGrowthApprovalGate(probe.proxy), probe);
});

test('normal full chain produces a frozen one-time receipt without an external callback', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);
  const gate = createGrowthApprovalGate({ runStore: store });

  const beforeAuthorizedAt = Date.now();
  const receipt = await gate.authorizeExternalAction(request());
  const afterAuthorizedAt = Date.now();
  assert.equal(receipt.allowed, true);
  assert.equal(receipt.action, 'publish_content');
  assert.equal(receipt.runId, 'run-001');
  assert.equal(receipt.approvalId, 'approval-001');
  assert.equal(receipt.approvalRevision, 2);
  assert.ok(Date.parse(receipt.authorizedAt) >= beforeAuthorizedAt);
  assert.ok(Date.parse(receipt.authorizedAt) <= afterAuthorizedAt);
  assert.ok(Date.parse(receipt.expiresAt) > afterAuthorizedAt);
  assert.match(receipt.authorizationId, /^[a-z0-9][a-z0-9-]{2,119}$/u);
  assert.equal(Object.isFrozen(receipt), true);

  await assert.rejects(
    gate.authorizeExternalAction(request()),
    /replay|consumed|conflict/iu,
  );
  await assert.rejects(
    gate.authorizeExternalAction({
      ...request({ action: 'paid_media' }),
      execute: () => assert.fail('external action must not execute'),
    }),
    /unexpected|execute/iu,
  );
});

test('all eight approved actions may each be consumed exactly once', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);
  const gate = createGrowthApprovalGate({ runStore: store });

  for (let index = 0; index < ACTIONS.length; index += 1) {
    const action = ACTIONS[index];
    const receipt = await gate.authorizeExternalAction(request({ action }));
    assert.equal(receipt.action, action);
    assert.equal(receipt.approvalRevision, index + 2);
    await assert.rejects(
      gate.authorizeExternalAction(request({ action })),
      /replay|consumed|conflict/iu,
    );
  }
});

test('request cannot supply run state, approval, time or any other authority', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);
  const gate = createGrowthApprovalGate({ runStore: store });

  for (const extra of [
    { runState: 'running_approved' },
    { approval: approval() },
    { at: '2000-01-01T12:00:00.000Z' },
    { now: () => new Date('2000-01-01T12:00:00.000Z') },
  ]) {
    await assert.rejects(
      gate.authorizeExternalAction({ ...request(), ...extra }),
      /unexpected|field/iu,
    );
  }

  await assert.rejects(
    assertExternalActionAllowed({
      action: 'publish_content',
      runId: 'run-001',
      runState: 'running_approved',
      approval: {
        schemaVersion: 1,
        ...approval(),
      },
      at: '2000-01-01T12:00:00.000Z',
    }),
    /trusted|gate/iu,
  );
});

test('trusted store clock rejects historical replay and expiry boundary', async (t) => {
  const expiredRoot = await projectFixture(t);
  const expiredStore = await createGrowthRunStore({
    projectRoot: expiredRoot,
  });
  await prepareApprovedRun(expiredStore, approval({
    decidedAt: '2000-01-01T11:00:00.000Z',
    expiresAt: '2000-01-01T13:00:00.000Z',
  }));
  const expiredGate = createGrowthApprovalGate({ runStore: expiredStore });
  await assert.rejects(
    expiredGate.authorizeExternalAction({
      ...request(),
      at: '2000-01-01T12:00:00.000Z',
    }),
    /unexpected|at/iu,
  );
  await assert.rejects(
    expiredGate.authorizeExternalAction(request()),
    /expired|time/iu,
  );

  const boundaryRoot = await projectFixture(t);
  const boundaryStore = await createGrowthRunStore({
    projectRoot: boundaryRoot,
  });
  const boundaryNow = Date.now();
  await prepareApprovedRun(boundaryStore, approval({
    decidedAt: new Date(boundaryNow - 60_000).toISOString(),
    expiresAt: new Date(boundaryNow).toISOString(),
  }));
  const boundaryGate = createGrowthApprovalGate({ runStore: boundaryStore });
  await assert.rejects(
    boundaryGate.authorizeExternalAction(request()),
    /expired|time/iu,
  );
});

test('gate request validates exact stable identity and action data without traps', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);
  const gate = createGrowthApprovalGate({ runStore: store });

  for (const value of [
    null,
    [],
    { ...request(), extra: true },
    (() => {
      const value = request();
      delete value.approvalId;
      return value;
    })(),
    request({ enterpriseId: '../unsafe' }),
    request({ businessProjectId: '../unsafe' }),
    request({ runId: '../unsafe' }),
    request({ approvalId: '../unsafe' }),
    request({ action: 'internal_analysis' }),
  ]) {
    await assert.rejects(
      gate.authorizeExternalAction(value),
      /plain|unexpected|missing|unsafe|invalid|external|action/iu,
    );
  }

  let getterCalls = 0;
  const getterRequest = request();
  Object.defineProperty(getterRequest, 'action', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'publish_content';
    },
  });
  await assert.rejects(
    gate.authorizeExternalAction(getterRequest),
    /accessor|data property/iu,
  );
  assert.equal(getterCalls, 0);

  const probe = proxyTrapProbe(
    request(),
    'SENTINEL_GATE_REQUEST_PROXY',
  );
  let captured;
  try {
    await gate.authorizeExternalAction(probe.proxy);
  } catch (error) {
    captured = error;
  }
  assert.match(captured?.message ?? '', /proxy/iu);
  assert.doesNotMatch(captured?.message ?? '', /SENTINEL/iu);
  assert.equal(probe.trapCalls(), 0);
});

test('compatibility wrapper only accepts a real branded gate and uses atomic consume', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);
  const gate = createGrowthApprovalGate({ runStore: store });

  for (const fakeGate of [
    {},
    { authorizeExternalAction: gate.authorizeExternalAction },
    { ...gate },
    Object.create(gate),
    new Proxy(gate, {}),
  ]) {
    await assert.rejects(
      assertExternalActionAllowed(fakeGate, request()),
      /trusted|gate|brand/iu,
    );
  }

  const receipt = await assertExternalActionAllowed(gate, request());
  assert.equal(receipt.allowed, true);
  await assert.rejects(
    assertExternalActionAllowed(gate, request()),
    /replay|consumed|conflict/iu,
  );
});
