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
const ATTACKS = Object.freeze([
  '竞品收入领先 —— 未知。',
  '竞品收入排名第二待核验。',
  'Competitor revenue is top tier — unknown.',
  '竞品利润冠军 —— 无公开证据。',
  '收入未知 / 竞品稳居榜首。',
  '收入不代表全部情况——竞品位居首位。',
  '若收入下降→竞品称霸行业。',
  'Revenue is unknown / competitor dominates the category.',
  '收入未知 / 竞品利\u200B润最高。',
  'Revenue is unknown / competitor pro\u200Dfit is strongest.',
]);
const ATTACK_CONTEXTS = Object.freeze([
  'unknown',
  'unknown',
  'unknown',
  'unknown',
  'unknown',
  'unknown',
  'hypothesis',
  'unknown',
  'unknown',
  'unknown',
]);
const SAFE_LOCAL_UNKNOWNS = Object.freeze([
  '收入未知。',
  '竞品利润无公开证据。',
  '收入待核验。',
  '无法判断竞品利润。',
  'Revenue is unknown.',
  'No public evidence for competitor profit.',
]);
const SAFE_SHARED_UNKNOWNS = Object.freeze([
  '收入和利润均未知。',
  '收入、利润明确均未知。',
  'Revenue and profit are both unknown.',
  'Both revenue and profit are unknown.',
]);
const SAFE_INTERNAL_HYPOTHESIS =
  '未来内部实验假设本企业收入可能提高，待内部验证。';
const CF_VARIANTS = Object.freeze([
  '\u00AD',
  '\u061C',
  '\u180E',
  '\u200B',
  '\u200C',
  '\u200D',
  '\u2060',
  '\u2066',
  '\u2069',
  '\uFEFF',
]);
const ASSERTION_RESIDUALS = Object.freeze([
  '稳居榜首',
  '位居首位',
  '排名第二',
  '称霸行业',
  '傲视同业',
  'dominates the category',
  'ranks second',
  'is top tier',
  'outperforms peers',
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
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbv2-round6-'));
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

for (const [index, attack] of ATTACKS.entries()) {
  test(`第六轮攻击${index + 1}必须被统一分类器拒绝`, () => {
    const result = classify(attack, ATTACK_CONTEXTS[index]);
    assert.equal(result.metricDetected, true, attack);
    assert.equal(result.prohibitedAssertion, true, attack);
  });
}

for (const [field, mutate] of CANDIDATE_MUTATIONS) {
  for (const [index, attack] of ATTACKS.entries()) {
    test(`${field}拒绝第六轮攻击${index + 1}`, (t) => {
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
    });
  }
}

for (const [index, attack] of ATTACKS.entries()) {
  test(`browser notes拒绝第六轮攻击${index + 1}`, () => {
    assert.equal(
      typeof planner.module?.validateBrowserResearchExecution,
      'function',
      planner.error?.message ?? 'browser research validator missing',
    );
    assert.throws(
      () => planner.module.validateBrowserResearchExecution(
        browserExecution(attack),
        { expectedIdentity },
      ),
      /notes|private performance/u,
      attack,
    );
  });
}

test('中英文逐指标未知和明确均未知通过统一分类器安全语法', () => {
  for (const safeText of [
    ...SAFE_LOCAL_UNKNOWNS,
    ...SAFE_SHARED_UNKNOWNS,
  ]) {
    const result = classify(safeText, 'unknown');
    assert.equal(result.metricDetected, true, safeText);
    assert.equal(result.explicitUnknown, true, safeText);
    assert.equal(result.prohibitedAssertion, false, safeText);
  }
});

test('中英文逐指标未知跨五入口按hypothesis主体硬边界处理', (t) => {
  for (const safeText of [
    ...SAFE_LOCAL_UNKNOWNS,
    ...SAFE_SHARED_UNKNOWNS,
  ]) {
    for (const [field, mutate] of CANDIDATE_MUTATIONS) {
      const candidate = structuredClone(baseCandidate);
      mutate(candidate, safeText);
      const root = field === 'evidence'
        ? bindEvidenceText(t, candidate, safeText)
        : fixtureRoot;
      const externalSubject = /竞品|竞争对手|competitor|peer/iu.test(safeText);
      if (field !== 'evidence' && externalSubject) {
        assert.throws(
          () => validate(candidate, root),
          /private performance|private metric|text audit/u,
          `${field}: ${safeText}`,
        );
      } else {
        assert.doesNotThrow(
          () => validate(candidate, root),
          `${field}: ${safeText}`,
        );
      }
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

test('未来内部实验假设允许但竞品主体支配结论拒绝', () => {
  const safe = classify(SAFE_INTERNAL_HYPOTHESIS, 'hypothesis');
  assert.equal(safe.metricDetected, true);
  assert.equal(safe.prohibitedAssertion, false);
  for (const attack of [
    '未来假设竞品收入可能称霸行业。',
    'Competitor profit might dominate the category in the future.',
  ]) {
    const result = classify(attack, 'hypothesis');
    assert.equal(result.metricDetected, true, attack);
    assert.equal(result.prohibitedAssertion, true, attack);
  }
});

test('未来内部实验假设通过候选而竞品主体假设被transfer拒绝', () => {
  const safeCandidate = structuredClone(baseCandidate);
  safeCandidate.transfers[0].experiment.hypothesis =
    SAFE_INTERNAL_HYPOTHESIS;
  assert.doesNotThrow(() => validate(safeCandidate));

  const unsafeCandidate = structuredClone(baseCandidate);
  unsafeCandidate.transfers[0].experiment.hypothesis =
    '未来假设竞品收入可能称霸行业。';
  assert.throws(
    () => validate(unsafeCandidate),
    /private performance|private metric|text audit/u,
  );
});

test('未逐条列出的Cf格式字符不能拆开中英文私有指标', () => {
  for (const format of CF_VARIANTS) {
    assert.match(format, /\p{Cf}/u);
    for (const phrase of [
      `竞品利${format}润最高。`,
      `Competitor pro${format}fit is strongest.`,
    ]) {
      const result = classify(phrase, 'unknown');
      assert.equal(result.metricDetected, true, JSON.stringify(phrase));
      assert.equal(result.prohibitedAssertion, true, JSON.stringify(phrase));
    }
  }
});

test('安全token删除后生成的竞争性同义残余全部失败关闭', () => {
  for (const residual of ASSERTION_RESIDUALS) {
    const phrase = /[A-Za-z]/u.test(residual)
      ? `Competitor revenue ${residual} — unknown.`
      : `竞品收入${residual}——未知。`;
    const result = classify(phrase, 'unknown');
    assert.equal(result.metricDetected, true, phrase);
    assert.equal(result.prohibitedAssertion, true, phrase);
  }
});

test('Skill和Workflow固化Unicode规范化与安全语法优先级', () => {
  for (const [label, text] of [
    ['Skill', skillText],
    ['Workflow', workflowText],
  ]) {
    assert.match(text, /NFKC/u, label);
    assert.match(text, /Cf|零宽格式字符/u, label);
    assert.match(text, /安全语法|safe[- ]grammar/iu, label);
    assert.match(text, /强断言.*优先/u, label);
    assert.match(text, /竞品主体.*假设.*拒绝/u, label);
  }
});
