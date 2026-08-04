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
  '收入未知 / 竞品利润最高。',
  '收入不代表全部情况——竞品利润领先。',
  '若收入下降→竞品GMV第一。',
  '收入未知（竞品利润最高）。',
  'Revenue is unknown / competitor profit is strongest.',
]);
const SAFE_DOUBLE_UNKNOWNS = Object.freeze([
  '收入未知 / 利润未知。',
  'Revenue is unknown / competitor profit is unknown.',
]);
const ATTACK_CONTEXTS = Object.freeze([
  'unknown',
  'unknown',
  'hypothesis',
  'unknown',
  'unknown',
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

function bindEvidenceAttack(t, candidate, attack) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbv2-round5-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fixtureRoot, root, { recursive: true });
  const sourceRelative = candidate.evidence[0].sourcePath;
  const sourcePath = path.join(root, ...sourceRelative.split('/'));
  const sourceBytes = Buffer.concat([
    readFileSync(sourcePath),
    Buffer.from(`\n${attack}\n`, 'utf8'),
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

for (const [index, attack] of ATTACKS.entries()) {
  test(`不可靠分隔攻击${index + 1}必须被统一分类器拒绝`, () => {
    const result = classify(attack, ATTACK_CONTEXTS[index]);
    assert.equal(result.metricDetected, true, attack);
    assert.equal(result.prohibitedAssertion, true, attack);
  });
}

test('中文和英文双未知即使使用不可靠分隔仍允许', () => {
  for (const safeText of SAFE_DOUBLE_UNKNOWNS) {
    const result = classify(safeText, 'unknown');
    assert.equal(result.metricDetected, true, safeText);
    assert.equal(result.explicitUnknown, true, safeText);
    assert.equal(result.prohibitedAssertion, false, safeText);
  }
});

const MUTATIONS = Object.freeze([
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

for (const [field, mutate] of MUTATIONS) {
  for (const [index, attack] of ATTACKS.entries()) {
    test(`${field}拒绝不可靠分隔攻击${index + 1}`, (t) => {
      const candidate = structuredClone(baseCandidate);
      mutate(candidate, attack);
      const root = field === 'evidence'
        ? bindEvidenceAttack(t, candidate, attack)
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
  test(`browser notes拒绝不可靠分隔攻击${index + 1}`, () => {
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

test('browser notes允许中文和英文双未知', () => {
  assert.equal(
    typeof planner.module?.validateBrowserResearchExecution,
    'function',
    planner.error?.message ?? 'browser research validator missing',
  );
  for (const safeText of SAFE_DOUBLE_UNKNOWNS) {
    assert.doesNotThrow(
      () => planner.module.validateBrowserResearchExecution(
        browserExecution(safeText),
        { expectedIdentity },
      ),
      safeText,
    );
  }
});

test('Skill和Workflow固化逐指标绑定与无法可靠切分时失败关闭', () => {
  for (const [label, text] of [
    ['Skill', skillText],
    ['Workflow', workflowText],
  ]) {
    assert.match(text, /逐(?:个|项)指标/u, label);
    assert.match(text, /无法可靠切分/u, label);
    assert.match(text, /失败关闭/u, label);
    assert.match(text, /领先.*最高.*第一.*strongest.*leading/iu, label);
  }
});
