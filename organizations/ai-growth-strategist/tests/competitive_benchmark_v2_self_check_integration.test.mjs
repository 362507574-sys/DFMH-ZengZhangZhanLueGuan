import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

test('组织自检和checkpoint固定证明均纳管第二技能v0.2资产', async () => {
  const [selfCheck, generator] = await Promise.all([
    readFile(
      path.join(organizationRoot, 'scripts', 'organization_self_check.mjs'),
      'utf8',
    ),
    readFile(
      path.join(
        organizationRoot,
        'scripts',
        'generate_shared_runtime_checkpoint.mjs',
      ),
      'utf8',
    ),
  ]);
  const required = [
    'competitive_benchmark_v2_contract.mjs',
    'competitive_benchmark_claim_classifier.mjs',
    'competitive_benchmark_planner.mjs',
    'competitive_benchmark_debugger.mjs',
    'competitive_benchmark_forward_proof.mjs',
    'competitive_benchmark_v2_contract.test.mjs',
    'competitive_benchmark_planner.test.mjs',
    'competitive_benchmark_debugger.test.mjs',
    'competitive_benchmark_cli_context.test.mjs',
    'competitive_benchmark_v2_assets.test.mjs',
    'competitive_benchmark_v2_skill_contract_doc.test.mjs',
    'competitive_benchmark_forward_proof.test.mjs',
    'competitive_benchmark_claim_classifier.test.mjs',
    'competitive_benchmark_v2_hardening.test.mjs',
    'competitive_benchmark_v2_third_round.test.mjs',
    'organization_quality_profile.test.mjs',
    'competitive-benchmark-analysis.v2.json',
    'competitive-benchmark-v02-forward-proof',
    'cbv2-proof-root',
  ];
  for (const asset of required) {
    assert.match(selfCheck, new RegExp(asset.replaceAll('.', '\\.'), 'u'));
    assert.match(generator, new RegExp(asset.replaceAll('.', '\\.'), 'u'));
  }
});
