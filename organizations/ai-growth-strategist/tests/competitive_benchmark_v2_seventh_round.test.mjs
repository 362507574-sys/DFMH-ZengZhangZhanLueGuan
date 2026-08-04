import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

const NO_METRIC_RESIDUAL_ATTACKS = Object.freeze([
  '收入未知。竞品稳居榜首。',
  '利润无公开证据；竞争对手称霸行业。',
  'GMV待核验 / 该竞品位居首位。',
  'Revenue is unknown. Competitor dominates the category.',
  'Profit has no public evidence / competitor ranks second.',
  '收入不能证明利润——对手傲视同业。',
  'Revenue does not prove profit | peer outperforms the category.',
]);
const NEUTRAL_COMBINATION_ATTACKS = Object.freeze([
  '竞品收入提高未知。',
  '竞品利润改善待核验。',
  '竞品GMV下降无公开证据。',
  'Competitor revenue increase unknown.',
  'Competitor profit improve to be verified.',
]);
const IMPROVE_VARIANT_ATTACKS = Object.freeze([
  'Competitor revenue improve to be verified.',
  'Competitor revenue improves — unknown.',
  'Competitor revenue improved — unknown.',
  'Competitor revenue is improving — unknown.',
  'Competitor revenue improvement is unknown.',
  'Internal future competitor profit increase unknown.',
]);
const ATTACKS = Object.freeze([
  ...NO_METRIC_RESIDUAL_ATTACKS,
  ...NEUTRAL_COMBINATION_ATTACKS,
  ...IMPROVE_VARIANT_ATTACKS,
]);
const SAFE_COMMON = Object.freeze([
  'GMV不代表利润。',
  '收入不能证明成交表现。',
  'Revenue does not prove profit.',
  '收入并非利润。',
  '截至2026年收入未知。',
  'Revenue for 2026 is unknown.',
  '收入未知、利润未知。',
  '收入和利润均未知。',
]);
const SAFE_BOUNDARY_INFERENCE = Object.freeze([
  '不推断竞品私有成交表现。',
]);
const SAFE_INTERNAL_HYPOTHESIS =
  '企业内部未来实验假设本企业收入可能提高，待内部验证。';
const UNSAFE_HYPOTHESIS_SUBJECTS = Object.freeze([
  'Future competitor revenue improve to be verified.',
  'Internal future competitor profit increase unknown.',
]);

function classify(text, context = 'inference') {
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

function bindEvidenceText(t, candidate, text) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbv2-round7-'));
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

const CANDIDATE_MUTATIONS = Object.freeze([
  ['evidence', (candidate, text) => {
    candidate.evidence[0].claim = text;
  }],
  ['transfer', (candidate, text) => {
    candidate.transfers[0].experiment.hypothesis = text;
  }],
  ['review', (candidate, text) => {
    candidate.review.decisionRules[0] = text;
  }],
  ['debug', (candidate, text) => {
    candidate.debugReport.diagnostics[0].recoveryAction = text;
  }],
]);

for (const [group, attacks] of [
  ['无metric残余', NO_METRIC_RESIDUAL_ATTACKS],
  ['neutral组合', NEUTRAL_COMBINATION_ATTACKS],
  ['improve变体', IMPROVE_VARIANT_ATTACKS],
]) {
  test(`${group}全部被统一分类器拒绝`, () => {
    for (const attack of attacks) {
      const context = /future|internal/iu.test(attack)
        ? 'hypothesis'
        : 'unknown';
      const result = classify(attack, context);
      assert.equal(result.metricDetected, true, attack);
      assert.equal(result.prohibitedAssertion, true, attack);
    }
  });
}

for (const [field, mutate] of CANDIDATE_MUTATIONS) {
  test(`${field}拒绝第七轮全部固定攻击`, (t) => {
    for (const attack of ATTACKS) {
      const candidate = structuredClone(baseCandidate);
      mutate(candidate, attack);
      const root = field === 'evidence'
        ? bindEvidenceText(t, candidate, attack)
        : fixtureRoot;
      assert.throws(
        () => validate(candidate, root),
        /private performance|private metric|text audit/u,
        `${field}: ${attack}`,
      );
    }
  });
}

test('browser notes拒绝第七轮全部固定攻击', () => {
  for (const attack of ATTACKS) {
    assert.throws(
      () => planner.module.validateBrowserResearchExecution(
        browserExecution(attack),
        { expectedIdentity },
      ),
      /notes|private performance/u,
      attack,
    );
  }
});

test('hypothesis上下文先拒绝竞品主体而不接受unknown或denial覆盖', () => {
  for (const attack of UNSAFE_HYPOTHESIS_SUBJECTS) {
    const result = classify(attack, 'hypothesis');
    assert.equal(result.metricDetected, true, attack);
    assert.equal(result.prohibitedAssertion, true, attack);
  }
  for (const [field, mutate] of CANDIDATE_MUTATIONS.slice(1)) {
    for (const attack of UNSAFE_HYPOTHESIS_SUBJECTS) {
      const candidate = structuredClone(baseCandidate);
      mutate(candidate, attack);
      assert.throws(
        () => validate(candidate),
        /private performance|private metric|text audit/u,
        `${field}: ${attack}`,
      );
    }
  }
});

test('property fuzz在安全句前后注入非安全残余后全部失败关闭', () => {
  const bases = [
    ['收入未知', 'unknown'],
    ['Revenue is unknown', 'unknown'],
    ['GMV不代表利润', 'inference'],
    ['Revenue does not prove profit', 'inference'],
  ];
  const residuals = [
    '竞品稳居榜首',
    '对手称霸行业',
    '遥遥领先',
    'competitor dominates',
    'peer improves',
    'ranks second',
    '42',
    '18%',
    'profit increased',
  ];
  const separators = [
    '。',
    ' / ',
    '——',
    '→',
    '\u2060',
    ' | ',
    '；',
  ];
  let state = 0x7a11ce;
  for (let index = 0; index < 128; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const [base, context] = bases[state % bases.length];
    state = (state * 1664525 + 1013904223) >>> 0;
    const residual = residuals[state % residuals.length];
    state = (state * 1664525 + 1013904223) >>> 0;
    const separator = separators[state % separators.length];
    const phrase = (state & 1) === 0
      ? `${residual}${separator}${base}`
      : `${base}${separator}${residual}`;
    const result = classify(phrase, context);
    assert.equal(result.metricDetected, true, phrase);
    assert.equal(result.prohibitedAssertion, true, phrase);
  }
});

test('property fuzz抽样攻击贯穿五个持久化入口', (t) => {
  const generated = [
    '收入未知\u2060竞品稳居榜首',
    'Revenue is unknown / competitor dominates',
    '18%——利润未知',
    'GMV不代表利润→peer improves',
    'profit increased | Revenue does not prove profit',
  ];
  for (const [field, mutate] of CANDIDATE_MUTATIONS) {
    for (const attack of generated) {
      const candidate = structuredClone(baseCandidate);
      mutate(candidate, attack);
      const root = field === 'evidence'
        ? bindEvidenceText(t, candidate, attack)
        : fixtureRoot;
      assert.throws(
        () => validate(candidate, root),
        /private performance|private metric|text audit/u,
        `${field}: ${attack}`,
      );
    }
  }
  for (const attack of generated) {
    assert.throws(
      () => planner.module.validateBrowserResearchExecution(
        browserExecution(attack),
        { expectedIdentity },
      ),
      /notes|private performance/u,
      `browser: ${attack}`,
    );
  }
});

test('关系否定、合理年份和完整未知句式允许通过', () => {
  for (const safeText of SAFE_COMMON) {
    const result = classify(safeText, 'unknown');
    assert.equal(result.metricDetected, true, safeText);
    assert.equal(result.prohibitedAssertion, false, safeText);
  }
});

test('关系否定、合理年份和完整未知贯穿五个持久化入口', (t) => {
  for (const safeText of SAFE_COMMON) {
    for (const [field, mutate] of CANDIDATE_MUTATIONS) {
      const candidate = structuredClone(baseCandidate);
      mutate(candidate, safeText);
      const root = field === 'evidence'
        ? bindEvidenceText(t, candidate, safeText)
        : fixtureRoot;
      assert.doesNotThrow(
        () => validate(candidate, root),
        `${field}: ${safeText}`,
      );
    }
    assert.doesNotThrow(
      () => planner.module.validateBrowserResearchExecution(
        browserExecution(safeText),
        { expectedIdentity },
      ),
      `browser: ${safeText}`,
    );
  }
});

test('边界否定只在非hypothesis入口允许', (t) => {
  for (const safeText of SAFE_BOUNDARY_INFERENCE) {
    const direct = classify(safeText, 'inference');
    assert.equal(direct.prohibitedAssertion, false, safeText);

    const evidenceCandidate = structuredClone(baseCandidate);
    evidenceCandidate.evidence[0].claim = safeText;
    const root = bindEvidenceText(t, evidenceCandidate, safeText);
    assert.doesNotThrow(() => validate(evidenceCandidate, root));

    assert.doesNotThrow(
      () => planner.module.validateBrowserResearchExecution(
        browserExecution(safeText),
        { expectedIdentity },
      ),
    );

    const hypothesis = classify(safeText, 'hypothesis');
    assert.equal(hypothesis.prohibitedAssertion, true, safeText);
  }
});

test('企业内部未来实验只在hypothesis上下文允许', () => {
  const safe = classify(SAFE_INTERNAL_HYPOTHESIS, 'hypothesis');
  assert.equal(safe.metricDetected, true);
  assert.equal(safe.prohibitedAssertion, false);

  for (const [field, mutate] of CANDIDATE_MUTATIONS.slice(1)) {
    const candidate = structuredClone(baseCandidate);
    mutate(candidate, SAFE_INTERNAL_HYPOTHESIS);
    assert.doesNotThrow(() => validate(candidate), field);
  }

  const inference = classify(SAFE_INTERNAL_HYPOTHESIS, 'inference');
  assert.equal(inference.prohibitedAssertion, true);
});

test('不合理年份、普通数字和百分比不能借unknown逃逸', () => {
  for (const attack of [
    '收入2026未知。',
    '竞品收入截至9999年未知。',
    'Revenue 2026 is unknown.',
    'Revenue for 3026 is unknown.',
    '收入42未知。',
    '利润18%未知。',
  ]) {
    const result = classify(attack, 'unknown');
    assert.equal(result.metricDetected, true, attack);
    assert.equal(result.prohibitedAssertion, true, attack);
  }
});

test('现有正式候选保持可校验', () => {
  assert.doesNotThrow(() => validate(structuredClone(baseCandidate)));
});

test('Skill和Workflow固化整段锚定消费并删除安全词袋模型', () => {
  for (const [label, text] of [
    ['Skill', skillText],
    ['Workflow', workflowText],
  ]) {
    assert.match(text, /整段.*完整消费|完整消费.*整段/u, label);
    assert.match(text, /未消费.*残余.*失败关闭/u, label);
    assert.match(text, /无指标.*片段.*不得丢弃/u, label);
    assert.match(text, /关系否定/u, label);
    assert.match(text, /截至.*年份|as-of|for 2026/iu, label);
    assert.match(text, /不再使用.*(?:安全)?词袋|删除.*(?:安全)?词袋/u, label);
  }
});
