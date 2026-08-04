import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  optionalImport,
  organizationRoot,
  projectRoot,
} from './helpers.mjs';

const loaded = await optionalImport('scripts/organization_self_check.mjs');
const RUNTIME_ASSETS = Object.freeze([
  'scripts/growth_workspace_paths.mjs',
  'scripts/growth_run_contract.mjs',
  'scripts/growth_planner.mjs',
  'scripts/growth_run_store.mjs',
  'scripts/growth_evidence_ledger.mjs',
  'scripts/growth_experiment_manager.mjs',
  'scripts/growth_debugger.mjs',
  'scripts/growth_approval_gate.mjs',
  'tests/growth_workspace_paths.test.mjs',
  'tests/growth_run_contract.test.mjs',
  'tests/growth_planner.test.mjs',
  'tests/growth_run_store.test.mjs',
  'tests/growth_evidence_ledger.test.mjs',
  'tests/growth_experiment_manager.test.mjs',
  'tests/growth_debugger.test.mjs',
  'tests/growth_approval_gate.test.mjs',
  'scripts/growth_opportunity_v2_contract.mjs',
  'scripts/growth_opportunity_planner.mjs',
  'scripts/growth_opportunity_debugger.mjs',
  'scripts/bounded_process_runner.mjs',
  'scripts/growth_opportunity_forward_proof.mjs',
  'tests/growth_opportunity_v2_contract.test.mjs',
  'tests/growth_opportunity_planner.test.mjs',
  'tests/growth_opportunity_debugger.test.mjs',
  'tests/growth_opportunity_v2_assets.test.mjs',
  'tests/growth_opportunity_v2_self_check_integration.test.mjs',
  'tests/bounded_process_runner.test.mjs',
  'tests/growth_opportunity_forward_proof.test.mjs',
  'tests/growth_opportunity_cli_context.test.mjs',
  'tests/strict_json_plain_data.test.mjs',
  'tests/fixtures/spawn-long-lived-child.mjs',
  'templates/growth-opportunity-analysis.v2.json',
  'examples/growth-opportunity-analysis.v2.demo.json',
  'tests/fixtures/growth-opportunity-v2-valid.json',
  'tests/fixtures/growth-opportunity-v2-weak-evidence.json',
  'quality/proofs/growth-opportunity-v02-forward-proof/canonical-baseline.md',
  'quality/proofs/growth-opportunity-v02-forward-proof/canonical-forward.md',
  'quality/proofs/growth-opportunity-v02-forward-proof/canonical-candidate.json',
  'quality/proofs/growth-opportunity-v02-forward-proof/forward-score.json',
  'quality/proofs/growth-opportunity-v02-forward-proof/forward-invocation.json',
  'quality/proofs/growth-opportunity-v02-forward-proof/manifest.json',
  'quality/proofs/growth-opportunity-v02-forward-proof/canonical-scenario-input.txt',
  'quality/proofs/growth-opportunity-v02-forward-proof/exact-invocation-prompt.txt',
  'fixtures/gov2-proof-root/business-projects/ent-proof/20260730-001-proof/organizations/ai-growth-strategist/runs/run-proof/knowledge-context.json',
  'scripts/competitive_benchmark_v2_contract.mjs',
  'scripts/competitive_benchmark_planner.mjs',
  'scripts/competitive_benchmark_debugger.mjs',
  'scripts/competitive_benchmark_forward_proof.mjs',
  'tests/competitive_benchmark_v2_contract.test.mjs',
  'tests/competitive_benchmark_planner.test.mjs',
  'tests/competitive_benchmark_debugger.test.mjs',
  'tests/competitive_benchmark_cli_context.test.mjs',
  'tests/competitive_benchmark_v2_assets.test.mjs',
  'tests/competitive_benchmark_v2_skill_contract_doc.test.mjs',
  'tests/competitive_benchmark_v2_self_check_integration.test.mjs',
  'tests/competitive_benchmark_forward_proof.test.mjs',
  'templates/competitive-benchmark-analysis.v2.json',
  'examples/competitive-benchmark-analysis.v2.demo.json',
  'tests/fixtures/competitive-benchmark-v2-valid.json',
  'tests/fixtures/competitive-benchmark-v2-stale-source.json',
  'quality/proofs/competitive-benchmark-v02-forward-proof/canonical-baseline.md',
  'quality/proofs/competitive-benchmark-v02-forward-proof/canonical-candidate.json',
  'quality/proofs/competitive-benchmark-v02-forward-proof/canonical-forward.md',
  'quality/proofs/competitive-benchmark-v02-forward-proof/canonical-scenario-input.txt',
  'quality/proofs/competitive-benchmark-v02-forward-proof/exact-invocation-prompt.txt',
  'quality/proofs/competitive-benchmark-v02-forward-proof/forward-invocation.json',
  'quality/proofs/competitive-benchmark-v02-forward-proof/forward-score.json',
  'quality/proofs/competitive-benchmark-v02-forward-proof/manifest.json',
  'fixtures/cbv2-proof-root/business-projects/ent-benchmark/20260730-001-benchmark/shared-artifacts/growth-opportunity-brief/v1.json',
  'fixtures/cbv2-proof-root/business-projects/ent-benchmark/20260730-001-benchmark/organizations/ai-growth-strategist/runs/run-benchmark/evidence/knowledge-context.json',
  'fixtures/cbv2-proof-root/business-projects/ent-benchmark/20260730-001-benchmark/organizations/ai-growth-strategist/runs/run-benchmark/evidence/sources/canonical-scenario-input.txt',
  'scripts/competitive_benchmark_claim_classifier.mjs',
  'tests/competitive_benchmark_claim_classifier.test.mjs',
  'tests/competitive_benchmark_v2_hardening.test.mjs',
  'tests/competitive_benchmark_v2_third_round.test.mjs',
  'tests/competitive_benchmark_v2_fourth_round.test.mjs',
  'tests/competitive_benchmark_v2_fifth_round.test.mjs',
  'tests/competitive_benchmark_v2_sixth_round.test.mjs',
  'tests/competitive_benchmark_v2_seventh_round.test.mjs',
  'tests/competitive_benchmark_v2_eighth_round.test.mjs',
  'tests/competitive_benchmark_v2_ninth_round.test.mjs',
  'scripts/content_customer_growth_v2_contract.mjs',
  'scripts/content_customer_growth_planner.mjs',
  'scripts/content_customer_growth_debugger.mjs',
  'scripts/content_customer_growth_runtime.mjs',
  'scripts/growth_basic_pipeline.mjs',
  'scripts/growth_basic_run_manager.mjs',
  'tests/content_customer_growth_v2_contract.test.mjs',
  'tests/content_customer_growth_planner.test.mjs',
  'tests/content_customer_growth_debugger.test.mjs',
  'tests/content_customer_growth_cli_v2.test.mjs',
  'tests/content_customer_growth_v2_assets.test.mjs',
  'tests/content_customer_growth_v2_hardening.test.mjs',
  'tests/growth_basic_pipeline.test.mjs',
  'tests/growth_basic_run_manager.test.mjs',
  'templates/content-customer-growth.v2.json',
  'examples/content-customer-growth.v2.demo.json',
  'examples/growth-basic-pipeline.demo.json',
  'tests/fixtures/content-customer-growth-v2-valid.json',
  'tests/fixtures/content-customer-growth-v2-consent-failure.json',
  'tests/organization_quality_profile.test.mjs',
  'integration/BASIC_THREE_LAYER_ACCEPTANCE.md',
  'integration/BASIC_DEMO_RESULT.md',
  'run-basic-self-check.ps1',
]);
const EXTERNAL_ACTIONS = Object.freeze([
  'publish_content',
  'paid_media',
  'contact_customer',
  'change_price',
  'change_refund_rule',
  'brand_commitment',
  'deal_commitment',
  'write_external_system',
]);
const ROOT_INPUTS = Object.freeze([
  'control-center/registries/organizations.json',
  'scripts/project_self_check.bat',
  'scripts/project_self_check.ps1',
  'scripts/control-center/project_contract.mjs',
  'scripts/control-center/project_paths.mjs',
  'scripts/feishu-commander/atomic_store.mjs',
  'scripts/browser_continuous_action_controller.mjs',
  'tests/browser_continuous_action_controller_test.mjs',
  'tests/control_center_project_store_test.mjs',
  'tests/control_center_project_artifact_store_test.mjs',
  'tests/control_center_project_context_test.mjs',
  'tests/control_center_project_import_store_test.mjs',
]);
const FIXTURE_DIRECTORIES = Object.freeze([
  'config',
  'control-center',
  'issues',
  'organizations',
  'public-skills',
  'scripts',
  'shared',
  'skills',
  'templates',
  'tests',
  'workflows',
]);
const FIXTURE_ROOT_FILES = Object.freeze([
  'AGENTS.md',
  'CHANGELOG.md',
  'DECISIONS.md',
  'ENVIRONMENT.md',
  'PROJECT_OVERVIEW.md',
  'TROUBLESHOOTING.md',
  'USER_GUIDE.md',
  'WORKFLOWS.md',
  'test_error_shturl',
]);
const CHECKPOINT_DIRECTORY_RELATIVE = path.join(
  'temp',
  'growth-strategist-v02-implementation',
  'checkpoints',
);
const CURRENT_RELATIVE = path.join(
  CHECKPOINT_DIRECTORY_RELATIVE,
  'current.json',
);

async function completeProjectFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-self-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let index = 0; index < FIXTURE_DIRECTORIES.length; index += 1) {
    const relative = FIXTURE_DIRECTORIES[index];
    await cp(
      path.join(projectRoot, relative),
      path.join(root, relative),
      { recursive: true },
    );
  }
  for (let index = 0; index < FIXTURE_ROOT_FILES.length; index += 1) {
    const relative = FIXTURE_ROOT_FILES[index];
    await cp(path.join(projectRoot, relative), path.join(root, relative));
  }
  await mkdir(path.join(root, 'outputs'));
  await mkdir(path.join(root, 'temp'));
  await mkdir(path.join(root, 'business-projects'));
  await cp(
    path.join(projectRoot, 'business-projects', 'README.md'),
    path.join(root, 'business-projects', 'README.md'),
  );
  const sourceCurrentPath = path.join(projectRoot, CURRENT_RELATIVE);
  const current = JSON.parse(await readFile(sourceCurrentPath, 'utf8'));
  const checkpointRelative = path.normalize(current.checkpointPath);
  const checkpointTarget = path.join(root, checkpointRelative);
  await mkdir(path.dirname(checkpointTarget), { recursive: true });
  await cp(path.join(projectRoot, checkpointRelative), checkpointTarget);
  await cp(sourceCurrentPath, path.join(root, CURRENT_RELATIVE));
  return root;
}

function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runFixtureSelfCheck(root) {
  return runNode([
    path.join(
      root,
      'organizations',
      'ai-growth-strategist',
      'scripts',
      'organization_self_check.mjs',
    ),
  ], root);
}

async function runFixtureCheckpointRefresh(root) {
  return runNode([
    path.join(
      root,
      'organizations',
      'ai-growth-strategist',
      'scripts',
      'generate_shared_runtime_checkpoint.mjs',
    ),
    '--milestone=fixture-refresh',
    '--output=99-fixture-refresh.json',
  ], root);
}

async function refreshFixtureCheckpoint(root) {
  const result = await runFixtureCheckpointRefresh(root);
  assert.equal(
    result.code,
    0,
    `fixture checkpoint generation failed\n${result.stdout}\n${result.stderr}`,
  );
}

test('组织自检暴露可复用入口', () => {
  assert.equal(
    typeof loaded.module?.runOrganizationSelfCheck,
    'function',
    loaded.error?.message ?? 'runOrganizationSelfCheck missing',
  );
});

test('生产接口只接受精确稳定的 projectRoot data 对象', async () => {
  if (!loaded.module) return;
  const production = await loaded.module.runOrganizationSelfCheck();
  assert.equal(typeof production.ok, 'boolean');
  for (const value of [null, [], { projectRoot }, { projectRoot, extra: true }]) {
    await assert.rejects(
      loaded.module.runOrganizationSelfCheck(value),
      /zero|argument|production|fixed|options/iu,
    );
  }

  let trapCalls = 0;
  const proxy = new Proxy({ projectRoot }, {
    get() {
      trapCalls += 1;
      throw new Error('SENTINEL_SELF_CHECK_PROXY');
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error('SENTINEL_SELF_CHECK_PROXY');
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('SENTINEL_SELF_CHECK_PROXY');
    },
  });
  await assert.rejects(
    loaded.module.runOrganizationSelfCheck(proxy),
    /zero|argument|production|fixed|options/iu,
  );
  assert.equal(trapCalls, 0);
});

test('当前组织资产、根注册和三技能保持一致', async () => {
  if (!loaded.module) return;
  const result = await loaded.module.runOrganizationSelfCheck();
  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.skillCount, 3);
  assert.equal(result.obsoleteSkillIds.length, 0);
  assert.equal(result.runtimeAssetCount, 104);
  assert.equal(result.externalActionCount, 8);
  assert.deepEqual(result.runtimeAssets, RUNTIME_ASSETS);
  assert.deepEqual(result.externalActions, EXTERNAL_ACTIONS);
  assert.equal(result.organizationStatus, 'designing');
  assert.equal(result.acceptsFormalTasks, false);
  assert.equal(result.checkpointVerified, true);
});

test('runtime 脚本被目录替换时 fixture CLI 明确失败', async (t) => {
  const root = await completeProjectFixture(t);
  const target = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'growth_workspace_paths.mjs',
  );
  await rm(target);
  await mkdir(target);

  const result = await runFixtureSelfCheck(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /regular file|runtime|checkpoint|scope/iu);
});

test('runtime 脚本指向组织外文件的链接时 fixture CLI 明确失败', async (t) => {
  const root = await completeProjectFixture(t);
  const outside = path.join(root, 'outside-runtime.mjs');
  await writeFile(outside, 'export const outside = true;\n', 'utf8');
  const target = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'growth_workspace_paths.mjs',
  );
  await rm(target);
  try {
    await symlink(outside, target, 'file');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('当前环境不允许创建文件符号链接');
      return;
    }
    throw error;
  }

  const result = await runFixtureSelfCheck(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /symbolic|link|regular file|realpath|unsafe/iu);
});

test('checkpoint 刷新后非法 runtime JavaScript 仍由隔离审查拒绝', async (t) => {
  const root = await completeProjectFixture(t);
  const target = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'growth_workspace_paths.mjs',
  );
  await writeFile(target, 'export const broken = ;\n', 'utf8');
  const result = await runFixtureCheckpointRefresh(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /organization proof tests|runtime|syntax|test failed/iu,
  );
});

test('config 未知字段和固定投影漂移由 fixture CLI 拒绝', async (t) => {
  const root = await completeProjectFixture(t);
  const configPath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'config',
    'organization.json',
  );
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.status = 'operational';
  config.acceptsFormalTasks = true;
  config.unreviewed = true;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const result = await runFixtureCheckpointRefresh(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /activation self-check|rolled back|config|unexpected|designing|formal/iu,
  );
});

test('动作顺序漂移即使刷新 checkpoint 仍由隔离身份审查拒绝', async (t) => {
  const root = await completeProjectFixture(t);
  const managerPath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'growth_experiment_manager.mjs',
  );
  const source = await readFile(managerPath, 'utf8');
  const drifted = source.replace(
    "'publish_content',\n  'paid_media',",
    "'paid_media',\n  'publish_content',",
  );
  assert.notEqual(drifted, source);
  await writeFile(managerPath, drifted, 'utf8');
  const result = await runFixtureCheckpointRefresh(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /organization proof tests|external actions|test failed|fail 2/iu,
  );
});

test('被审模块污染 Array.prototype 且注册缺失时只污染隔离子进程', async (t) => {
  const root = await completeProjectFixture(t);
  const originalFind = Array.prototype.find;
  const gatePath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'growth_approval_gate.mjs',
  );
  await writeFile(gatePath, [
    "Array.prototype.find = () => ({ id: 'ai-growth-strategist' });",
    'export const EXTERNAL_ACTIONS = Object.freeze({',
    '  size: 8,',
    "  has: () => true,",
    '  values: function* values() {},',
    '  [Symbol.iterator]: function* iterator() {},',
    '});',
    '',
  ].join('\n'), 'utf8');

  const registryPath = path.join(
    root,
    'control-center',
    'registries',
    'organizations.json',
  );
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  registry.organizations = registry.organizations.filter(
    (item) => item.id !== 'ai-growth-strategist',
  );
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  const result = await runFixtureCheckpointRefresh(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.equal(Array.prototype.find, originalFind);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /project regression tests|organization registry|test failed|fail 2/iu,
  );
});
