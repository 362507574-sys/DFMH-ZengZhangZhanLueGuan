import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

const cli = path.join(organizationRoot, 'scripts', 'validate_candidate.mjs');
const fixture = path.join(
  organizationRoot,
  'tests',
  'fixtures',
  'growth-opportunity-v2-valid.json',
);

test('v2 CLI拒绝候选自证身份并要求调用方可信上下文', async () => {
  const result = spawnSync(process.execPath, [cli], {
    input: await readFile(fixture),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /trusted context|expected-enterprise|project-root/u);
});

test('v2 CLI用外部身份与真实receipt通过并拒绝跨项目替换', async (t) => {
  const prepared = await prepare(t, 'matched');
  const accepted = run(prepared.candidate, prepared.args);
  assert.equal(accepted.status, 0, accepted.stderr);
  const replaced = structuredClone(prepared.candidate);
  replaced.businessProjectId = '20260730-999-other-project';
  const rejected = run(replaced, prepared.args);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /identity mismatch/u);
});

test('degraded与no_hit仍拒绝缺失或伪造receipt', async (t) => {
  for (const status of ['degraded', 'no_hit']) {
    const prepared = await prepare(t, status);
    prepared.candidate.knowledgeContext.evidenceSha256 = 'a'.repeat(64);
    const wrongSha = run(prepared.candidate, prepared.args);
    assert.equal(wrongSha.status, 1);
    assert.match(wrongSha.stderr, /SHA-256|SHA/u);
    await rm(prepared.receiptPath);
    const missing = run(prepared.candidate, prepared.args);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing|cannot be read/u);
  }
});

test('约207KB的v2候选在解析前被资源门禁拒绝', async (t) => {
  const prepared = await prepare(t, 'degraded');
  prepared.candidate.scope.constraints = Array.from(
    { length: 210 },
    (_, index) => `${index}-${'x'.repeat(990)}`,
  );
  const result = run(prepared.candidate, prepared.args);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /size|bytes|large/u);
});

test('v2 CLI拒绝重复flags与candidate伪造context字段', async (t) => {
  const prepared = await prepare(t, 'degraded');
  const duplicate = run(prepared.candidate, [
    ...prepared.args,
    '--project-root',
    prepared.args.at(-1),
  ]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /trusted context|duplicate|flags/u);
  prepared.candidate.expectedEnterpriseId = prepared.candidate.enterpriseId;
  const forged = run(prepared.candidate, prepared.args);
  assert.equal(forged.status, 1);
  assert.match(forged.stderr, /unexpected field/u);
});

test('低于200KB边界的合法v2候选仍可通过', async (t) => {
  const prepared = await prepare(t, 'degraded');
  prepared.candidate.scope.constraints = Array.from(
    { length: 175 },
    (_, index) => `${index}-${'x'.repeat(990)}`,
  );
  const bytes = Buffer.byteLength(JSON.stringify(prepared.candidate));
  assert.ok(bytes < 200 * 1024, `fixture unexpectedly ${bytes} bytes`);
  const result = run(prepared.candidate, prepared.args);
  assert.equal(result.status, 0, result.stderr);
});

async function prepare(t, status) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-cli-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidate = JSON.parse(await readFile(fixture, 'utf8'));
  const receiptPath = path.join(
    root,
    'business-projects',
    candidate.enterpriseId,
    candidate.businessProjectId,
    'organizations',
    'ai-growth-strategist',
    'runs',
    candidate.runId,
    'knowledge-context.json',
  );
  await mkdir(path.dirname(receiptPath), { recursive: true });
  const receipt = Buffer.from('{"status":"knowledge-preflight-receipt"}\n');
  await writeFile(receiptPath, receipt);
  candidate.knowledgeContext.status = status;
  candidate.knowledgeContext.evidenceSha256 = createHash('sha256')
    .update(receipt)
    .digest('hex');
  const args = [
    '--expected-enterprise-id', candidate.enterpriseId,
    '--expected-business-project-id', candidate.businessProjectId,
    '--expected-task-id', candidate.taskId,
    '--expected-run-id', candidate.runId,
    '--project-root', root,
  ];
  return { candidate, args, receiptPath };
}

function run(candidate, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    input: Buffer.from(JSON.stringify(candidate)),
    encoding: 'utf8',
  });
}
