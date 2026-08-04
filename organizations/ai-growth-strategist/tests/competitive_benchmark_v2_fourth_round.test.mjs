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

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function absolute(root, relative) {
  return path.join(root, ...relative.split('/'));
}

function trusted(candidate, root) {
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

function validate(candidate, options) {
  assert.equal(
    typeof loaded.module?.validateCompetitiveBenchmarkV2Candidate,
    'function',
    loaded.error?.message ?? 'competitive benchmark v2 validator missing',
  );
  return loaded.module?.validateCompetitiveBenchmarkV2Candidate(
    candidate,
    options,
  );
}

function tempCase(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbv2-round4-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fixtureRoot, root, { recursive: true });
  return { root, candidate: structuredClone(baseCandidate) };
}

function bindReceipt(current, status, sourceText = 'matched knowledge source\n') {
  const sourceRelative =
    `business-projects/${current.candidate.enterpriseId}/${current.candidate.businessProjectId}`
    + `/organizations/ai-growth-strategist/runs/${current.candidate.runId}`
    + '/evidence/knowledge-sources/match-1.txt';
  const sourceBytes = Buffer.from(sourceText, 'utf8');
  if (status !== 'no_hit') {
    const sourcePath = absolute(current.root, sourceRelative);
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, sourceBytes);
  }
  const receiptPath = absolute(
    current.root,
    current.candidate.knowledgeContext.evidencePath,
  );
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.status = status;
  receipt.sources = status === 'no_hit' ? [] : [{
    relativePath: sourceRelative,
    sha256: sha(sourceBytes),
  }];
  receipt.limitations = status === 'matched'
    ? []
    : ['knowledge retrieval was incomplete'];
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8');
  writeFileSync(receiptPath, receiptBytes);
  current.candidate.knowledgeContext.status = status;
  current.candidate.knowledgeContext.evidenceSha256 = sha(receiptBytes);
  return {
    sourceRelative,
    receipt,
    options: trusted(current.candidate, current.root),
  };
}

test('matched和degraded receipt source逐项绑定路径与实际字节SHA', (t) => {
  for (const status of ['matched', 'degraded']) {
    const current = tempCase(t);
    const binding = bindReceipt(current, status);
    assert.doesNotThrow(
      () => validate(current.candidate, binding.options),
      status,
    );

    writeFileSync(
      absolute(current.root, binding.sourceRelative),
      'same path but replaced bytes\n',
    );
    assert.throws(
      () => validate(current.candidate, binding.options),
      /knowledge matching source.*SHA|source.*SHA.*mismatch/u,
    );
  }
});

test('receipt source对象严格拒绝额外字段与普通数据攻击', (t) => {
  const current = tempCase(t);
  const binding = bindReceipt(current, 'matched');
  binding.receipt.sources[0].title = 'forged extra field';
  const receiptPath = absolute(
    current.root,
    current.candidate.knowledgeContext.evidencePath,
  );
  const bytes = Buffer.from(`${JSON.stringify(binding.receipt)}\n`, 'utf8');
  writeFileSync(receiptPath, bytes);
  current.candidate.knowledgeContext.evidenceSha256 = sha(bytes);
  const options = trusted(current.candidate, current.root);
  assert.throws(
    () => validate(current.candidate, options),
    /knowledge receipt source.*unexpected field/u,
  );
});

test('no_hit只允许空sources且matched不能再接受字符串路径', (t) => {
  const noHit = tempCase(t);
  bindReceipt(noHit, 'no_hit');
  assert.doesNotThrow(
    () => validate(noHit.candidate, trusted(noHit.candidate, noHit.root)),
  );

  const matched = tempCase(t);
  const binding = bindReceipt(matched, 'matched');
  binding.receipt.sources = [binding.sourceRelative];
  const receiptPath = absolute(
    matched.root,
    matched.candidate.knowledgeContext.evidencePath,
  );
  const bytes = Buffer.from(`${JSON.stringify(binding.receipt)}\n`, 'utf8');
  writeFileSync(receiptPath, bytes);
  matched.candidate.knowledgeContext.evidenceSha256 = sha(bytes);
  assert.throws(
    () => validate(
      matched.candidate,
      trusted(matched.candidate, matched.root),
    ),
    /knowledge receipt source.*object|plain data/u,
  );
});

test('局部未知不能掩护evidence transfer review和debug后续确定断言', () => {
  const attacks = [
    (candidate) => {
      candidate.evidence[0].claim = '竞品收入未知，竞品利润最高。';
    },
    (candidate) => {
      candidate.transfers[0].underlyingMechanism =
        '收入未知，竞品收入领先。';
    },
    (candidate) => {
      candidate.review.baselineMetrics[0] =
        '收入不代表全部情况，可是竞品利润领先。';
    },
    (candidate) => {
      candidate.debugReport.diagnostics[0].explanation =
        '若收入下降，竞品GMV第一。';
    },
  ];
  for (const attack of attacks) {
    const candidate = structuredClone(baseCandidate);
    attack(candidate);
    assert.throws(
      () => validate(candidate, trusted(candidate, fixtureRoot)),
      /private performance|private metric|text audit/u,
    );
  }
});
