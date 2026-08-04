import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  cpSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const classifier = await optionalImport(
  'scripts/competitive_benchmark_claim_classifier.mjs',
);
const contract = await optionalImport(
  'scripts/competitive_benchmark_v2_contract.mjs',
);
const planner = await optionalImport(
  'scripts/competitive_benchmark_planner.mjs',
);
const fixtureRoot = path.join(
  organizationRoot,
  'fixtures',
  'cbv2-proof-root',
);
const baseCandidate = JSON.parse(readFileSync(path.join(
  organizationRoot,
  'tests',
  'fixtures',
  'competitive-benchmark-v2-valid.json',
), 'utf8'));
const round2hCandidate = JSON.parse(readFileSync(path.join(
  organizationRoot,
  'quality',
  'proofs',
  'competitive-benchmark-v02-forward-proof',
  'canonical-candidate.json',
), 'utf8'));
const skillText = readFileSync(path.join(
  organizationRoot,
  'skills',
  'competitive-benchmark-analysis',
  'SKILL.md',
), 'utf8');
const workflowText = readFileSync(path.join(
  organizationRoot,
  'workflows',
  'COMPETITIVE_BENCHMARK_ANALYSIS.md',
), 'utf8');
const expectedIdentity = Object.freeze({
  enterpriseId: 'ent-benchmark',
  businessProjectId: '20260730-001-benchmark',
  taskId: 'task-benchmark',
  runId: 'run-benchmark',
});

const NO_METRIC_EXTERNAL_ASSERTIONS = Object.freeze([
  '竞品稳居榜首。',
  '竞争对手达到99%。',
  '对手增长3倍。',
  'Competitor dominates.',
  'Peer grew 3x.',
  'Future competitor dominates.',
  'Internal hypothesis peer outperforms.',
  '竞品称霸行业。',
  '该竞品位居首位。',
  '对手傲视同业。',
  'Competitive peer ranks second.',
  'Competitor is number one.',
  '样本A表现最佳。',
  '替代样本D遥遥领先。',
  '同业属于头部。',
  '竞品↑。',
  'Competitor +99%.',
  '竞品增长百分之三十。',
  '竞\u2060品稳居榜首。',
  'Ｃｏｍｐｅｔｉｔｏｒ dominates.',
  'Future competitor outperforms.',
  'Internal future competitor dominates.',
]);
const ARBITRARY_CHINESE_UNKNOWN_SUBJECTS = Object.freeze([
  '行业标杆成交率未知。',
  '市场王者利润率未知。',
  '独占鳌头复购率未知。',
  '行业翘楚收入表现未知。',
  '市场霸主GMV数据未知。',
  '垄断者收入表现未知。',
  '赛道标杆转化率未知。',
]);
const SYMBOL_RESIDUE_ATTACKS = Object.freeze([
  'GMV不代表利润+',
  '+GMV不代表利润',
  '收入未知↑',
  '↑收入未知',
  'Revenue is unknown ↗',
  '🚀Revenue is unknown',
  '利润尚不清楚/',
  '/利润尚不清楚',
  '复购率未披露↘',
  '→Revenue is unavailable',
  'Profit is not publicly disclosed🚀',
  '收入暂无数据%',
]);
const EXACT_NEW_UNKNOWN_FORMS = Object.freeze([
  '收入暂无数据',
  '利润尚不清楚',
  '复购率未披露',
  'Revenue is unavailable',
  'Profit is not publicly disclosed',
]);
const SAFE_CROSS_ENTRY_REGRESSIONS = Object.freeze([
  '收入未知',
  '利润未知',
  'GMV未知',
  '转化率未知',
  '成交表现未知',
  '复购率未知',
  'ROI未知',
  'ROAS未知',
  '收入待核验',
  '利润无公开证据',
  '收入和利润均未知',
  'GMV、利润全部未知',
  '截至2026年收入未知',
  'Revenue is unknown',
  'Profit is unknown',
  'Revenue and profit are both unknown',
  'Revenue for 2026 is unknown',
  'GMV不代表利润',
  '收入不能证明成交表现',
  '收入并非利润',
  'Revenue does not prove profit',
  '不推断收入表现',
  '禁止推断利润',
  '无法判断复购率',
  '不能判断转化率',
  'No public evidence for revenue',
]);
const REJECT_CASES = Object.freeze([
  ...NO_METRIC_EXTERNAL_ASSERTIONS,
  ...ARBITRARY_CHINESE_UNKNOWN_SUBJECTS,
  ...SYMBOL_RESIDUE_ATTACKS,
]);
const ALLOW_CASES = Object.freeze([
  ...EXACT_NEW_UNKNOWN_FORMS,
  ...SAFE_CROSS_ENTRY_REGRESSIONS,
]);
const QUALITY_CASES = Object.freeze([
  ...REJECT_CASES.map((text) => ({ text, allowed: false })),
  ...ALLOW_CASES.map((text) => ({ text, allowed: true })),
]);

const NORMAL_60 = Object.freeze([
  ...[
    '收入',
    '利润',
    'GMV',
    '转化率',
    '成交表现',
    '复购率',
    'ROI',
  ].flatMap((subject) => [
    '未知',
    '待核验',
    '无公开证据',
    '暂无数据',
    '尚不清楚',
    '未披露',
  ].map((marker) => `${subject}${marker}`)),
  ...[
    'Revenue',
    'Profit',
    'Conversion rate',
    'Deal rate',
    'Repurchase rate',
  ].flatMap((subject) => [
    `${subject} is unavailable`,
    `${subject} is not publicly disclosed`,
  ]),
  'GMV不代表利润',
  '收入不能证明成交表现',
  '收入并非利润',
  'Revenue does not prove profit',
  '截至2025年收入未知',
  '截止2026年利润暂无数据',
  'Revenue for 2025 is unavailable',
  'Profit as-of 2026 is not publicly disclosed',
]);

function classify(text, context) {
  assert.equal(
    typeof classifier.module?.classifyPrivatePerformanceText,
    'function',
    classifier.error?.message ?? 'private performance classifier missing',
  );
  return classifier.module.classifyPrivatePerformanceText(text, { context });
}

function trusted(candidate, root = fixtureRoot) {
  return {
    expectedIdentity,
    projectRoot: root,
    expectedUpstream: {
      artifactId: 'growth-opportunity-brief',
      version: 1,
      sha256: candidate.scope.upstreamArtifact.sha256,
    },
    expectedKnowledgeReceipt: {
      relativePath: candidate.knowledgeContext.evidencePath,
      status: candidate.knowledgeContext.status,
      sha256: candidate.knowledgeContext.evidenceSha256,
    },
    referenceAt: '2026-07-30T23:59:59.000Z',
  };
}

function validate(candidate, root = fixtureRoot) {
  assert.equal(
    typeof contract.module?.validateCompetitiveBenchmarkV2Candidate,
    'function',
    contract.error?.message ?? 'competitive benchmark validator missing',
  );
  return contract.module.validateCompetitiveBenchmarkV2Candidate(
    candidate,
    trusted(candidate, root),
  );
}

function bindPublicEvidenceText(t, candidate, text) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbv2-round8-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fixtureRoot, root, { recursive: true });
  const sourceRelative = candidate.evidence[0].sourcePath;
  const sourcePath = path.join(root, ...sourceRelative.split('/'));
  const sourceBytes = Buffer.concat([
    readFileSync(sourcePath),
    Buffer.from(`\n${text}\n`, 'utf8'),
  ]);
  writeFileSync(sourcePath, sourceBytes);
  const sourceSha256 = createHash('sha256')
    .update(sourceBytes)
    .digest('hex');
  for (const evidence of candidate.evidence) {
    if (evidence.sourcePath === sourceRelative) {
      evidence.sourceSha256 = sourceSha256;
    }
  }
  return root;
}

function browserExecution(notes) {
  return {
    stepId: 'source-validation',
    policyId: 'competitive-benchmark-read-only-research-v1',
    used: true,
    action: 'read_page',
    externalWrite: false,
    loginBypass: false,
    timelinePath:
      'temp/browser-research/ent-benchmark/20260730-001-benchmark/task-benchmark/run-benchmark/source-validation.json',
    notes,
    continuousActionStandard:
      'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md',
    controller: 'scripts/browser_continuous_action_controller.mjs',
  };
}

const PERSISTENT_ENTRIES = Object.freeze([
  ['evidence-scope-fact', (candidate, text) => {
    candidate.evidence[3].claim = text;
  }],
  ['transfer-hypothesis', (candidate, text) => {
    candidate.transfers[0].experiment.hypothesis = text;
  }],
  ['review-hypothesis', (candidate, text) => {
    candidate.review.decisionRules[0] = text;
  }],
  ['debug-hypothesis', (candidate, text) => {
    candidate.debugReport.diagnostics[0].recoveryAction = text;
  }],
]);

test('第八轮固定72样本并形成360次跨入口质量矩阵', () => {
  assert.equal(NO_METRIC_EXTERNAL_ASSERTIONS.length, 22);
  assert.equal(ARBITRARY_CHINESE_UNKNOWN_SUBJECTS.length, 7);
  assert.equal(SYMBOL_RESIDUE_ATTACKS.length, 12);
  assert.equal(EXACT_NEW_UNKNOWN_FORMS.length, 5);
  assert.equal(SAFE_CROSS_ENTRY_REGRESSIONS.length, 26);
  assert.equal(QUALITY_CASES.length, 72);
  assert.equal(QUALITY_CASES.length * 5, 360);
});

test('分类器拒绝41个结构攻击并允许31个完整安全语句', () => {
  for (const { text, allowed } of QUALITY_CASES) {
    const context = allowed ? 'unknown' : 'hypothesis';
    const result = classify(text, context);
    assert.equal(result.prohibitedAssertion, !allowed, text);
  }
});

for (const [entry, mutate] of PERSISTENT_ENTRIES) {
  test(`${entry}执行第八轮72样本质量矩阵`, () => {
    for (const { text, allowed } of QUALITY_CASES) {
      const candidate = structuredClone(baseCandidate);
      mutate(candidate, text);
      if (allowed) {
        assert.doesNotThrow(() => validate(candidate), `${entry}: ${text}`);
      } else {
        assert.throws(
          () => validate(candidate),
          /private performance|private metric|text audit/u,
          `${entry}: ${text}`,
        );
      }
    }
  });
}

test('browser inference执行第八轮72样本质量矩阵', () => {
  for (const { text, allowed } of QUALITY_CASES) {
    const execution = browserExecution(text);
    if (allowed) {
      assert.doesNotThrow(
        () => planner.module.validateBrowserResearchExecution(
          execution,
          { expectedIdentity },
        ),
        `browser: ${text}`,
      );
    } else {
      assert.throws(
        () => planner.module.validateBrowserResearchExecution(
          execution,
          { expectedIdentity },
        ),
        /notes|private performance/u,
        `browser: ${text}`,
      );
    }
  }
});

test('public_fact只保留来源绑定的公开可观察动作', (t) => {
  for (const safeFact of [
    'A每周公开3篇公众号文章。',
    'B公开运营小红书清单内容。',
    'C每月举办1场公开课。',
  ]) {
    const direct = classify(safeFact, 'public_fact');
    assert.equal(direct.metricDetected, false, safeFact);
    assert.equal(direct.prohibitedAssertion, false, safeFact);

    const candidate = structuredClone(baseCandidate);
    candidate.evidence[0].claim = safeFact;
    const root = bindPublicEvidenceText(t, candidate, safeFact);
    assert.doesNotThrow(() => validate(candidate, root), safeFact);
  }

  const unsafeFact = 'Competitor dominates.';
  const candidate = structuredClone(baseCandidate);
  candidate.evidence[0].claim = unsafeFact;
  const root = bindPublicEvidenceText(t, candidate, unsafeFact);
  assert.throws(
    () => validate(candidate, root),
    /private performance|private metric|text audit/u,
  );
});

test('非public入口只允许锚定公开动作、机制推断和内部规则正例', () => {
  const safeByContext = [
    ['A按周发布文章并公开资料包，B按周发布清单并引导私信。', 'inference'],
    ['连续、结构化的公开内容可能形成稳定的信息入口。', 'inference'],
    ['替代样本D是不新增竞品式内容动作、只保留企业现有公开资料承接的比较基线。', 'scope_fact'],
    ['企业内部未来实验将比较原创主题卡片方案与现有公开资料承接方案的内部模拟路径完成数。', 'hypothesis'],
    ['主指标达到目标且护栏无异常时申请扩大验证。', 'hypothesis'],
    ['若后续获得同口径公开证据，按新版本追加，不覆盖当前候选。', 'hypothesis'],
  ];
  for (const [text, context] of safeByContext) {
    const result = classify(text, context);
    assert.equal(result.metricDetected, false, text);
    assert.equal(result.prohibitedAssertion, false, text);
  }
});

test('新增完整未知同义语法保持60个正常组合', () => {
  assert.equal(NORMAL_60.length, 60);
  for (const safeText of NORMAL_60) {
    const result = classify(safeText, 'unknown');
    assert.equal(result.metricDetected, true, safeText);
    assert.equal(result.prohibitedAssertion, false, safeText);
  }
});

test('256轮确定性fuzz拒绝主语残余外部结论符号和数值注入', () => {
  const bases = [
    '收入未知',
    'GMV不代表利润',
    'Revenue is unavailable',
    'Profit is not publicly disclosed',
    '利润尚不清楚',
  ];
  const residues = [
    '行业标杆',
    '市场王者',
    'competitor',
    '竞品稳居榜首',
    'Competitor dominates',
    'peer outperforms',
    '+',
    '↑',
    '↗',
    '🚀',
    '/',
    '→',
    '↘',
    '%',
    '99%',
    '3倍',
    '3x',
    '42',
  ];
  const separators = ['', '。', '；', ' / ', '\u2060', ' → '];
  let state = 0x8a11ce;
  const generated = [];
  for (let index = 0; index < 256; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const base = bases[state % bases.length];
    state = (state * 1664525 + 1013904223) >>> 0;
    const residue = residues[state % residues.length];
    state = (state * 1664525 + 1013904223) >>> 0;
    const separator = separators[state % separators.length];
    const phrase = (state & 1) === 0
      ? `${residue}${separator}${base}`
      : `${base}${separator}${residue}`;
    generated.push(phrase);
    const result = classify(phrase, 'hypothesis');
    assert.equal(result.prohibitedAssertion, true, phrase);
  }
  assert.equal(generated.length, 256);

  for (const [text, context] of [
    ['A每周公开3篇公众号文章。', 'public_fact'],
    ['B公开运营小红书清单内容。', 'public_fact'],
    ['连续公开内容可能形成稳定的信息入口。', 'inference'],
    ['结构化目录可能降低公开信息查找成本。', 'inference'],
  ]) {
    assert.equal(
      classify(text, context).prohibitedAssertion,
      false,
      text,
    );
  }
});

test('round2h正式候选仍可作为第八轮最小正向结构', () => {
  assert.doesNotThrow(() => validate(structuredClone(round2hCandidate)));
});

test('Skill与Workflow声明第八轮机器合同', () => {
  for (const [label, text] of [
    ['Skill', skillText],
    ['Workflow', workflowText],
  ]) {
    assert.match(text, /public_fact.*scope_fact|scope_fact.*public_fact/isu, label);
    assert.match(text, /无指标.*外部.*经营.*默认拒绝/u, label);
    assert.match(text, /结构化.*(?:样本|竞品).*主语/u, label);
    assert.match(text, /句末.*[。.!?！？;；].*空白/isu, label);
    assert.match(text, /Unicode.*符号.*不得.*移除|[+↑↗🚀].*不得.*移除/isu, label);
    assert.match(text, /暂无数据.*尚不清楚.*未披露/isu, label);
    assert.match(text, /is unavailable.*not publicly disclosed/isu, label);
  }
});
