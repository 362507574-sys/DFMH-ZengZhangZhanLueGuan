import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

function validate(value, root = fixtureRoot) {
  assert.equal(
    typeof loaded.module?.validateCompetitiveBenchmarkV2Candidate,
    'function',
    loaded.error?.message ?? 'competitive benchmark v2 validator missing',
  );
  return loaded.module?.validateCompetitiveBenchmarkV2Candidate(value, {
    expectedIdentity,
    projectRoot: root,
    expectedUpstream: {
      artifactId: 'growth-opportunity-brief',
      version: 1,
      sha256: baseCandidate.scope.upstreamArtifact.sha256,
    },
    expectedKnowledgeReceipt: {
      relativePath: value.knowledgeContext.evidencePath,
      status: value.knowledgeContext.status,
      sha256: value.knowledgeContext.evidenceSha256,
    },
    referenceAt: '2026-07-30T23:59:59.000Z',
  });
}

function tempCase(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbv2-hardening-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fixtureRoot, root, { recursive: true });
  return { root, candidate: structuredClone(baseCandidate) };
}

function absolute(root, relative) {
  return path.join(root, ...relative.split('/'));
}

function writeAndBind(root, relative, body, bindSha) {
  const target = absolute(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  const bytes = Buffer.from(body, 'utf8');
  writeFileSync(target, bytes);
  bindSha(createHash('sha256').update(bytes).digest('hex'));
}

function receiptFor(candidate, status = candidate.knowledgeContext.status) {
  return {
    schemaVersion: 2,
    enterpriseId: candidate.enterpriseId,
    businessProjectId: candidate.businessProjectId,
    taskId: candidate.taskId,
    runId: candidate.runId,
    capabilityId: candidate.capabilityId,
    status,
    query: '竞争对标 内容机制 获客渠道 可观察客户路径',
    sources: [],
    limitations: ['固定场景只读检索凭证。'],
  };
}

test('上游拒绝普通文本自报SHA以及合法但不同版本', (t) => {
  const plain = tempCase(t);
  writeAndBind(
    plain.root,
    plain.candidate.scope.upstreamArtifact.path,
    'ordinary text with a self-reported hash',
    (sha) => { plain.candidate.scope.upstreamArtifact.sha256 = sha; },
  );
  assert.throws(
    () => validate(plain.candidate, plain.root),
    /upstream.*JSON|artifact|published|fields/u,
  );

  const other = tempCase(t);
  const originalPath = other.candidate.scope.upstreamArtifact.path;
  const artifact = JSON.parse(readFileSync(
    absolute(other.root, originalPath),
    'utf8',
  ));
  artifact.version = 2;
  other.candidate.scope.upstreamArtifact.version = 2;
  other.candidate.scope.upstreamArtifact.path =
    originalPath.replace('/v1.json', '/v2.json');
  writeAndBind(
    other.root,
    other.candidate.scope.upstreamArtifact.path,
    `${JSON.stringify(artifact)}\n`,
    (sha) => { other.candidate.scope.upstreamArtifact.sha256 = sha; },
  );
  assert.throws(
    () => validate(other.candidate, other.root),
    /expected upstream|artifact.*version|artifact.*SHA/u,
  );
});

test('receipt三种真实状态可过但状态或身份不一致拒绝', (t) => {
  for (const status of ['matched', 'no_hit', 'degraded']) {
    const current = tempCase(t);
    current.candidate.knowledgeContext.status = status;
    const receipt = receiptFor(current.candidate, status);
    if (status === 'matched') {
      const sourceRelative =
        `business-projects/${current.candidate.enterpriseId}/${current.candidate.businessProjectId}/organizations/ai-growth-strategist/runs/${current.candidate.runId}/evidence/knowledge-sources/match-1.txt`;
      receipt.sources = [{
        relativePath: sourceRelative,
        sha256: createHash('sha256')
          .update(Buffer.from('matched knowledge source\n', 'utf8'))
          .digest('hex'),
      }];
      writeAndBind(
        current.root,
        sourceRelative,
        'matched knowledge source\n',
        () => {},
      );
    }
    writeAndBind(
      current.root,
      current.candidate.knowledgeContext.evidencePath,
      `${JSON.stringify(receipt)}\n`,
      (sha) => { current.candidate.knowledgeContext.evidenceSha256 = sha; },
    );
    assert.doesNotThrow(
      () => validate(current.candidate, current.root),
      status,
    );
  }

  const mismatch = tempCase(t);
  writeAndBind(
    mismatch.root,
    mismatch.candidate.knowledgeContext.evidencePath,
    `${JSON.stringify(receiptFor(mismatch.candidate, 'matched'))}\n`,
    (sha) => { mismatch.candidate.knowledgeContext.evidenceSha256 = sha; },
  );
  assert.throws(
    () => validate(mismatch.candidate, mismatch.root),
    /receipt.*status|knowledge.*status/u,
  );

  const identity = tempCase(t);
  const forged = receiptFor(identity.candidate);
  forged.runId = 'run-forged';
  writeAndBind(
    identity.root,
    identity.candidate.knowledgeContext.evidencePath,
    `${JSON.stringify(forged)}\n`,
    (sha) => { identity.candidate.knowledgeContext.evidenceSha256 = sha; },
  );
  assert.throws(
    () => validate(identity.candidate, identity.root),
    /receipt.*runId|identity.*runId/u,
  );
});

test('source未来时间拒绝且文件link与父目录junction不能逃逸', (t) => {
  const future = structuredClone(baseCandidate);
  future.evidence[0].observedAt = '2999-01-01T00:00:00.000Z';
  assert.throws(
    () => validate(future),
    /future|observedAt|reference/u,
  );

  const linked = tempCase(t);
  const sourcePath = absolute(
    linked.root,
    linked.candidate.evidence[0].sourcePath,
  );
  const target = path.join(linked.root, 'outside-source.txt');
  writeFileSync(target, readFileSync(sourcePath));
  rmSync(sourcePath);
  symlinkSync(target, sourcePath, 'file');
  assert.throws(
    () => validate(linked.candidate, linked.root),
    /link|symlink|junction|reparse/u,
  );

  if (process.platform === 'win32') {
    const junction = tempCase(t);
    const source = absolute(
      junction.root,
      junction.candidate.evidence[0].sourcePath,
    );
    const sourcesPath = path.dirname(source);
    const outside = mkdtempSync(path.join(os.tmpdir(), 'cbv2-source-outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(path.join(outside, path.basename(source)), readFileSync(source));
    rmSync(sourcesPath, { recursive: true, force: true });
    symlinkSync(outside, sourcesPath, 'junction');
    assert.throws(
      () => validate(junction.candidate, junction.root),
      /link|symlink|junction|reparse|outside/u,
    );
  }
});

test('upstream与receipt文件link及receipt父目录junction拒绝', (t) => {
  const upstream = tempCase(t);
  const upstreamPath = absolute(
    upstream.root,
    upstream.candidate.scope.upstreamArtifact.path,
  );
  const upstreamTarget = path.join(upstream.root, 'outside-upstream.json');
  writeFileSync(upstreamTarget, readFileSync(upstreamPath));
  rmSync(upstreamPath);
  symlinkSync(upstreamTarget, upstreamPath, 'file');
  assert.throws(
    () => validate(upstream.candidate, upstream.root),
    /upstream.*(?:link|symlink|junction|reparse)/u,
  );

  const receipt = tempCase(t);
  const receiptPath = absolute(
    receipt.root,
    receipt.candidate.knowledgeContext.evidencePath,
  );
  const receiptTarget = path.join(receipt.root, 'outside-receipt.json');
  writeFileSync(receiptTarget, readFileSync(receiptPath));
  rmSync(receiptPath);
  symlinkSync(receiptTarget, receiptPath, 'file');
  assert.throws(
    () => validate(receipt.candidate, receipt.root),
    /knowledge.*(?:link|symlink|junction|reparse)|receipt.*(?:link|symlink|junction|reparse)/u,
  );

  if (process.platform === 'win32') {
    const parent = tempCase(t);
    const currentReceipt = absolute(
      parent.root,
      parent.candidate.knowledgeContext.evidencePath,
    );
    const evidenceDirectory = path.dirname(currentReceipt);
    const outside = mkdtempSync(path.join(os.tmpdir(), 'cbv2-receipt-outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    cpSync(evidenceDirectory, outside, { recursive: true });
    rmSync(evidenceDirectory, { recursive: true, force: true });
    symlinkSync(outside, evidenceDirectory, 'junction');
    assert.throws(
      () => validate(parent.candidate, parent.root),
      /knowledge.*(?:link|symlink|junction|reparse|outside)|receipt.*(?:link|symlink|junction|reparse|outside)/u,
    );
  }
});

test('三栏规范化后不得相互重复且推断不得伪装事实', () => {
  const overlap = structuredClone(baseCandidate);
  const layer = overlap.samples[0].layers.positioning;
  layer.publicFacts = ['Same claim。'];
  layer.inferences = [' same   claim '];
  layer.unknowns = ['SAME CLAIM'];
  assert.throws(
    () => validate(overlap),
    /overlap|duplicate|publicFacts|inferences|unknowns/u,
  );

  const disguised = structuredClone(baseCandidate);
  disguised.samples[0].layers.positioning.publicFacts = [
    '可能是行业第一，因此推测最有效。',
  ];
  assert.throws(
    () => validate(disguised),
    /public fact|inference|可能|推测/u,
  );
});

test('候选诊断固定code到severity/status并从来源时效重算', () => {
  const fakeBlocking = structuredClone(baseCandidate);
  fakeBlocking.debugReport.diagnostics = [{
    code: 'private_performance_claim',
    severity: 'info',
    affectedSample: 'sample-a',
    explanation: '伪装为信息。',
    recoveryAction: '无。',
  }];
  assert.throws(
    () => validate(fakeBlocking),
    /private_performance_claim|severity|blocked/u,
  );

  const stale = structuredClone(baseCandidate);
  for (const evidence of stale.evidence) {
    evidence.observedAt = '2020-01-01T00:00:00.000Z';
  }
  stale.debugReport.status = 'passed';
  stale.debugReport.remainingUnknowns = [];
  stale.debugReport.diagnostics = [{
    code: 'all_sources_current',
    severity: 'info',
    affectedSample: null,
    explanation: '全部来源当前有效。',
    recoveryAction: '继续。',
  }];
  assert.throws(
    () => validate(stale),
    /stale_source|warning|需处理|current/u,
  );
});

test('确定经营断言全拒绝且unknowns必须显式未知', () => {
  for (const phrase of [
    '月流水超过100万元。',
    'GMV 200万。',
    'ROAS 4.2。',
    '收入领先，利润很好，成交最强。',
  ]) {
    const value = structuredClone(baseCandidate);
    value.samples[0].layers.positioning.inferences = [phrase];
    assert.throws(
      () => validate(value),
      /private|performance|经营|unknown|收入|利润|成交|GMV|ROAS/u,
      phrase,
    );
  }
  const fakeUnknown = structuredClone(baseCandidate);
  fakeUnknown.samples[0].layers.positioning.unknowns = ['收入领先。'];
  assert.throws(
    () => validate(fakeUnknown),
    /unknown|未知|公开证据|待验证|收入/u,
  );
});
