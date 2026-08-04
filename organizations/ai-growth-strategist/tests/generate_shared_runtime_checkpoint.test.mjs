import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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

const loaded = await optionalImport(
  'scripts/generate_shared_runtime_checkpoint.mjs',
);

test('checkpoint 生成器与组织自检使用完全一致的输入和运行资产清单', async () => {
  const [generatorSource, selfCheckSource] = await Promise.all([
    readFile(path.join(
      organizationRoot,
      'scripts',
      'generate_shared_runtime_checkpoint.mjs',
    ), 'utf8'),
    readFile(path.join(
      organizationRoot,
      'scripts',
      'organization_self_check.mjs',
    ), 'utf8'),
  ]);
  const extract = (source, name) => {
    const match = new RegExp(
      `const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`,
      'u',
    ).exec(source);
    assert.ok(match, `${name} declaration not found`);
    return [...match[1].matchAll(/'([^']+)'/gu)].map((item) => item[1]);
  };

  assert.deepEqual(
    extract(generatorSource, 'ROOT_INPUTS'),
    extract(selfCheckSource, 'ROOT_INPUTS'),
  );
  assert.deepEqual(
    extract(generatorSource, 'REQUIRED_RUNTIME_ASSETS'),
    extract(selfCheckSource, 'RUNTIME_ASSETS'),
  );
  assert.deepEqual(
    extract(generatorSource, 'ORGANIZATION_PROOF_TESTS'),
    extract(selfCheckSource, 'ORGANIZATION_PROOF_TESTS'),
  );
  assert.deepEqual(
    extract(generatorSource, 'PROJECT_REGRESSION_TESTS'),
    extract(selfCheckSource, 'PROJECT_REGRESSION_TESTS'),
  );
});
const ROOT_INPUTS = Object.freeze([
  'control-center/registries/organizations.json',
  'scripts/project_self_check.bat',
  'scripts/project_self_check.ps1',
  'scripts/control-center/project_contract.mjs',
  'scripts/control-center/project_paths.mjs',
  'scripts/feishu-commander/atomic_store.mjs',
  'tests/control_center_project_store_test.mjs',
  'tests/control_center_project_artifact_store_test.mjs',
  'tests/control_center_project_context_test.mjs',
  'tests/control_center_project_import_store_test.mjs',
]);
const ORGANIZATION_PROOF_TESTS = Object.freeze([
  'organizations/ai-growth-strategist/tests/growth_workspace_paths.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_run_contract.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_planner.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_run_store.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_evidence_ledger.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_experiment_manager.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_debugger.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_approval_gate.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_opportunity_v2_contract.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_opportunity_planner.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_opportunity_debugger.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_opportunity_v2_assets.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_opportunity_v2_self_check_integration.test.mjs',
  'organizations/ai-growth-strategist/tests/bounded_process_runner.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_opportunity_forward_proof.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_opportunity_cli_context.test.mjs',
  'organizations/ai-growth-strategist/tests/strict_json_plain_data.test.mjs',
  'organizations/ai-growth-strategist/tests/candidate_cli.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_contract.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_planner.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_debugger.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_cli_context.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_assets.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_skill_contract_doc.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_self_check_integration.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_forward_proof.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_claim_classifier.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_hardening.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_third_round.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_fourth_round.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_fifth_round.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_sixth_round.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_seventh_round.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_eighth_round.test.mjs',
  'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_ninth_round.test.mjs',
  'organizations/ai-growth-strategist/tests/organization_quality_profile.test.mjs',
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
const CHECKPOINT_RELATIVE = path.join(
  'temp',
  'growth-strategist-v02-implementation',
  'checkpoints',
  '01-shared-runtime.json',
);
const CURRENT_RELATIVE = path.join(
  'temp',
  'growth-strategist-v02-implementation',
  'checkpoints',
  'current.json',
);

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function projectFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-checkpoint-'));
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
  return root;
}

async function generateFixture(root) {
  return runNode([
    path.join(
      root,
      'organizations',
      'ai-growth-strategist',
      'scripts',
      'generate_shared_runtime_checkpoint.mjs',
    ),
  ], root);
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

async function nextCheckpointOutput(root, suffix) {
  const checkpointDirectory = path.join(root, path.dirname(CURRENT_RELATIVE));
  const current = JSON.parse(await readFile(
    path.join(root, CURRENT_RELATIVE),
    'utf8',
  ));
  const currentName = path.posix.basename(current.checkpointPath);
  const currentMatch = /^(\d{2})-[a-z0-9][a-z0-9-]{2,100}\.json$/u
    .exec(currentName);
  assert.ok(currentMatch, 'fixture current checkpoint name is invalid');
  const checkpointNames = await readdir(checkpointDirectory);
  const sequences = checkpointNames.flatMap((name) => {
    const match = /^(\d{2})-[a-z0-9][a-z0-9-]{2,100}\.json$/u.exec(name);
    return match ? [Number(match[1])] : [];
  });
  assert.ok(
    sequences.includes(Number(currentMatch[1])),
    'fixture current checkpoint is not present in checkpoint directory',
  );
  const nextSequence = Math.max(...sequences) + 1;
  assert.equal(
    Number.isSafeInteger(nextSequence) && nextSequence <= 99,
    true,
    'fixture checkpoint sequence is exhausted',
  );
  return `${String(nextSequence).padStart(2, '0')}-${suffix}.json`;
}

async function bindFixtureSkillValidator(root) {
  const trustedRoot = path.join(root, 'toolchain', 'skill-creator');
  const validatorPath = path.join(trustedRoot, 'scripts', 'quick_validate.py');
  await mkdir(path.dirname(validatorPath), { recursive: true });
  await cp(
    'C:\\Users\\Administrator\\.codex\\skills\\.system\\skill-creator\\scripts\\quick_validate.py',
    validatorPath,
  );
  for (const relative of [
    'organizations/ai-growth-strategist/scripts/generate_shared_runtime_checkpoint.mjs',
    'organizations/ai-growth-strategist/scripts/organization_self_check.mjs',
  ]) {
    const target = path.join(root, ...relative.split('/'));
    const source = await readFile(target, 'utf8');
    const patched = source
      .replace(
        /const SKILL_VALIDATOR_PATH =\s*'[^']+';/u,
        `const SKILL_VALIDATOR_PATH = ${JSON.stringify(validatorPath)};`,
      )
      .replace(
        /const SKILL_VALIDATOR_TRUSTED_ROOT =\s*'[^']+';/u,
        `const SKILL_VALIDATOR_TRUSTED_ROOT = ${JSON.stringify(trustedRoot)};`,
      );
    assert.notEqual(patched, source);
    await writeFile(target, patched, 'utf8');
  }
  return validatorPath;
}

test('固定生成器暴露可复用入口', () => {
  assert.equal(
    typeof loaded.module?.generateSharedRuntimeCheckpoint,
    'function',
    loaded.error?.message ?? 'generateSharedRuntimeCheckpoint missing',
  );
  assert.equal(loaded.module?.generateSharedRuntimeCheckpoint.length, 0);
});

test('生成器写入排序完整输入、实际计数和稳定状态摘要', async (t) => {
  if (!loaded.module) return;
  const root = await projectFixture(t);
  await assert.rejects(
    loaded.module.generateSharedRuntimeCheckpoint({ projectRoot: root }),
    /zero|argument|production|fixed/iu,
  );
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  const checkpointPath = path.join(root, CHECKPOINT_RELATIVE);
  const checkpointBytes = await readFile(checkpointPath);
  const persisted = JSON.parse(checkpointBytes.toString('utf8'));
  const current = JSON.parse(await readFile(
    path.join(root, CURRENT_RELATIVE),
    'utf8',
  ));
  const paths = Object.keys(persisted.inputs);

  assert.deepEqual(paths, [...paths].sort());
  assert.equal(persisted.inputCount, paths.length);
  assert.ok(paths.length >= 46);
  assert.match(persisted.stateSha256, /^[0-9a-f]{64}$/u);
  assert.ok(persisted.organizationNodeTests >= 60);
  assert.ok(persisted.projectRegressionTests >= 11);
  assert.equal(persisted.projectSelfCheckIssues, 0);
  assert.equal(Object.hasOwn(persisted, 'organizationSelfCheck'), false);
  assert.equal(
    persisted.verification.mode,
    'generator-executed-fixed-suite-v1',
  );
  assert.equal(
    persisted.verification.organizationNodeTests,
    persisted.organizationNodeTests,
  );
  assert.equal(
    persisted.verification.projectRegressionTests,
    persisted.projectRegressionTests,
  );
  assert.equal(persisted.verification.projectSelfCheckIssues, 0);
  assert.equal(persisted.verification.skillsValid, 3);
  assert.deepEqual(
    persisted.verification.organizationSuite,
    ORGANIZATION_PROOF_TESTS,
  );
  assert.equal(
    persisted.verification.skillValidatorPath,
    'C:\\Users\\Administrator\\.codex\\skills\\.system\\skill-creator\\scripts\\quick_validate.py',
  );
  assert.match(
    persisted.verification.skillValidatorSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.equal(
    persisted.verification.pythonExecutablePath,
    'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
  );
  assert.match(
    persisted.verification.pythonExecutableSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(persisted.verification.pythonVersion, /^\d+\.\d+\.\d+$/u);
  assert.equal(persisted.verification.skillValidationCommands.length, 3);
  for (const field of [
    'organizationStdoutSha256',
    'organizationStderrSha256',
    'projectRegressionStdoutSha256',
    'projectRegressionStderrSha256',
    'projectSelfCheckStdoutSha256',
    'projectSelfCheckStderrSha256',
    'skillValidationStdoutSha256',
    'skillValidationStderrSha256',
  ]) {
    assert.match(persisted.verification[field], /^[0-9a-f]{64}$/u);
  }
  assert.equal(persisted.runtimeAssetCount, 82);
  assert.equal(persisted.externalActionCount, 8);
  assert.ok(paths.includes(
    'organizations/ai-growth-strategist/scripts/organization_self_check.mjs',
  ));
  assert.ok(paths.includes(
    'organizations/ai-growth-strategist/tests/organization_self_check.test.mjs',
  ));
  assert.ok(paths.includes(
    'organizations/ai-growth-strategist/scripts/generate_shared_runtime_checkpoint.mjs',
  ));
  assert.ok(paths.includes(
    'organizations/ai-growth-strategist/tests/generate_shared_runtime_checkpoint.test.mjs',
  ));
  assert.equal(
    paths.includes(CHECKPOINT_RELATIVE.replaceAll('\\', '/')),
    false,
  );
  assert.equal(paths.includes(CURRENT_RELATIVE.replaceAll('\\', '/')), false);
  assert.deepEqual(current, {
    schemaVersion: 2,
    milestone: 'shared-growth-runtime',
    checkpointPath: CHECKPOINT_RELATIVE.replaceAll('\\', '/'),
    stateSha256: persisted.stateSha256,
    checkpointSha256: sha256(checkpointBytes),
  });
});

test('checkpoint 正文或机器凭证被改写后 current 文件哈希立即失效', async (t) => {
  const root = await projectFixture(t);
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  const checkpointPath = path.join(root, CHECKPOINT_RELATIVE);
  const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
  checkpoint.verification.organizationStdoutSha256 = '0'.repeat(64);
  await writeFile(
    checkpointPath,
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    'utf8',
  );

  const result = await runFixtureSelfCheck(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /checkpoint.*sha|file hash|content hash|digest/iu,
  );
});

test('伪造外部验证器路径、文件哈希或 Python 身份时即使重签文件哈希仍拒绝', async (t) => {
  const root = await projectFixture(t);
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  const checkpointPath = path.join(root, CHECKPOINT_RELATIVE);
  const currentPath = path.join(root, CURRENT_RELATIVE);
  const baselineCheckpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
  const baselineCurrent = JSON.parse(await readFile(currentPath, 'utf8'));
  for (const mutation of [
    (verification) => {
      verification.skillValidatorPath = 'C:\\outside\\quick_validate.py';
    },
    (verification) => {
      verification.skillValidatorSha256 = '0'.repeat(64);
    },
    (verification) => {
      verification.pythonExecutablePath = 'C:\\outside\\python.exe';
    },
    (verification) => {
      verification.pythonExecutableSha256 = '0'.repeat(64);
    },
    (verification) => {
      verification.pythonVersion = '0.0.0';
    },
  ]) {
    const checkpoint = structuredClone(baselineCheckpoint);
    mutation(checkpoint.verification);
    const checkpointBytes = Buffer.from(
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      'utf8',
    );
    await writeFile(checkpointPath, checkpointBytes);
    const current = structuredClone(baselineCurrent);
    current.checkpointSha256 = sha256(checkpointBytes);
    await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);

    const result = await runFixtureSelfCheck(root);
    assert.notEqual(result.code, 0, result.stdout);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /validator|python|tool|executable|version/iu,
    );
  }
});

test('项目自检脚本纳入输入后任一字节漂移都会使 current 失效', async (t) => {
  const root = await projectFixture(t);
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  const target = path.join(root, 'scripts', 'project_self_check.ps1');
  await writeFile(target, `${await readFile(target, 'utf8')}\n`, 'utf8');

  const result = await runFixtureSelfCheck(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /checkpoint|input|state|hash|project_self_check/iu,
  );
});

test('外部 quick_validate.py 实际内容改变后 current 立即失效', async (t) => {
  const root = await projectFixture(t);
  const validatorPath = await bindFixtureSkillValidator(root);
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  await writeFile(
    validatorPath,
    `${await readFile(validatorPath, 'utf8')}\n`,
    'utf8',
  );

  const result = await runFixtureSelfCheck(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /skill validator tool path or SHA-256 is stale/iu,
  );
});

test('approval gate 测试非法时八项固定证明阻止 checkpoint 生成', async (t) => {
  const root = await projectFixture(t);
  await writeFile(
    path.join(
      root,
      'organizations',
      'ai-growth-strategist',
      'tests',
      'growth_approval_gate.test.mjs',
    ),
    'export const broken = ;\n',
    'utf8',
  );
  const generated = await generateFixture(root);
  assert.notEqual(generated.code, 0, generated.stdout);
  assert.match(
    `${generated.stdout}\n${generated.stderr}`,
    /organization proof tests|approval_gate|syntax|test failed/iu,
  );
});

test('CLI 激活生产自检失败时原子回滚 current 并保留未激活 checkpoint', async (t) => {
  const root = await projectFixture(t);
  const first = await generateFixture(root);
  assert.equal(first.code, 0, first.stderr);
  const currentPath = path.join(root, CURRENT_RELATIVE);
  const oldCurrent = await readFile(currentPath);
  const selfCheckPath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'organization_self_check.mjs',
  );
  const selfCheckSource = await readFile(selfCheckPath, 'utf8');
  const selfCheckWithActivationSentinel = selfCheckSource.replace(
    /if \(\r?\n  process\.argv\[1\][\s\S]*?\r?\n\}\s*$/u,
    `if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const activationCurrent = JSON.parse(await readFile(
    path.join(
      path.resolve(import.meta.dirname, '..', '..', '..'),
      ...CURRENT_RELATIVE.split('/'),
    ),
    'utf8',
  ));
  if (activationCurrent.milestone === 'activation-failure') {
    process.stderr.write('ACTIVATION_SENTINEL\\n');
    process.exitCode = 1;
  } else {
    const result = await runOrganizationSelfCheck();
    process.stdout.write(\`\${JSON.stringify(result, null, 2)}\\n\`);
    if (!result.ok) process.exitCode = 1;
  }
}
`,
  );
  assert.notEqual(
    selfCheckWithActivationSentinel,
    selfCheckSource,
    'activation sentinel patch did not match fixture self-check CLI',
  );
  await writeFile(
    selfCheckPath,
    selfCheckWithActivationSentinel,
    'utf8',
  );
  const generatorPath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'generate_shared_runtime_checkpoint.mjs',
  );
  const output = await nextCheckpointOutput(root, 'activation-failure');
  const activated = await runNode([
    generatorPath,
    '--milestone=activation-failure',
    `--output=${output}`,
  ], root);
  assert.notEqual(activated.code, 0, activated.stdout);
  assert.match(
    `${activated.stdout}\n${activated.stderr}`,
    /ACTIVATION_SENTINEL|activation|self-check/iu,
  );
  assert.deepEqual(await readFile(currentPath), oldCurrent);
  assert.equal(
    await readFile(
      path.join(
        root,
        'temp',
        'growth-strategist-v02-implementation',
        'checkpoints',
        output,
      ),
      'utf8',
    ).then(() => true),
    true,
  );
});

test('CLI 裸计数不能伪造通过凭证', async (t) => {
  const root = await projectFixture(t);
  const generatorPath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'generate_shared_runtime_checkpoint.mjs',
  );
  const forged = await runNode([
    generatorPath,
    '--organization-node-tests=0',
    '--project-regression-tests=0',
    '--project-self-check-issues=9',
  ], root);
  assert.notEqual(forged.code, 0, forged.stdout);
  assert.match(
    `${forged.stdout}\n${forged.stderr}`,
    /unexpected|count|argument|verification|forbid/iu,
  );
});

test('已存在的同名 checkpoint 永远不可覆盖', async (t) => {
  const root = await projectFixture(t);
  const first = await generateFixture(root);
  assert.equal(first.code, 0, first.stderr);
  const checkpointPath = path.join(root, CHECKPOINT_RELATIVE);
  const before = await readFile(checkpointPath);
  const second = await generateFixture(root);
  assert.notEqual(second.code, 0, second.stdout);
  assert.deepEqual(await readFile(checkpointPath), before);
  assert.match(
    `${second.stdout}\n${second.stderr}`,
    /immutable|exists|checkpoint/iu,
  );
});

test('当前指针路径逃逸或外链一律拒绝', async (t) => {
  const root = await projectFixture(t);
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  const currentPath = path.join(root, CURRENT_RELATIVE);
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  current.checkpointPath = '../../outside-checkpoint.json';
  await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');

  const escaped = await runFixtureSelfCheck(root);
  assert.notEqual(escaped.code, 0, escaped.stdout);
  assert.match(`${escaped.stdout}\n${escaped.stderr}`, /current|pointer|escape|checkpoint/iu);

  const outside = path.join(root, 'outside-current.json');
  await writeFile(outside, `${JSON.stringify(current)}\n`, 'utf8');
  await rm(currentPath);
  try {
    await symlink(outside, currentPath, 'file');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.diagnostic('当前环境不允许创建文件符号链接，已验证路径逃逸分支');
      return;
    }
    throw error;
  }
  const linked = await runFixtureSelfCheck(root);
  assert.notEqual(linked.code, 0, linked.stdout);
  assert.match(`${linked.stdout}\n${linked.stderr}`, /symbolic|link|regular file|current/iu);
});

test('生成器拒绝 current 外链、非数字计数和不安全输出路径', async (t) => {
  const root = await projectFixture(t);
  const first = await generateFixture(root);
  assert.equal(first.code, 0, first.stderr);
  const currentPath = path.join(root, CURRENT_RELATIVE);
  const currentBytes = await readFile(currentPath);
  const outside = path.join(root, 'outside-generator-current.json');
  await writeFile(outside, '{}\n', 'utf8');
  await rm(currentPath);
  try {
    await symlink(outside, currentPath, 'file');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('当前环境不允许创建文件符号链接');
      return;
    }
    throw error;
  }
  const generatorPath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'generate_shared_runtime_checkpoint.mjs',
  );
  const linked = await runNode([
    generatorPath,
    '--milestone=next-milestone',
    '--output=02-next-milestone.json',
  ], root);
  assert.notEqual(linked.code, 0, linked.stdout);
  assert.match(`${linked.stdout}\n${linked.stderr}`, /current|symbolic|link|regular/iu);
  await rm(currentPath);
  await writeFile(currentPath, currentBytes);

  for (const args of [
    [
      '--organization-node-tests=NaN',
    ],
    [
      '--milestone=next-milestone',
      '--output=C:\\absolute.json',
    ],
    [
      '--milestone=next-milestone',
      '--output=..%2fescape.json',
    ],
  ]) {
    const rejected = await runNode([generatorPath, ...args], root);
    assert.notEqual(rejected.code, 0, rejected.stdout);
    assert.match(
      `${rejected.stdout}\n${rejected.stderr}`,
      /integer|output|invalid|unsafe|unexpected|forbidden/iu,
    );
  }
});

test('检查点目录任一级父链为外部 junction 时生成器拒绝且不向外写', async (t) => {
  for (const scenario of ['temp', 'implementation', 'checkpoints']) {
    const root = await projectFixture(t);
    const outside = await mkdtemp(path.join(os.tmpdir(), `growth-checkpoint-outside-${scenario}-`));
    t.after(() => rm(outside, { recursive: true, force: true }));
    const tempRoot = path.join(root, 'temp');
    const implementationRoot = path.join(
      tempRoot,
      'growth-strategist-v02-implementation',
    );
    const checkpointsRoot = path.join(implementationRoot, 'checkpoints');
    let linkPath;
    if (scenario === 'temp') {
      await rm(tempRoot, { recursive: true });
      linkPath = tempRoot;
    } else if (scenario === 'implementation') {
      linkPath = implementationRoot;
    } else {
      await mkdir(implementationRoot, { recursive: true });
      linkPath = checkpointsRoot;
    }
    try {
      await symlink(
        outside,
        linkPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('当前环境不允许创建目录 junction/symlink');
        return;
      }
      throw error;
    }

    const generated = await generateFixture(root);
    assert.notEqual(
      generated.code,
      0,
      `${scenario} junction unexpectedly accepted\n${generated.stdout}`,
    );
    assert.match(
      `${generated.stdout}\n${generated.stderr}`,
      /junction|symbolic|link|reparse|safe directory|outside/iu,
    );
    await assert.rejects(
      readFile(path.join(outside, '01-shared-runtime.json')),
      /ENOENT/iu,
    );
    await assert.rejects(
      readFile(path.join(outside, 'current.json')),
      /ENOENT/iu,
    );
  }
});

test('生成下一里程碑后历史 checkpoint 保留且自检跟随 current', async (t) => {
  const root = await projectFixture(t);
  const first = await generateFixture(root);
  assert.equal(first.code, 0, first.stderr);
  const firstPath = path.join(root, CHECKPOINT_RELATIVE);
  const firstBytes = await readFile(firstPath);
  const generatorPath = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'generate_shared_runtime_checkpoint.mjs',
  );
  const second = await runNode([
    generatorPath,
    '--milestone=growth-opportunity-runtime',
    '--output=02-growth-opportunity-runtime.json',
  ], root);
  assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
  assert.deepEqual(await readFile(firstPath), firstBytes);
  const current = JSON.parse(await readFile(
    path.join(root, CURRENT_RELATIVE),
    'utf8',
  ));
  assert.equal(current.milestone, 'growth-opportunity-runtime');
  assert.equal(
    current.checkpointPath,
    'temp/growth-strategist-v02-implementation/checkpoints/02-growth-opportunity-runtime.json',
  );

  const checked = await runFixtureSelfCheck(root);
  assert.equal(checked.code, 0, `${checked.stdout}\n${checked.stderr}`);
});

test('已覆盖输入改变一个字节后 checkpoint 立即过期且不执行待审模块', async (t) => {
  const root = await projectFixture(t);
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  const target = path.join(
    root,
    'organizations',
    'ai-growth-strategist',
    'scripts',
    'growth_workspace_paths.mjs',
  );
  await writeFile(target, `${await readFile(target, 'utf8')}\n`, 'utf8');

  const result = await runFixtureSelfCheck(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /checkpoint|hash|stale|state/iu);
});

test('组织匹配范围新增源码后 checkpoint 立即过期', async (t) => {
  const root = await projectFixture(t);
  const generated = await generateFixture(root);
  assert.equal(generated.code, 0, generated.stderr);
  await writeFile(
    path.join(
      root,
      'organizations',
      'ai-growth-strategist',
      'scripts',
      'unreviewed_runtime.js',
    ),
    'export const unreviewed = true;\n',
    'utf8',
  );

  const result = await runFixtureSelfCheck(root);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /checkpoint|scope|input|stale/iu);
});
