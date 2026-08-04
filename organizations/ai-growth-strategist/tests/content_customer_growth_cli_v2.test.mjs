import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

const cliPath = path.join(
  organizationRoot,
  'scripts',
  'validate_candidate.mjs',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('候选门禁按 schemaVersion 分派内容客户增长 v2', () => {
  const result = spawnSync(process.execPath, [cliPath], {
    input: JSON.stringify({
      schemaVersion: 2,
      capabilityId: 'content-customer-growth',
    }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /trusted context|trusted.*flags/u);
  assert.doesNotMatch(result.stderr, /schemaVersion must be 1/u);
});

test('CLI 使用完整受信任身份、四个上游 SHA、飞书凭证和商业状态验证 v2', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-cli-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidate = JSON.parse(await readFile(path.join(
    organizationRoot,
    'tests',
    'fixtures',
    'content-customer-growth-v2-valid.json',
  ), 'utf8'));
  const businessRoot = path.join(
    root,
    'business-projects',
    candidate.enterpriseId,
    candidate.businessProjectId,
  );
  const flags = [];
  const artifactFlagNames = [
    'growth-opportunity',
    'benchmark',
    'brand',
    'deal-handoff',
  ];
  for (let index = 0; index < candidate.scope.upstreamArtifacts.length; index += 1) {
    const artifact = candidate.scope.upstreamArtifacts[index];
    const artifactPath = path.join(
      businessRoot,
      'shared-artifacts',
      artifact.artifactId,
      `v${artifact.version}.json`,
    );
    const bytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      status: 'published',
      artifactId: artifact.artifactId,
      version: artifact.version,
      enterpriseId: candidate.enterpriseId,
      businessProjectId: candidate.businessProjectId,
    }));
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, bytes);
    artifact.sha256 = sha256(bytes);
    artifact.path = path.relative(root, artifactPath).replaceAll('\\', '/');
    flags.push(
      `--expected-${artifactFlagNames[index]}-version`,
      String(artifact.version),
      `--expected-${artifactFlagNames[index]}-sha256`,
      artifact.sha256,
    );
  }
  const brand = candidate.scope.upstreamArtifacts[2];
  candidate.channelPlans.forEach((plan) => {
    plan.brandArtifact = structuredClone(brand);
  });
  candidate.dealHandoff.sourceArtifact = structuredClone(
    candidate.scope.upstreamArtifacts[3],
  );
  const runRoot = path.join(
    businessRoot,
    'organizations',
    'ai-growth-strategist',
    'runs',
    candidate.runId,
  );
  const sourcePath = path.join(
    runRoot,
    'evidence',
    'knowledge-sources',
    'source-001.md',
  );
  const sourceBytes = Buffer.from('飞书知识来源：专业、长期陪伴、不过度承诺。');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceBytes);
  const receiptPath = path.join(runRoot, 'evidence', 'knowledge-context.json');
  const receipt = {
    schemaVersion: 2,
    capabilityId: candidate.capabilityId,
    enterpriseId: candidate.enterpriseId,
    businessProjectId: candidate.businessProjectId,
    taskId: candidate.taskId,
    runId: candidate.runId,
    status: 'matched',
    query: '内容与客户增长',
    sources: [{
      relativePath: path.relative(root, sourcePath).replaceAll('\\', '/'),
      sha256: sha256(sourceBytes),
    }],
    limitations: ['仅用于候选，不执行外部动作。'],
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  await writeFile(receiptPath, receiptBytes);
  candidate.knowledgeContext = {
    status: 'matched',
    evidencePath: path.relative(root, receiptPath).replaceAll('\\', '/'),
    evidenceSha256: sha256(receiptBytes),
  };
  const result = spawnSync(process.execPath, [
    cliPath,
    '--expected-enterprise-id', candidate.enterpriseId,
    '--expected-business-project-id', candidate.businessProjectId,
    '--expected-task-id', candidate.taskId,
    '--expected-run-id', candidate.runId,
    '--project-root', root,
    ...flags,
    '--expected-receipt-relative-path', candidate.knowledgeContext.evidencePath,
    '--expected-receipt-status', candidate.knowledgeContext.status,
    '--expected-receipt-sha256', candidate.knowledgeContext.evidenceSha256,
    '--expected-price-status', 'finalized',
    '--expected-refund-rule-status', 'finalized',
    '--reference-at', '2026-07-31T00:00:00.000Z',
  ], {
    input: JSON.stringify(candidate),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    capabilityId: 'content-customer-growth',
    schemaVersion: 2,
    status: 'candidate',
  });
});
