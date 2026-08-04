import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

const cliPath = path.join(organizationRoot, 'scripts', 'validate_candidate.mjs');
const examplePath = path.join(
  organizationRoot,
  'examples',
  'growth-opportunity-analysis.demo.json',
);
const benchmarkExamplePath = path.join(
  organizationRoot,
  'examples',
  'competitive-benchmark-analysis.demo.json',
);
const contentExamplePath = path.join(
  organizationRoot,
  'examples',
  'content-customer-growth.demo.json',
);
const opportunityV2FixturePath = path.join(
  organizationRoot,
  'tests',
  'fixtures',
  'growth-opportunity-v2-valid.json',
);
const canonicalProofRoot = path.join(
  organizationRoot,
  'quality',
  'proofs',
  'growth-opportunity-v02-forward-proof',
);
const canonicalCandidatePath = path.join(
  canonicalProofRoot,
  'canonical-candidate.json',
);
const canonicalV2Args = [
  '--expected-enterprise-id', 'ent-proof',
  '--expected-business-project-id', '20260730-001-proof',
  '--expected-task-id', 'task-proof',
  '--expected-run-id', 'run-proof',
  '--project-root', path.join(
    organizationRoot,
    'fixtures',
    'gov2-proof-root',
  ),
];

test('候选门禁可以从标准输入校验增长机会示例', async () => {
  const input = await readFile(examplePath, 'utf8');
  const result = spawnSync(process.execPath, [cliPath], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.deepEqual(response, {
    ok: true,
    capabilityId: 'growth-opportunity-analysis',
    schemaVersion: 1,
    status: 'candidate',
  });
});

test('候选门禁兼容标准输入中的 UTF-8 BOM', async () => {
  const input = `\uFEFF${await readFile(examplePath, 'utf8')}`;
  const result = spawnSync(process.execPath, [cliPath], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('候选门禁拒绝保证增长等违规承诺', async () => {
  const candidate = JSON.parse(await readFile(examplePath, 'utf8'));
  candidate.opportunities[0].growthMechanism = '保证增长并保证翻倍';
  const result = spawnSync(process.execPath, [cliPath], {
    input: JSON.stringify(candidate),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  const response = JSON.parse(result.stderr);
  assert.equal(response.ok, false);
  assert.match(response.error, /保证|guarantee|承诺/u);
});

test('候选门禁可以校验竞争对标拆解示例', async () => {
  const input = await readFile(benchmarkExamplePath, 'utf8');
  const result = spawnSync(process.execPath, [cliPath], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).capabilityId,
    'competitive-benchmark-analysis',
  );
});

test('候选门禁可以校验内容与客户增长示例', async () => {
  const input = await readFile(contentExamplePath, 'utf8');
  const result = spawnSync(process.execPath, [cliPath], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).capabilityId, 'content-customer-growth');
});

test('候选门禁按 schemaVersion 分派增长机会 v2 且回显版本', async () => {
  const input = await readFile(canonicalCandidatePath, 'utf8');
  const result = spawnSync(process.execPath, [cliPath, ...canonicalV2Args], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.capabilityId, 'growth-opportunity-analysis');
  assert.equal(response.schemaVersion, 2);
});

test('候选门禁保持增长机会 v1 演示兼容并回显版本', async () => {
  const input = await readFile(examplePath, 'utf8');
  const result = spawnSync(process.execPath, [cliPath], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
});

test('候选门禁拒绝重复 schemaVersion 键', async () => {
  const input = await readFile(opportunityV2FixturePath, 'utf8');
  const duplicate = input.replace(
    '"schemaVersion": 2,',
    '"schemaVersion": 1, "schemaVersion": 2,',
  );
  const result = spawnSync(process.execPath, [cliPath], {
    input: duplicate,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate JSON key|schemaVersion/u);
});

test('候选门禁拒绝超过一兆字节的输入', () => {
  const result = spawnSync(process.execPath, [cliPath], {
    input: `{"padding":"${'x'.repeat((1024 * 1024) + 1)}"}`,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /size|bytes|large/u);
});
