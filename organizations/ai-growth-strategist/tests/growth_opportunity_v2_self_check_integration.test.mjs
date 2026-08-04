import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

const SELF_CHECK_ASSETS = [
  'scripts/growth_opportunity_v2_contract.mjs',
  'scripts/growth_opportunity_planner.mjs',
  'scripts/growth_opportunity_debugger.mjs',
  'tests/growth_opportunity_v2_contract.test.mjs',
  'tests/growth_opportunity_planner.test.mjs',
  'tests/growth_opportunity_debugger.test.mjs',
  'tests/growth_opportunity_v2_assets.test.mjs',
  'templates/growth-opportunity-analysis.v2.json',
  'examples/growth-opportunity-analysis.v2.demo.json',
  'tests/fixtures/growth-opportunity-v2-valid.json',
  'tests/fixtures/growth-opportunity-v2-weak-evidence.json',
];
const PROOF_TESTS = [
  'growth_opportunity_v2_contract.test.mjs',
  'growth_opportunity_planner.test.mjs',
  'growth_opportunity_debugger.test.mjs',
  'growth_opportunity_v2_assets.test.mjs',
  'candidate_cli.test.mjs',
];

test('组织自检将机会 v2 全部核心资产列为必需项', async () => {
  const source = await readFile(
    path.join(organizationRoot, 'scripts', 'organization_self_check.mjs'),
    'utf8',
  );
  for (const asset of SELF_CHECK_ASSETS) {
    assert.match(source, new RegExp(escapeRegex(asset), 'u'), asset);
  }
});

test('checkpoint 生成器固定执行机会 v2 专属证明套件', async () => {
  const source = await readFile(
    path.join(
      organizationRoot,
      'scripts',
      'generate_shared_runtime_checkpoint.mjs',
    ),
    'utf8',
  );
  for (const proof of PROOF_TESTS) {
    assert.match(source, new RegExp(escapeRegex(proof), 'u'), proof);
  }
});

test('扩展固定证明后 checkpoint 子进程预算不少于五分钟', async () => {
  const source = await readFile(
    path.join(
      organizationRoot,
      'scripts',
      'generate_shared_runtime_checkpoint.mjs',
    ),
    'utf8',
  );
  const match = /const COMMAND_TIMEOUT_MS = ([\d_]+);/u.exec(source);
  assert.ok(match, 'COMMAND_TIMEOUT_MS missing');
  const timeout = Number(match[1].replaceAll('_', ''));
  assert.ok(
    timeout >= 300_000,
    `checkpoint fixed proof timeout too small: ${timeout}`,
  );
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
