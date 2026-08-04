import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/competitive_benchmark_v2_contract.mjs',
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
const expectedIdentity = Object.freeze({
  enterpriseId: 'ent-benchmark',
  businessProjectId: '20260730-001-benchmark',
  taskId: 'task-benchmark',
  runId: 'run-benchmark',
});
const expectedKnowledgeReceipt = Object.freeze({
  relativePath: baseCandidate.knowledgeContext.evidencePath,
  status: baseCandidate.knowledgeContext.status,
  sha256: baseCandidate.knowledgeContext.evidenceSha256,
});

function options(root = fixtureRoot) {
  return {
    expectedIdentity,
    projectRoot: root,
    expectedUpstream: {
      artifactId: 'growth-opportunity-brief',
      version: 1,
      sha256: baseCandidate.scope.upstreamArtifact.sha256,
    },
    expectedKnowledgeReceipt,
    referenceAt: '2026-07-30T23:59:59.000Z',
  };
}

function validate(candidate, trusted = options()) {
  assert.equal(
    typeof loaded.module?.validateCompetitiveBenchmarkV2Candidate,
    'function',
    loaded.error?.message ?? 'competitive benchmark v2 validator missing',
  );
  return loaded.module?.validateCompetitiveBenchmarkV2Candidate(
    candidate,
    trusted,
  );
}

function tempCase(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbv2-round3-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fixtureRoot, root, { recursive: true });
  return { root, candidate: structuredClone(baseCandidate) };
}

function absolute(root, relative) {
  return path.join(root, ...relative.split('/'));
}

test('外部trusted receipt是候选通过的必需权威输入', () => {
  assert.doesNotThrow(() => validate(structuredClone(baseCandidate)));
  const missing = options();
  delete missing.expectedKnowledgeReceipt;
  assert.throws(
    () => validate(structuredClone(baseCandidate), missing),
    /expected knowledge receipt|expectedKnowledgeReceipt|trusted receipt/u,
  );
});

test('结构合法receipt即使重算SHA也不能替换外部预期receipt', (t) => {
  const current = tempCase(t);
  const receiptPath = absolute(
    current.root,
    current.candidate.knowledgeContext.evidencePath,
  );
  const forged = JSON.parse(readFileSync(receiptPath, 'utf8'));
  forged.query = '伪造但结构合法的查询';
  const bytes = Buffer.from(`${JSON.stringify(forged)}\n`, 'utf8');
  writeFileSync(receiptPath, bytes);
  current.candidate.knowledgeContext.evidenceSha256 =
    createHash('sha256').update(bytes).digest('hex');
  assert.throws(
    () => validate(current.candidate, options(current.root)),
    /expected knowledge receipt.*SHA|trusted receipt.*SHA/u,
  );
});

test('receipt状态语义与真实匹配source必须一致', (t) => {
  for (const status of ['matched', 'no_hit', 'degraded']) {
    const current = tempCase(t);
    const receiptPath = absolute(
      current.root,
      current.candidate.knowledgeContext.evidencePath,
    );
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.status = status;
    current.candidate.knowledgeContext.status = status;
    const sourceRelative =
      `business-projects/${current.candidate.enterpriseId}/${current.candidate.businessProjectId}`
      + `/organizations/ai-growth-strategist/runs/${current.candidate.runId}`
      + '/evidence/knowledge-sources/match-1.txt';
    const sourceBytes = Buffer.from('matched knowledge source\n', 'utf8');
    receipt.sources = status === 'no_hit' ? [] : [{
      relativePath: sourceRelative,
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    }];
    receipt.limitations = status === 'matched'
      ? []
      : ['degraded or no-hit knowledge result'];
    if (status !== 'no_hit') {
      const source = absolute(current.root, receipt.sources[0].relativePath);
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, sourceBytes);
    }
    const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8');
    writeFileSync(receiptPath, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    current.candidate.knowledgeContext.evidenceSha256 = sha;
    const trusted = options(current.root);
    trusted.expectedKnowledgeReceipt = {
      relativePath: current.candidate.knowledgeContext.evidencePath,
      status,
      sha256: sha,
    };
    assert.doesNotThrow(() => validate(current.candidate, trusted), status);

    if (status === 'matched') {
      rmSync(absolute(current.root, receipt.sources[0].relativePath));
      assert.throws(
        () => validate(current.candidate, trusted),
        /knowledge.*source.*missing|real.*source/u,
      );
    }
  }
});

test('全路径文本审计拒绝evidence review transfer和debug中的私有业绩断言', () => {
  const attacks = [
    (candidate) => { candidate.evidence[0].claim = '竞品收入领先。'; },
    (candidate) => { candidate.review.baselineMetrics[0] = '竞品GMV第一。'; },
    (candidate) => { candidate.transfers[0].underlyingMechanism = '竞品流水100万。'; },
    (candidate) => { candidate.debugReport.diagnostics[0].explanation = '竞品利润最强。'; },
  ];
  for (const attack of attacks) {
    const candidate = structuredClone(baseCandidate);
    attack(candidate);
    assert.throws(
      () => validate(candidate),
      /private performance|private metric|text audit/u,
    );
  }
});

test('public_fact claim语义不能超出绑定source', () => {
  const candidate = structuredClone(baseCandidate);
  candidate.evidence[0].claim = 'A每周发布300篇公众号文章。';
  assert.throws(
    () => validate(candidate),
    /public.fact.*source|claim.*source/u,
  );
});

test('review拒绝额外字段且诊断样本必须真实存在', () => {
  const review = structuredClone(baseCandidate);
  review.review.summary = 'extra';
  assert.throws(() => validate(review), /review.*unexpected field/u);

  const diagnostic = structuredClone(baseCandidate);
  diagnostic.debugReport.diagnostics[0].affectedSample = 'sample-forged';
  assert.throws(
    () => validate(diagnostic),
    /affectedSample.*sample|unknown sample/u,
  );
});

test('warning不能伪装passed且必须保留remainingUnknowns', () => {
  const candidate = structuredClone(baseCandidate);
  candidate.debugReport.status = 'passed';
  candidate.debugReport.diagnostics = [{
    code: 'presence_is_not_effectiveness',
    severity: 'warning',
    affectedSample: 'sample-a',
    explanation: '渠道存在不等于有效。',
    recoveryAction: '补同口径公开证据。',
  }];
  candidate.debugReport.remainingUnknowns = [];
  assert.throws(
    () => validate(candidate),
    /warning.*passed|remainingUnknowns/u,
  );
});
