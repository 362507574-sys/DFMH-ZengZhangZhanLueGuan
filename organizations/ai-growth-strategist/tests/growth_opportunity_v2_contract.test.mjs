import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport('scripts/growth_opportunity_v2_contract.mjs');
const valid = JSON.parse(await readFile(
  path.join(
    organizationRoot,
    'tests',
    'fixtures',
    'growth-opportunity-v2-valid.json',
  ),
  'utf8',
));

const TOP_FIELDS = [
  'schemaVersion', 'capabilityId', 'enterpriseId', 'businessProjectId',
  'taskId', 'runId', 'status', 'knowledgeContext', 'scope', 'evidence',
  'analysisBranches', 'opportunities', 'priorityMap', 'boundaryChecks',
  'collaborationRequests', 'debugReport', 'review',
];
const mutate = (change) => {
  const value = structuredClone(valid);
  change(value);
  return value;
};
const withoutCounterEvidence = () => mutate((value) => {
  value.opportunities[0].counterEvidenceRefs = [];
});
const withWeakEvidenceMarkedA = () => mutate((value) => {
  value.opportunities[0].confidence = {
    grade: 'A',
    reason: 'weak evidence incorrectly marked A',
    evidenceTypeCount: 1,
    hasEnterpriseBehaviorData: false,
  };
});
const withInvalidScore = () => mutate((value) => {
  value.opportunities[0].attractiveness.total = 100;
});

test('v2 增长机会契约暴露严格校验入口', () => {
  assert.equal(
    typeof loaded.module?.validateGrowthOpportunityV2Candidate,
    'function',
    loaded.error?.message ?? 'validateGrowthOpportunityV2Candidate missing',
  );
});

test('完整 v2 候选通过、字段精确且结果深度冻结', () => {
  if (!loaded.module) return;
  const result = loaded.module.validateGrowthOpportunityV2Candidate(valid);
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(Object.keys(result), TOP_FIELDS);
  assert.deepEqual(
    result.analysisBranches.map((item) => item.id),
    [
      'market-trends',
      'user-demand',
      'industry-opportunity',
      'enterprise-growth-space',
    ],
  );
  assert.equal(result.opportunities[0].attractiveness.total, 77);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.opportunities[0].experiment), true);
});

test('反证、可信度和吸引力规则不可绕过', () => {
  if (!loaded.module) return;
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(
      withoutCounterEvidence(),
    ),
    /counter evidence/u,
  );
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(
      withWeakEvidenceMarkedA(),
    ),
    /confidence/u,
  );
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(
      withInvalidScore(),
    ),
    /attractiveness/u,
  );
});

test('四支线必须完整、固定顺序并保留事实、推断和未知', () => {
  if (!loaded.module) return;
  const missing = mutate((value) => value.analysisBranches.pop());
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(missing),
    /analysis branch|four|四/u,
  );
  const reordered = mutate((value) => value.analysisBranches.reverse());
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(reordered),
    /analysis branch|order|顺序/u,
  );
  const noUnknown = mutate((value) => {
    value.analysisBranches[0].unknowns = [];
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(noUnknown),
    /unknown/u,
  );
});

test('实验必须可测量、有界并将外部动作标记为需要审批', () => {
  if (!loaded.module) return;
  const noStop = mutate((value) => {
    value.opportunities[0].experiment.stopConditions = [];
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(noStop),
    /stop/u,
  );
  const noApproval = mutate((value) => {
    value.opportunities[0].experiment.requiresApproval = false;
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(noApproval),
    /approval/u,
  );
});

test('v2 继续拒绝保证增长和组织越界', () => {
  if (!loaded.module) return;
  const guarantee = mutate((value) => {
    value.opportunities[0].mechanism = '保证增长并保证成交';
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(guarantee),
    /guarantee|保证|承诺/u,
  );
  const boundary = mutate((value) => {
    value.boundaryChecks.changesDealRules = true;
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(boundary),
    /boundary|边界/u,
  );
});

test('businessProjectId 使用正式格式并可绑定预期运行身份', () => {
  if (!loaded.module) return;
  const invalid = mutate((value) => { value.businessProjectId = 'abc'; });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(invalid),
    /businessProjectId/u,
  );
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(valid, {
      expectedIdentity: {
        enterpriseId: valid.enterpriseId,
        businessProjectId: '20260729-999-other',
        taskId: valid.taskId,
        runId: valid.runId,
      },
    }),
    /identity/u,
  );
});

test('反证必须来自受控 counter 证据且不得与正向证据重叠', () => {
  if (!loaded.module) return;
  const overlap = mutate((value) => {
    value.opportunities[0].counterEvidenceRefs = ['ev-click-rate'];
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(overlap),
    /counter.*overlap|反证/u,
  );
  const fakeCounter = mutate((value) => {
    value.evidence.find((item) => item.id === 'ev-counter').polarity = 'support';
    value.opportunities[0].counterEvidenceRefs = ['ev-counter'];
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(fakeCounter),
    /counter evidence|polarity|反证/u,
  );
});

test('unknown 与 hypothesis 不能凑高可信度且决策必须匹配双层映射', () => {
  if (!loaded.module) return;
  const weakA = mutate((value) => {
    value.opportunities[0].evidenceRefs = [
      'ev-click-rate',
      'ev-no-attribution',
    ];
    value.evidence.find(
      (item) => item.id === 'ev-no-attribution',
    ).polarity = 'neutral';
    value.opportunities[0].counterEvidenceRefs = ['ev-counter'];
    value.opportunities[0].confidence.evidenceTypeCount = 3;
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(weakA),
    /confidence|reliable|事实/u,
  );
  const wrongDecision = mutate((value) => {
    value.priorityMap[0].decision = 'stop';
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(wrongDecision),
    /priorityMap.*decision|dual evaluation/u,
  );
  const dExperiment = mutate((value) => {
    value.opportunities[0].confidence.grade = 'D';
    value.priorityMap[0].confidence = 'D';
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(dExperiment),
    /priorityMap.*decision|dual evaluation/u,
  );
});

test('blocking 诊断不能声明 passed', () => {
  if (!loaded.module) return;
  const blocked = mutate((value) => {
    value.debugReport.status = 'passed';
    value.debugReport.remainingUnknowns = [];
    value.debugReport.diagnostics[0].severity = 'blocking';
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(blocked),
    /blocking|debugReport/u,
  );
});

test('契约拒绝 Proxy、accessor 和超大稠密数组且不触发用户代码', () => {
  if (!loaded.module) return;
  let touched = 0;
  const accessor = structuredClone(valid);
  Object.defineProperty(accessor, 'status', {
    enumerable: true,
    get() { touched += 1; return 'candidate'; },
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(accessor),
    /accessor|data property|plain object/u,
  );
  assert.equal(touched, 0);
  const proxy = new Proxy(structuredClone(valid), {
    ownKeys() { touched += 1; return []; },
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(proxy),
    /Proxy|plain object/u,
  );
  assert.equal(touched, 0);
  const huge = mutate((value) => {
    value.scope.constraints = Array.from({ length: 50_000 }, () => 'x');
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(huge),
    /size|limit|too many|maximum/u,
  );
});

test('证据冲突必须双向且未解决冲突阻止高可信度', () => {
  if (!loaded.module) return;
  const asymmetric = mutate((value) => {
    value.evidence[0].conflictReferences = ['ev-click-rate'];
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(asymmetric),
    /conflict.*symmetric|冲突/u,
  );
  const unresolvedHigh = mutate((value) => {
    value.evidence[0].conflictReferences = ['ev-click-rate'];
    value.evidence[1].conflictReferences = ['ev-subscribers'];
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(unresolvedHigh),
    /confidence|conflict|冲突/u,
  );
});

test('知识凭证限制在当前项目运行边界并校验存在性与 SHA', () => {
  if (!loaded.module) return;
  const escaped = mutate((value) => {
    value.knowledgeContext.evidencePath = '../../outside.json';
    value.knowledgeContext.evidenceSha256 = 'a'.repeat(64);
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(escaped, {
      projectRoot: organizationRoot,
    }),
    /knowledge.*path|escape|outside/u,
  );
  const missing = mutate((value) => {
    value.knowledgeContext.status = 'matched';
    value.knowledgeContext.evidencePath =
      'business-projects/enterprise-1122334455667788/20260729-001-growth/organizations/ai-growth-strategist/runs/run-opportunity-001/knowledge-context.json';
    value.knowledgeContext.evidenceSha256 = 'a'.repeat(64);
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(missing, {
      projectRoot: organizationRoot,
    }),
    /knowledge.*missing|cannot be read|receipt/u,
  );
});

test('expectedIdentity与深层对象在读取前拒绝Proxy和accessor', () => {
  if (!loaded.module) return;
  let touched = 0;
  const identity = new Proxy({
    enterpriseId: valid.enterpriseId,
  }, {
    get() { touched += 1; return valid.enterpriseId; },
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(valid, {
      expectedIdentity: identity,
    }),
    /Proxy|plain data/u,
  );
  const nested = structuredClone(valid);
  Object.defineProperty(nested.evidence[0], 'claim', {
    enumerable: true,
    get() { touched += 1; return 'trap'; },
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(nested),
    /accessor|data property|plain data/u,
  );
  const arrayProxy = structuredClone(valid);
  arrayProxy.opportunities[0].evidenceRefs = new Proxy(
    ['ev-subscriber-base'],
    { get() { touched += 1; return 1; } },
  );
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(arrayProxy),
    /Proxy|plain data/u,
  );
  const extraGetter = structuredClone(valid);
  Object.defineProperty(extraGetter.scope.constraints, 'extra', {
    enumerable: true,
    get() { touched += 1; return 'trap'; },
  });
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(extraGetter),
    /extra|accessor|plain data/u,
  );
  assert.equal(touched, 0);
});

test('全部关键嵌套数组采用稠密有界资源限制', () => {
  if (!loaded.module) return;
  for (const change of [
    (value) => { value.opportunities[0].evidenceRefs = Array(50_000).fill('x'); },
    (value) => { value.opportunities[0].counterEvidenceRefs = Array(50_000).fill('x'); },
    (value) => { value.review.baselineMetrics = Array(50_000).fill('x'); },
  ]) {
    assert.throws(
      () => loaded.module.validateGrowthOpportunityV2Candidate(mutate(change)),
      /size|maximum|too many|limit/u,
    );
  }
});

test('receipt真实父链通过，文件链接与父目录junction拒绝', (t) => {
  if (!loaded.module) return;
  const root = mkdtempSync(path.join(os.tmpdir(), 'growth-receipt-chain-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = structuredClone(valid);
  candidate.knowledgeContext.status = 'matched';
  const receiptPath = path.join(
    root,
    ...candidate.knowledgeContext.evidencePath.split('/'),
  );
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  const bytes = Buffer.from('real receipt\n');
  writeFileSync(receiptPath, bytes);
  candidate.knowledgeContext.evidenceSha256 = createHash('sha256')
    .update(bytes)
    .digest('hex');
  assert.doesNotThrow(
    () => loaded.module.validateGrowthOpportunityV2Candidate(candidate, {
      projectRoot: root,
      expectedIdentity: {
        enterpriseId: candidate.enterpriseId,
        businessProjectId: candidate.businessProjectId,
        taskId: candidate.taskId,
        runId: candidate.runId,
      },
    }),
  );

  const target = path.join(root, 'target-receipt.json');
  writeFileSync(target, bytes);
  rmSync(receiptPath);
  symlinkSync(target, receiptPath, 'file');
  assert.throws(
    () => loaded.module.validateGrowthOpportunityV2Candidate(candidate, {
      projectRoot: root,
    }),
    /link|symlink|reparse/u,
  );

  if (process.platform === 'win32') {
    const junctionRoot = mkdtempSync(
      path.join(os.tmpdir(), 'growth-receipt-junction-target-'),
    );
    t.after(() => rmSync(junctionRoot, { recursive: true, force: true }));
    const projectParent = path.join(
      root,
      'business-projects',
      candidate.enterpriseId,
    );
    rmSync(projectParent, { recursive: true, force: true });
    const junctionReceipt = path.join(
      junctionRoot,
      candidate.businessProjectId,
      'organizations',
      'ai-growth-strategist',
      'runs',
      candidate.runId,
      'knowledge-context.json',
    );
    mkdirSync(path.dirname(junctionReceipt), { recursive: true });
    writeFileSync(junctionReceipt, bytes);
    symlinkSync(junctionRoot, projectParent, 'junction');
    assert.throws(
      () => loaded.module.validateGrowthOpportunityV2Candidate(candidate, {
        projectRoot: root,
      }),
      /junction|link|reparse|outside/u,
    );
  }
});
