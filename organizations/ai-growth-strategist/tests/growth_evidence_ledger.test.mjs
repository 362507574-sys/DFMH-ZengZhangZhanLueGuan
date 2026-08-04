import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createGrowthEvidenceLedger } from '../scripts/growth_evidence_ledger.mjs';

const TYPES = [
  'enterprise_fact',
  'customer_quote',
  'behavior_data',
  'feishu_knowledge',
  'public_source',
  'professional_inference',
  'validation_hypothesis',
  'unknown',
];

function evidence(overrides = {}) {
  return {
    id: 'ev-001',
    type: 'behavior_data',
    claim: 'diagnostic content click rate is 18 percent',
    sourceReference: 'internal-report-q2',
    sourceVersion: '2026-q2',
    sourceSha256: 'a'.repeat(64),
    observedAt: '2026-07-28T00:00:00.000Z',
    appliesTo: 'consented newsletter audience',
    confidence: 'A',
    conflictReferences: [],
    ...overrides,
  };
}

function ledger(overrides = {}) {
  return {
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260729-001-growth',
    runId: 'run-001',
    items: [evidence()],
    ...overrides,
  };
}

function identity(overrides = {}) {
  return {
    enterpriseId: ledger().enterpriseId,
    businessProjectId: ledger().businessProjectId,
    runId: ledger().runId,
    ...overrides,
  };
}

function proxyTrapProbe(target) {
  let trapCalls = 0;
  const fail = (name) => {
    trapCalls += 1;
    throw new Error(`SENTINEL_EVIDENCE_PROXY_${name}`);
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

test('creates the planned six-key revisioned evidence ledger', () => {
  const value = createGrowthEvidenceLedger(ledger());
  assert.deepEqual(Object.keys(value), [
    'schemaVersion',
    'revision',
    'enterpriseId',
    'businessProjectId',
    'runId',
    'items',
  ]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.revision, 1);
  assert.equal(value.items[0].sourceSha256.length, 64);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.getPrototypeOf(value.items), Array.prototype);
  assert.equal(Object.getPrototypeOf(value.items[0]), Object.prototype);
});

test('accepts every exact evidence type including sourced unknown evidence', () => {
  const value = createGrowthEvidenceLedger(ledger({
    items: TYPES.map((type, index) => evidence({
      id: `ev-${String(index + 1).padStart(3, '0')}`,
      type,
      sourceReference: type === 'unknown'
        ? 'current-input-missing-audit'
        : `source-${type}`,
    })),
  }));
  assert.deepEqual(value.items.map((item) => item.type), TYPES);
});

test('rejects duplicate ids, unsupported types and unsafe ids', () => {
  assert.throws(
    () => createGrowthEvidenceLedger(ledger({
      items: [evidence(), evidence()],
    })),
    /duplicate|unique/iu,
  );
  assert.throws(
    () => createGrowthEvidenceLedger(ledger({
      items: [evidence({ type: 'customer_voice' })],
    })),
    /type|invalid/iu,
  );
  assert.throws(
    () => createGrowthEvidenceLedger(ledger({
      items: [evidence({ id: '../escape' })],
    })),
    /id|unsafe/iu,
  );
});

test('requires bounded source fields and exact lowercase sha256', () => {
  for (const [field, value] of [
    ['claim', ''],
    ['sourceReference', ''],
    ['sourceVersion', ''],
    ['appliesTo', ''],
  ]) {
    assert.throws(
      () => createGrowthEvidenceLedger(ledger({
        items: [evidence({ [field]: value })],
      })),
      new RegExp(`${field}|required`, 'iu'),
    );
  }
  for (const sourceSha256 of [
    '',
    'A'.repeat(64),
    'a'.repeat(63),
    `${'a'.repeat(63)}g`,
  ]) {
    assert.throws(
      () => createGrowthEvidenceLedger(ledger({
        items: [evidence({ sourceSha256 })],
      })),
      /sha256/iu,
    );
  }
  assert.throws(
    () => createGrowthEvidenceLedger(ledger({
      items: [evidence({ claim: 'x'.repeat(4_001) })],
    })),
    /claim|size|limit/iu,
  );
});

test('requires canonical time and confidence A through D', () => {
  for (const observedAt of ['invalid', '2026-07-28T00:00:00Z']) {
    assert.throws(
      () => createGrowthEvidenceLedger(ledger({
        items: [evidence({ observedAt })],
      })),
      /observedAt|ISO|time/iu,
    );
  }
  for (const confidence of ['A+', '', 'E', null]) {
    assert.throws(
      () => createGrowthEvidenceLedger(ledger({
        items: [evidence({ confidence })],
      })),
      /confidence/iu,
    );
  }
  assert.deepEqual(
    ['A', 'B', 'C', 'D'].map((confidence) => (
      createGrowthEvidenceLedger(ledger({
        items: [evidence({ confidence })],
      })).items[0].confidence
    )),
    ['A', 'B', 'C', 'D'],
  );
});

test('expected identity accepts only stable matching identity data properties', () => {
  assert.doesNotThrow(() => createGrowthEvidenceLedger(ledger(), identity()));
  for (const field of ['enterpriseId', 'businessProjectId', 'runId']) {
    const mismatch = {
      enterpriseId: 'enterprise-9988776655443322',
      businessProjectId: '20260729-999-growth',
      runId: 'run-999',
    }[field];
    assert.throws(
      () => createGrowthEvidenceLedger(
        ledger(),
        identity({ [field]: mismatch }),
      ),
      /identity/iu,
    );
  }
  assert.throws(
    () => createGrowthEvidenceLedger(
      ledger(),
      identity({ businessProjectId: '../unsafe' }),
    ),
    /identity/iu,
  );

  let calls = 0;
  const expected = identity();
  Object.defineProperty(expected, 'runId', {
    enumerable: true,
    get() {
      calls += 1;
      return 'run-001';
    },
  });
  assert.throws(
    () => createGrowthEvidenceLedger(ledger(), expected),
    /accessor|data property/iu,
  );
  assert.equal(calls, 0);
});

test('accepts forward symmetric conflicts and rejects invalid conflict graphs', () => {
  const valid = createGrowthEvidenceLedger(ledger({
    items: [
      evidence({ id: 'ev-001', conflictReferences: ['ev-002'] }),
      evidence({
        id: 'ev-002',
        type: 'professional_inference',
        conflictReferences: ['ev-001'],
      }),
    ],
  }));
  assert.deepEqual(valid.items[0].conflictReferences, ['ev-002']);

  const invalidItems = [
    [evidence({ conflictReferences: ['ev-999'] })],
    [evidence({ conflictReferences: ['ev-001'] })],
    [
      evidence({ id: 'ev-001', conflictReferences: ['ev-002'] }),
      evidence({ id: 'ev-002', conflictReferences: [] }),
    ],
    [
      evidence({ id: 'ev-001', conflictReferences: ['ev-002', 'ev-002'] }),
      evidence({ id: 'ev-002', conflictReferences: ['ev-001'] }),
    ],
  ];
  for (const items of invalidItems) {
    assert.throws(
      () => createGrowthEvidenceLedger(ledger({ items })),
      /conflict|unknown|self|symmetric|duplicate|unique/iu,
    );
  }
});

test('accepts positive persisted revisions but rejects malformed revision contracts', () => {
  assert.deepEqual(
    createGrowthEvidenceLedger({
      schemaVersion: 1,
      revision: 1,
      ...ledger(),
    }),
    createGrowthEvidenceLedger(ledger()),
  );
  assert.equal(createGrowthEvidenceLedger({
    schemaVersion: 1,
    revision: 7,
    ...ledger(),
  }).revision, 7);
  assert.throws(
    () => createGrowthEvidenceLedger({ ...ledger(), extra: true }),
    /unexpected|field/iu,
  );
  assert.throws(
    () => createGrowthEvidenceLedger({
      schemaVersion: 2,
      revision: 1,
      ...ledger(),
    }),
    /schemaVersion/iu,
  );
  for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createGrowthEvidenceLedger({
        schemaVersion: 1,
        revision,
        ...ledger(),
      }),
      /revision|positive|safe integer/iu,
    );
  }
});

test('rejects accessors, sparse arrays and Proxies without executing user code', () => {
  let getterCalls = 0;
  const getterInput = ledger();
  Object.defineProperty(getterInput, 'items', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [evidence()];
    },
  });
  assert.throws(
    () => createGrowthEvidenceLedger(getterInput),
    /accessor|data property/iu,
  );
  assert.equal(getterCalls, 0);

  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => createGrowthEvidenceLedger(ledger({ items: sparse })),
    /dense|sparse|hole/iu,
  );

  const rootProbe = proxyTrapProbe(ledger());
  assertProxyRejected(
    () => createGrowthEvidenceLedger(rootProbe.proxy),
    rootProbe,
  );
  const itemProbe = proxyTrapProbe(evidence());
  assertProxyRejected(
    () => createGrowthEvidenceLedger(ledger({ items: [itemProbe.proxy] })),
    itemProbe,
  );
});

test('returns a deeply frozen independent copy', () => {
  const input = ledger();
  const value = createGrowthEvidenceLedger(input);
  input.items[0].claim = 'mutated input';
  input.items.push(evidence({ id: 'ev-002' }));

  assert.equal(value.items[0].claim, evidence().claim);
  assert.equal(value.items.length, 1);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.items), true);
  assert.equal(Object.isFrozen(value.items[0]), true);
  assert.equal(Object.isFrozen(value.items[0].conflictReferences), true);
  assert.throws(() => value.items.push(evidence()), TypeError);
  assert.throws(() => {
    value.items[0].claim = 'mutated output';
  }, TypeError);
});

test('rejects oversized evidence arrays before walking sparse indexes', () => {
  const moduleUrl = new URL(
    '../scripts/growth_evidence_ledger.mjs',
    import.meta.url,
  ).href;
  const script = `
    import { createGrowthEvidenceLedger } from ${JSON.stringify(moduleUrl)};
    const items = [];
    items.length = 10_000_000;
    try {
      createGrowthEvidenceLedger({
        enterpriseId: 'enterprise-1122334455667788',
        businessProjectId: '20260729-001-growth',
        runId: 'run-001',
        items,
      });
      process.stdout.write('accepted');
    } catch (error) {
      process.stdout.write(error.message);
    }
  `;
  const result = spawnSync(
    process.execPath,
    ['--max-old-space-size=64', '--input-type=module', '-e', script],
    {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /items|size limit/iu);

  const conflicts = [];
  conflicts.length = 1_001;
  assert.throws(
    () => createGrowthEvidenceLedger(ledger({
      items: [evidence({ conflictReferences: conflicts })],
    })),
    /conflictReferences|size limit/iu,
  );
});

test('validates a dense symmetric conflict graph in linear time', () => {
  const itemCount = 1_000;
  const items = Array.from({ length: itemCount }, (_, index) => {
    const references = [];
    for (let offset = 1; offset <= 25; offset += 1) {
      references.push(`ev-${String((index + offset) % itemCount).padStart(4, '0')}`);
      references.push(`ev-${String((index - offset + itemCount) % itemCount).padStart(4, '0')}`);
    }
    return evidence({
      id: `ev-${String(index).padStart(4, '0')}`,
      conflictReferences: references,
    });
  });
  const startedAt = performance.now();
  const value = createGrowthEvidenceLedger(ledger({ items }));
  const elapsedMs = performance.now() - startedAt;
  assert.equal(value.items.length, itemCount);
  assert.equal(value.items[0].conflictReferences.length, 50);
  assert.ok(elapsedMs < 3_000, `conflict graph took ${elapsedMs}ms`);
});

test('rejects more than 100000 directed conflict references', () => {
  const itemCount = 1_001;
  const ids = Array.from(
    { length: itemCount },
    (_, index) => `ev-${String(index).padStart(4, '0')}`,
  );
  const items = ids.map((id, index) => evidence({
    id,
    conflictReferences: Array.from(
      { length: 101 },
      (_, offset) => ids[(index + offset + 1) % itemCount],
    ),
  }));
  assert.throws(
    () => createGrowthEvidenceLedger(ledger({ items })),
    /100000|size limit/iu,
  );
});
