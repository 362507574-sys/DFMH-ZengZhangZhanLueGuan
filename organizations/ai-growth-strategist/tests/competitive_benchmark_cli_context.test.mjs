import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

const cliPath = path.join(
  organizationRoot,
  'scripts',
  'validate_candidate.mjs',
);
const fixturePath = path.join(
  organizationRoot,
  'tests',
  'fixtures',
  'competitive-benchmark-v2-valid.json',
);
const v1Path = path.join(
  organizationRoot,
  'examples',
  'competitive-benchmark-analysis.demo.json',
);
const trustedArgs = [
  '--expected-enterprise-id', 'ent-benchmark',
  '--expected-business-project-id', '20260730-001-benchmark',
  '--expected-task-id', 'task-benchmark',
  '--expected-run-id', 'run-benchmark',
  '--project-root', path.join(
    organizationRoot,
    'fixtures',
    'cbv2-proof-root',
  ),
  '--expected-upstream-artifact-id', 'growth-opportunity-brief',
  '--expected-upstream-version', '1',
  '--expected-upstream-sha256',
  '16bb5e728dcca2bcc9ede982ba0c3ca2c182e404cefdf2336241f04563444022',
  '--expected-receipt-relative-path',
  'business-projects/ent-benchmark/20260730-001-benchmark/organizations/ai-growth-strategist/runs/run-benchmark/evidence/knowledge-context.json',
  '--expected-receipt-status', 'no_hit',
  '--expected-receipt-sha256',
  '440a037e5f1ddbc20d8b24110e340b6ad943e1e3a60c42b7cec93096ede88863',
  '--reference-at', '2026-07-30T23:59:59.000Z',
];

function run(input, args = trustedArgs) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    input,
    encoding: 'utf8',
  });
}

test('CLI按schemaVersion分派竞争对标v2并回显正式版本', async () => {
  const result = run(await readFile(fixturePath, 'utf8'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    capabilityId: 'competitive-benchmark-analysis',
    schemaVersion: 2,
    status: 'candidate',
  });
});

test('CLI继续兼容竞争对标v1', async () => {
  const result = run(await readFile(v1Path, 'utf8'), []);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
});

test('v2缺少外部trusted flags时拒绝候选自证', async () => {
  const result = run(await readFile(fixturePath, 'utf8'), []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /trusted context|expected-enterprise|project-root/u);
});

test('v2外部身份与候选不一致时拒绝', async () => {
  const args = [...trustedArgs];
  args[args.indexOf('--expected-run-id') + 1] = 'run-forged';
  const result = run(await readFile(fixturePath, 'utf8'), args);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /identity mismatch.*runId/u);
});

test('v2重复、未知或候选内伪造trusted context均拒绝', async () => {
  const input = await readFile(fixturePath, 'utf8');
  const duplicate = run(input, [
    ...trustedArgs,
    '--project-root',
    trustedArgs.at(-1),
  ]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /trusted context|duplicate|flags/u);
  const unknown = run(input, [
    ...trustedArgs.slice(0, -2),
    '--forged-root',
    trustedArgs.at(-1),
  ]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /trusted context|flags/u);
  const candidate = JSON.parse(input);
  candidate.trustedContext = {
    expectedIdentity: {
      enterpriseId: candidate.enterpriseId,
      businessProjectId: candidate.businessProjectId,
      taskId: candidate.taskId,
      runId: candidate.runId,
    },
    projectRoot: trustedArgs.at(-1),
  };
  const forged = run(JSON.stringify(candidate));
  assert.equal(forged.status, 1);
  assert.match(forged.stderr, /unexpected field|plain data/u);
});

test('v2重复JSON键在解析前被拒绝', async () => {
  const input = await readFile(fixturePath, 'utf8');
  const duplicate = input.replace(
    '"capabilityId": "competitive-benchmark-analysis",',
    '"capabilityId": "wrong", "capabilityId": "competitive-benchmark-analysis",',
  );
  const result = run(duplicate);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate JSON key|capabilityId/u);
});

test('v2 CLI缺少外部expected upstream时拒绝候选自证', async () => {
  const input = await readFile(fixturePath, 'utf8');
  const result = run(input, trustedArgs.slice(0, 10));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /expected upstream|expected-upstream|trusted context/u,
  );
});

test('v2 CLI强制外部expected receipt且路径状态SHA任一错配拒绝', async () => {
  const input = await readFile(fixturePath, 'utf8');
  const receiptFlags = [
    '--expected-receipt-relative-path',
    '--expected-receipt-status',
    '--expected-receipt-sha256',
  ];
  const missing = trustedArgs.filter((item, index) => (
    !receiptFlags.includes(item)
    && !receiptFlags.includes(trustedArgs[index - 1])
  ));
  const missingResult = run(input, missing);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /trusted context|receipt|flags/u);

  for (const [flag, forged] of [
    ['--expected-receipt-relative-path', 'business-projects/forged.json'],
    ['--expected-receipt-status', 'matched'],
    ['--expected-receipt-sha256', '0'.repeat(64)],
  ]) {
    const args = [...trustedArgs];
    args[args.indexOf(flag) + 1] = forged;
    const result = run(input, args);
    assert.equal(result.status, 1, flag);
    assert.match(result.stderr, /expected knowledge receipt|receipt.*mismatch/u);
  }
});
