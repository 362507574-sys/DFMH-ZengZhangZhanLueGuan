import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/competitive_benchmark_v2_contract.mjs',
);
const candidate = JSON.parse(await readFile(
  path.join(
    organizationRoot,
    'tests',
    'fixtures',
    'competitive-benchmark-v2-valid.json',
  ),
  'utf8',
));
const projectRoot = path.join(
  organizationRoot,
  'fixtures',
  'cbv2-proof-root',
);
const expectedIdentity = Object.freeze({
  enterpriseId: 'ent-benchmark',
  businessProjectId: '20260730-001-benchmark',
  taskId: 'task-benchmark',
  runId: 'run-benchmark',
});
const options = Object.freeze({
  expectedIdentity,
  projectRoot,
  expectedUpstream: Object.freeze({
    artifactId: 'growth-opportunity-brief',
    version: 1,
    sha256: '16bb5e728dcca2bcc9ede982ba0c3ca2c182e404cefdf2336241f04563444022',
  }),
  expectedKnowledgeReceipt: Object.freeze({
    relativePath: candidate.knowledgeContext.evidencePath,
    status: candidate.knowledgeContext.status,
    sha256: candidate.knowledgeContext.evidenceSha256,
  }),
  referenceAt: '2026-07-30T23:59:59.000Z',
});
const mutate = (change) => {
  const value = structuredClone(candidate);
  change(value);
  return value;
};

function requireValidator() {
  assert.equal(
    typeof loaded.module?.validateCompetitiveBenchmarkV2Candidate,
    'function',
    loaded.error?.message ?? 'competitive benchmark v2 validator missing',
  );
  return loaded.module?.validateCompetitiveBenchmarkV2Candidate;
}

test('v2候选绑定正式身份、真实上游、真实凭证与真实公开来源', () => {
  const validate = requireValidator();
  if (!validate) return;
  const result = validate(candidate, options);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.capabilityId, 'competitive-benchmark-analysis');
  assert.deepEqual(result.scope.upstreamArtifact, {
    artifactId: 'growth-opportunity-brief',
    version: 1,
    sha256: '16bb5e728dcca2bcc9ede982ba0c3ca2c182e404cefdf2336241f04563444022',
    path: 'business-projects/ent-benchmark/20260730-001-benchmark/shared-artifacts/growth-opportunity-brief/v1.json',
  });
  assert.equal(result.samples.filter((item) => item.kind === 'direct').length, 3);
  assert.equal(
    result.samples.filter((item) => item.kind === 'alternative').length,
    1,
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.samples[0].layers.positioning), true);
});

test('v2候选不能自证身份或项目根', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(candidate),
    /trusted|expected identity|projectRoot/u,
  );
  assert.throws(
    () => validate(candidate, { projectRoot }),
    /expected identity|trusted/u,
  );
  assert.throws(
    () => validate(candidate, {
      ...options,
      expectedIdentity: { ...expectedIdentity, runId: 'run-other' },
    }),
    /identity mismatch.*runId/u,
  );
});

test('上游版本、SHA和固定项目内路径必须与真实文件一致', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.scope.upstreamArtifact.version = 2;
    }), options),
    /upstream|version|path/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.scope.upstreamArtifact.sha256 = '0'.repeat(64);
    }), options),
    /upstream.*SHA|SHA.*upstream/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.scope.upstreamArtifact.path = '../outside.json';
    }), options),
    /upstream|escape|outside/u,
  );
});

test('knowledge receipt状态诚实且路径、文件与SHA均受信任根校验', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.equal(validate(candidate, options).knowledgeContext.status, 'no_hit');
  assert.throws(
    () => validate(mutate((value) => {
      value.knowledgeContext.status = 'matched_by_guess';
    }), options),
    /knowledge context status/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.knowledgeContext.evidenceSha256 = '0'.repeat(64);
    }), options),
    /knowledge.*SHA|SHA.*knowledge/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.knowledgeContext.evidencePath =
        'business-projects/ent-benchmark/20260730-001-benchmark/missing.json';
    }), options),
    /knowledge.*(?:run|missing|path|outside)/u,
  );
});

test('每条证据必须绑定真实普通文件与真实SHA', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.evidence[0].sourceSha256 = '0'.repeat(64);
    }), options),
    /source.*SHA|SHA.*source/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.evidence[0].sourcePath = 'C:\\outside\\source.txt';
    }), options),
    /source|absolute|outside|escape/u,
  );
});

test('样本必须恰好三个direct加一个explicit alternative且逐层完整', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.samples = value.samples.filter((item) => item.kind === 'direct');
    }), options),
    /three direct|alternative|sample/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.samples[0].layers.positioning.unknowns = [];
    }), options),
    /unknown|positioning/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      delete value.samples[0].layers.observableCustomerPath;
    }), options),
    /observableCustomerPath|missing/u,
  );
});

test('私有转化、收入、利润等数字声明被阻断，明确未知仍允许', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.samples[0].layers.observableCustomerPath.inferences = [
        'private conversion is 30 percent without public evidence',
      ];
    }), options),
    /private|conversion|unknown/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.samples[1].layers.productStrategy.inferences = [
        '竞品成交率30%，营收100万元。',
      ];
    }), options),
    /private|成交率|营收|unknown/u,
  );
  assert.doesNotThrow(() => validate(candidate, options));
});

test('迁移链条完整，复制、品牌混淆与知识产权风险必须为零', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.transfers[0].antiCopyChecks.copiesCoreCopy = true;
    }), options),
    /copy|brand|intellectual/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.transfers[0].antiCopyChecks.brandConfusionRisk = 'possible';
    }), options),
    /brand|confusion|none/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.transfers[0].surfaceAction =
        value.transfers[0].underlyingMechanism;
    }), options),
    /surface|mechanism|distinct/u,
  );
});

test('原创实验必须有期限、主指标、护栏指标、成本与停止条件', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.transfers[0].experiment.riskMetrics = [];
    }), options),
    /riskMetrics|non-empty/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.transfers[0].experiment.maximumDays = 0;
    }), options),
    /maximumDays/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.transfers[0].experiment.requiresApproval = false;
    }), options),
    /approval/u,
  );
});

test('组织边界和调试阻断状态不能伪装通过', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.boundaryChecks.changesPricePolicy = true;
    }), options),
    /boundary|price|forbidden/u,
  );
  assert.throws(
    () => validate(mutate((value) => {
      value.debugReport.diagnostics[0].severity = 'blocking';
    }), options),
    /debug|blocked|blocking/u,
  );
});

test('严格拒绝额外字段、Proxy、accessor、Symbol、稀疏数组和深层对象', () => {
  const validate = requireValidator();
  if (!validate) return;
  assert.throws(
    () => validate(mutate((value) => {
      value.forgedTrustedContext = options;
    }), options),
    /unexpected field/u,
  );
  assert.throws(
    () => validate(new Proxy(candidate, {}), options),
    /Proxy|plain data/u,
  );
  const accessor = mutate(() => {});
  Object.defineProperty(accessor.scope, 'objective', {
    enumerable: true,
    get: () => 'forged',
  });
  assert.throws(() => validate(accessor, options), /accessor|data property/u);
  const symbolic = mutate(() => {});
  symbolic[Symbol('trusted')] = true;
  assert.throws(() => validate(symbolic, options), /Symbol|plain data/u);
  const sparse = mutate((value) => {
    delete value.samples[1];
  });
  assert.throws(() => validate(sparse, options), /dense|plain data/u);
  const deep = mutate((value) => {
    let cursor = value.scope;
    for (let index = 0; index < 40; index += 1) {
      cursor.deep = {};
      cursor = cursor.deep;
    }
  });
  assert.throws(() => validate(deep, options), /depth limit/u);
});
