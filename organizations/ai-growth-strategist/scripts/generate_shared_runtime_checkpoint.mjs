import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runBoundedCommand } from './bounded_process_runner.mjs';

const ORGANIZATION_RELATIVE = 'organizations/ai-growth-strategist';
const CHECKPOINT_DIRECTORY_RELATIVE =
  'temp/growth-strategist-v02-implementation/checkpoints';
const CURRENT_RELATIVE = `${CHECKPOINT_DIRECTORY_RELATIVE}/current.json`;
const DEFAULT_MILESTONE = 'shared-growth-runtime';
const DEFAULT_OUTPUT = '01-shared-runtime.json';
const EXCLUDED_ORGANIZATION_DIRECTORIES = Object.freeze([
  'enterprises',
  'tasks',
  'temp',
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
  'tests/control_center_project_artifact_store_test.mjs',
  'tests/control_center_project_context_test.mjs',
  'tests/control_center_project_import_store_test.mjs',
  'tests/control_center_project_store_test.mjs',
]);
const REQUIRED_RUNTIME_ASSETS = Object.freeze([
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
  'organizations/ai-growth-strategist/tests/content_customer_growth_v2_contract.test.mjs',
  'organizations/ai-growth-strategist/tests/content_customer_growth_planner.test.mjs',
  'organizations/ai-growth-strategist/tests/content_customer_growth_debugger.test.mjs',
  'organizations/ai-growth-strategist/tests/content_customer_growth_cli_v2.test.mjs',
  'organizations/ai-growth-strategist/tests/content_customer_growth_v2_assets.test.mjs',
  'organizations/ai-growth-strategist/tests/content_customer_growth_v2_hardening.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_basic_pipeline.test.mjs',
  'organizations/ai-growth-strategist/tests/growth_basic_run_manager.test.mjs',
  'organizations/ai-growth-strategist/tests/organization_quality_profile.test.mjs',
]);
const PROJECT_REGRESSION_TESTS = Object.freeze([
  'tests/control_center_project_store_test.mjs',
  'tests/control_center_project_artifact_store_test.mjs',
  'tests/control_center_project_context_test.mjs',
  'tests/control_center_project_import_store_test.mjs',
]);
const SAFE_MILESTONE = /^[a-z0-9][a-z0-9-]{2,80}$/u;
const SAFE_OUTPUT = /^[0-9]{2}-[a-z0-9][a-z0-9-]{2,100}\.json$/u;
const ORGANIZATION_TEST_MINIMUM = 60;
const PROJECT_REGRESSION_MINIMUM = 11;
const COMMAND_TIMEOUT_MS = 300_000;
const SKILL_VALIDATOR_PATH =
  'C:\\Users\\Administrator\\.codex\\skills\\.system\\skill-creator\\scripts\\quick_validate.py';
const SKILL_VALIDATOR_TRUSTED_ROOT =
  'C:\\Users\\Administrator\\.codex\\skills\\.system\\skill-creator';
const PYTHON_EXECUTABLE_PATH =
  'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const PYTHON_TRUSTED_ROOT =
  'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python';
const PYTHON_VERSION_ARGUMENTS = Object.freeze([
  '-c',
  'import platform; print(platform.python_version())',
]);
const SKILL_IDS = Object.freeze([
  'growth-opportunity-analysis',
  'competitive-benchmark-analysis',
  'content-customer-growth',
]);

export async function generateSharedRuntimeCheckpoint() {
  if (arguments.length !== 0) {
    throw new TypeError(
      'production checkpoint generation accepts zero arguments and uses its fixed project root',
    );
  }
  const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const generated = await generateCheckpointAtFixedRoot({
    projectRoot,
    milestone: DEFAULT_MILESTONE,
    output: DEFAULT_OUTPUT,
  });
  return generated.checkpoint;
}

async function generateCheckpointAtFixedRoot({
  projectRoot: projectRootInput,
  milestone,
  output,
}) {
  const projectRoot = await canonicalDirectory(
    projectRootInput,
    'projectRoot',
  );
  const organizationRoot = path.join(
    projectRoot,
    ...ORGANIZATION_RELATIVE.split('/'),
  );
  const organizationDetails = await lstat(organizationRoot);
  if (!organizationDetails.isDirectory() || organizationDetails.isSymbolicLink()) {
    throw new Error('organization root must be a safe directory');
  }
  const canonicalOrganizationRoot = await realpath(organizationRoot);
  assertInside(projectRoot, canonicalOrganizationRoot, 'organization root');

  if (typeof milestone !== 'string' || !SAFE_MILESTONE.test(milestone)) {
    throw new Error('milestone is invalid or unsafe');
  }
  if (typeof output !== 'string' || !SAFE_OUTPUT.test(output)) {
    throw new Error('output is invalid or unsafe');
  }
  const relativeInputs = await enumerateOrganizationInputs({
    projectRoot,
    organizationRoot: canonicalOrganizationRoot,
  });
  for (let index = 0; index < ROOT_INPUTS.length; index += 1) {
    relativeInputs.push(ROOT_INPUTS[index]);
  }
  relativeInputs.sort(compareText);
  assertUnique(relativeInputs);

  for (let index = 0; index < REQUIRED_RUNTIME_ASSETS.length; index += 1) {
    const required = `${ORGANIZATION_RELATIVE}/${REQUIRED_RUNTIME_ASSETS[index]}`;
    if (!contains(relativeInputs, required)) {
      throw new Error(`missing runtime asset: ${REQUIRED_RUNTIME_ASSETS[index]}`);
    }
  }

  const inputs = {};
  for (let index = 0; index < relativeInputs.length; index += 1) {
    const relative = relativeInputs[index];
    const allowedRoot = relative.startsWith(`${ORGANIZATION_RELATIVE}/`)
      ? canonicalOrganizationRoot
      : projectRoot;
    const absolute = path.join(projectRoot, ...relative.split('/'));
    const bytes = await readSafeRegularFile({
      allowedRoot,
      filePath: absolute,
      label: relative,
    });
    inputs[relative] = sha256(bytes);
  }
  const stateSha256 = calculateStateSha256(inputs);
  const checkpointDirectory = await ensureSafeCheckpointDirectory(projectRoot);
  const checkpointPath = path.join(checkpointDirectory, output);
  const currentPath = path.join(checkpointDirectory, 'current.json');
  const previousCurrent = await readCurrentPointerForGeneration({
    currentPath,
    checkpointDirectory,
  });
  await assertNewImmutableCheckpointTarget({
    checkpointPath,
    checkpointDirectory,
  });
  const verification = await collectMachineVerification(projectRoot);
  const checkpoint = {
    schemaVersion: 4,
    milestone,
    status: 'passed',
    generatedAt: new Date().toISOString(),
    organizationStatus: 'designing',
    acceptsFormalTasks: false,
    externalActionsRequireApproval: true,
    runtimeAssetCount: REQUIRED_RUNTIME_ASSETS.length,
    externalActionCount: 8,
    organizationNodeTests: verification.organizationNodeTests,
    projectRegressionTests: verification.projectRegressionTests,
    skillsValid: verification.skillsValid,
    projectSelfCheckIssues: verification.projectSelfCheckIssues,
    verification,
    inputs,
    inputCount: relativeInputs.length,
    stateSha256,
    sha256: { ...inputs },
    noGitCheckpoint: true,
  };

  await writeJsonAtomic(checkpointPath, checkpoint, projectRoot);
  const checkpointBytes = await readFile(checkpointPath);
  const persisted = JSON.parse(checkpointBytes.toString('utf8'));
  if (JSON.stringify(persisted) !== JSON.stringify(checkpoint)) {
    throw new Error('checkpoint atomic reread mismatch');
  }

  const checkpointRelative = `${CHECKPOINT_DIRECTORY_RELATIVE}/${output}`;
  const current = {
    schemaVersion: 2,
    milestone,
    checkpointPath: checkpointRelative,
    stateSha256,
    checkpointSha256: sha256(checkpointBytes),
  };
  await writeJsonAtomic(currentPath, current, projectRoot);
  const persistedCurrent = JSON.parse(await readFile(currentPath, 'utf8'));
  if (JSON.stringify(persistedCurrent) !== JSON.stringify(current)) {
    throw new Error('current checkpoint pointer atomic reread mismatch');
  }

  return Object.freeze({
    checkpoint: Object.freeze(checkpoint),
    previousCurrent,
    checkpointPath,
    currentPath,
  });
}

async function enumerateOrganizationInputs({ projectRoot, organizationRoot }) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory);
    entries.sort(compareText);
    for (let index = 0; index < entries.length; index += 1) {
      const name = entries[index];
      const absolute = path.join(directory, name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) {
        throw new Error(`unsafe symbolic link in organization scope: ${name}`);
      }
      const physical = await realpath(absolute);
      assertInside(organizationRoot, physical, 'organization scope entry');
      if (details.isDirectory()) {
        if (
          directory === organizationRoot
          && contains(EXCLUDED_ORGANIZATION_DIRECTORIES, name)
        ) {
          continue;
        }
        await visit(absolute);
        continue;
      }
      if (!details.isFile()) {
        throw new Error(`organization scope entry must be a regular file: ${name}`);
      }
      output.push(toPosix(path.relative(projectRoot, absolute)));
    }
  }
  await visit(organizationRoot);
  return output;
}

async function readSafeRegularFile({ allowedRoot, filePath, label }) {
  const details = await lstat(filePath).catch((error) => {
    throw new Error(`input cannot be read: ${label}: ${error.message}`, {
      cause: error,
    });
  });
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`input must be a regular file: ${label}`);
  }
  const physical = await realpath(filePath);
  assertInside(allowedRoot, physical, label);
  return readFile(filePath);
}

async function collectMachineVerification(projectRoot) {
  const organization = await runCommand({
    command: process.execPath,
    args: ['--test', '--test-reporter=tap', ...ORGANIZATION_PROOF_TESTS],
    cwd: projectRoot,
    label: 'organization proof tests',
  });
  const organizationNodeTests = parseTapTestSummary(
    organization,
    'organization proof tests',
  );
  if (organizationNodeTests < ORGANIZATION_TEST_MINIMUM) {
    throw new Error(
      `organization proof tests below minimum ${ORGANIZATION_TEST_MINIMUM}: ${organizationNodeTests}`,
    );
  }

  const projectRegression = await runCommand({
    command: process.execPath,
    args: ['--test', '--test-reporter=tap', ...PROJECT_REGRESSION_TESTS],
    cwd: projectRoot,
    label: 'project regression tests',
  });
  const projectRegressionTests = parseTapTestSummary(
    projectRegression,
    'project regression tests',
  );
  if (projectRegressionTests < PROJECT_REGRESSION_MINIMUM) {
    throw new Error(
      `project regression tests below minimum ${PROJECT_REGRESSION_MINIMUM}: ${projectRegressionTests}`,
    );
  }

  const projectCheck = await runCommand({
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(projectRoot, 'scripts', 'project_self_check.ps1'),
      '-ProjectRoot',
      projectRoot,
    ],
    cwd: projectRoot,
    label: 'project self-check',
  });
  const issueMatches = [
    ...projectCheck.stdout.matchAll(/\bIssues=(\d+)\b/gu),
  ];
  if (
    issueMatches.length !== 1
    || Number(issueMatches[0][1]) !== 0
  ) {
    throw new Error('project self-check did not report exactly Issues=0');
  }

  const validator = await inspectFixedTool({
    fixedPath: SKILL_VALIDATOR_PATH,
    trustedRoot: SKILL_VALIDATOR_TRUSTED_ROOT,
    label: 'skill validator',
  });
  const python = await inspectFixedTool({
    fixedPath: PYTHON_EXECUTABLE_PATH,
    trustedRoot: PYTHON_TRUSTED_ROOT,
    label: 'Python executable',
  });
  const versionResult = await runCommand({
    command: python.path,
    args: [...PYTHON_VERSION_ARGUMENTS],
    cwd: projectRoot,
    label: 'Python version',
  });
  if (
    versionResult.stderr !== ''
    || !/^\d+\.\d+\.\d+\r?\n$/u.test(versionResult.stdout)
  ) {
    throw new Error('Python version output is not canonical');
  }
  const pythonVersion = versionResult.stdout.trim();
  let skillsValid = 0;
  const skillStdout = [];
  const skillStderr = [];
  const skillValidationCommands = [];
  for (let index = 0; index < SKILL_IDS.length; index += 1) {
    const skillId = SKILL_IDS[index];
    const args = [
      validator.path,
      path.join(
        projectRoot,
        'organizations',
        'ai-growth-strategist',
        'skills',
        skillId,
      ),
    ];
    const checked = await runCommand({
      command: python.path,
      args,
      cwd: projectRoot,
      label: `skill validation ${skillId}`,
    });
    if (!/Skill is valid!/u.test(checked.stdout)) {
      throw new Error(`skill validation did not confirm valid: ${skillId}`);
    }
    skillStdout.push(checked.stdout);
    skillStderr.push(checked.stderr);
    skillValidationCommands.push(Object.freeze({
      skillId,
      arguments: Object.freeze([...args]),
    }));
    skillsValid += 1;
  }

  return Object.freeze({
    mode: 'generator-executed-fixed-suite-v1',
    organizationSuite: Object.freeze([...ORGANIZATION_PROOF_TESTS]),
    organizationNodeTests,
    organizationTestMinimum: ORGANIZATION_TEST_MINIMUM,
    organizationStdoutSha256: sha256(Buffer.from(organization.stdout, 'utf8')),
    organizationStderrSha256: sha256(Buffer.from(organization.stderr, 'utf8')),
    projectRegressionSuite: Object.freeze([...PROJECT_REGRESSION_TESTS]),
    projectRegressionTests,
    projectRegressionMinimum: PROJECT_REGRESSION_MINIMUM,
    projectRegressionStdoutSha256: sha256(
      Buffer.from(projectRegression.stdout, 'utf8'),
    ),
    projectRegressionStderrSha256: sha256(
      Buffer.from(projectRegression.stderr, 'utf8'),
    ),
    projectSelfCheckIssues: 0,
    projectSelfCheckStdoutSha256: sha256(
      Buffer.from(projectCheck.stdout, 'utf8'),
    ),
    projectSelfCheckStderrSha256: sha256(
      Buffer.from(projectCheck.stderr, 'utf8'),
    ),
    skillValidatorPath: validator.path,
    skillValidatorSha256: validator.sha256,
    pythonExecutablePath: python.path,
    pythonExecutableSha256: python.sha256,
    pythonVersion,
    skillValidationCommands: Object.freeze(skillValidationCommands),
    skillsValid,
    skillValidationStdoutSha256: sha256(
      Buffer.from(skillStdout.join('\0'), 'utf8'),
    ),
    skillValidationStderrSha256: sha256(
      Buffer.from(skillStderr.join('\0'), 'utf8'),
    ),
  });
}

async function inspectFixedTool({ fixedPath, trustedRoot, label }) {
  const canonicalTrustedRoot = await canonicalDirectory(
    trustedRoot,
    `${label} trusted root`,
  );
  const details = await lstat(fixedPath);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file without links`);
  }
  const physical = await realpath(fixedPath);
  assertInside(canonicalTrustedRoot, physical, label);
  if (
    path.resolve(physical).toLowerCase()
    !== path.resolve(fixedPath).toLowerCase()
  ) {
    throw new Error(`${label} canonical path differs from its fixed path`);
  }
  return Object.freeze({
    path: physical,
    sha256: sha256(await readFile(physical)),
  });
}

function runCommand({ command, args, cwd, label }) {
  const childEnvironment = {
    ...process.env,
    PYTHONUTF8: '1',
  };
  delete childEnvironment.NODE_TEST_CONTEXT;
  return runBoundedCommand({
    command,
    args,
    cwd,
    label,
    timeoutMs: COMMAND_TIMEOUT_MS,
    shutdownTimeoutMs: 15_000,
    env: childEnvironment,
  });
}

function parseTapTestSummary(streams, label) {
  const output = `${streams.stdout}\n${streams.stderr}`;
  const tests = [...output.matchAll(/^# tests (\d+)\r?$/gmu)];
  const passes = [...output.matchAll(/^# pass (\d+)\r?$/gmu)];
  const failures = [...output.matchAll(/^# fail (\d+)\r?$/gmu)];
  if (tests.length !== 1 || passes.length !== 1 || failures.length !== 1) {
    throw new Error(`${label} did not emit one canonical TAP summary`);
  }
  const count = Number(tests[0][1]);
  const passed = Number(passes[0][1]);
  const failed = Number(failures[0][1]);
  if (
    !Number.isSafeInteger(count)
    || count < 1
    || passed !== count
    || failed !== 0
  ) {
    throw new Error(`${label} TAP summary did not prove all tests passed`);
  }
  return count;
}

async function assertNewImmutableCheckpointTarget({
  checkpointPath,
  checkpointDirectory,
}) {
  const existing = await lstat(checkpointPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!existing) return;
  if (!existing.isFile() || existing.isSymbolicLink()) {
    throw new Error('checkpoint target must be a regular file');
  }
  const physical = await realpath(checkpointPath);
  assertInside(checkpointDirectory, physical, 'checkpoint target');
  throw new Error('checkpoint already exists and is immutable');
}

async function readCurrentPointerForGeneration({
  currentPath,
  checkpointDirectory,
}) {
  const details = await lstat(currentPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!details) return null;
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('current checkpoint pointer must be a regular file');
  }
  const physical = await realpath(currentPath);
  assertInside(checkpointDirectory, physical, 'current checkpoint pointer');
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  const keys = Reflect.ownKeys(current);
  const legacyExpected = [
    'schemaVersion',
    'milestone',
    'checkpointPath',
    'stateSha256',
  ];
  const expected = current.schemaVersion === 2
    ? [...legacyExpected, 'checkpointSha256']
    : legacyExpected;
  if (keys.length !== expected.length) {
    throw new Error('current checkpoint pointer contract is invalid');
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (!Object.hasOwn(current, expected[index])) {
      throw new Error('current checkpoint pointer contract is invalid');
    }
  }
  const checkpointPrefix = `${CHECKPOINT_DIRECTORY_RELATIVE}/`;
  if (
    (current.schemaVersion !== 1 && current.schemaVersion !== 2)
    || typeof current.milestone !== 'string'
    || !SAFE_MILESTONE.test(current.milestone)
    || typeof current.checkpointPath !== 'string'
    || !current.checkpointPath.startsWith(checkpointPrefix)
    || current.checkpointPath.includes('\\')
    || current.checkpointPath.includes('%')
    || path.posix.normalize(current.checkpointPath) !== current.checkpointPath
    || !/^[0-9a-f]{64}$/u.test(current.stateSha256)
    || (
      current.schemaVersion === 2
      && !/^[0-9a-f]{64}$/u.test(current.checkpointSha256)
    )
  ) {
    throw new Error('current checkpoint pointer contract is invalid or unsafe');
  }
  return current;
}

async function activateGeneratedCheckpoint({ generated, projectRoot }) {
  try {
    const checked = await runCommand({
      command: process.execPath,
      args: [
        path.join(
          projectRoot,
          'organizations',
          'ai-growth-strategist',
          'scripts',
          'organization_self_check.mjs',
        ),
      ],
      cwd: projectRoot,
      label: 'checkpoint activation self-check',
    });
    const report = JSON.parse(checked.stdout);
    if (
      !report
      || typeof report !== 'object'
      || report.ok !== true
      || report.checkpointVerified !== true
      || report.checkpointMilestone !== generated.checkpoint.milestone
    ) {
      throw new Error('checkpoint activation self-check returned a failed report');
    }
    return Object.freeze(report);
  } catch (error) {
    await rollbackCurrentPointer({
      currentPath: generated.currentPath,
      previousCurrent: generated.previousCurrent,
      projectRoot,
    });
    throw new Error(
      `checkpoint activation self-check failed and current was rolled back: ${error.message}`,
      { cause: error },
    );
  }
}

async function rollbackCurrentPointer({
  currentPath,
  previousCurrent,
  projectRoot,
}) {
  if (previousCurrent) {
    await writeJsonAtomic(currentPath, previousCurrent, projectRoot);
    return;
  }
  const checkpointDirectory = await ensureSafeCheckpointDirectory(projectRoot);
  await assertSafeAtomicTarget({
    targetPath: currentPath,
    checkpointDirectory,
    allowMissing: false,
  });
  await rm(currentPath);
}

async function ensureSafeCheckpointDirectory(projectRoot) {
  const segments = [
    'temp',
    'growth-strategist-v02-implementation',
    'checkpoints',
  ];
  let current = projectRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let details = await lstat(current).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!details) {
      await mkdir(current).catch((error) => {
        if (error?.code !== 'EEXIST') throw error;
      });
      details = await lstat(current);
    }
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(
        `checkpoint directory chain contains a symbolic link, junction, reparse point, or non-directory: ${segments[index]}`,
      );
    }
    const physical = await realpath(current);
    assertInside(projectRoot, physical, `checkpoint directory ${segments[index]}`);
  }
  return current;
}

async function assertSafeAtomicTarget({
  targetPath,
  checkpointDirectory,
  allowMissing,
}) {
  const details = await lstat(targetPath).catch((error) => {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!details) return;
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('atomic target must be a regular file without links');
  }
  const physical = await realpath(targetPath);
  assertInside(checkpointDirectory, physical, 'atomic target');
}

async function writeJsonAtomic(targetPath, value, projectRoot) {
  const checkpointDirectory = await ensureSafeCheckpointDirectory(projectRoot);
  if (path.dirname(targetPath) !== checkpointDirectory) {
    throw new Error('atomic target is outside the verified checkpoint directory');
  }
  await assertSafeAtomicTarget({
    targetPath,
    checkpointDirectory,
    allowMissing: true,
  });
  const temporaryPath = path.join(
    checkpointDirectory,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, 'wx');
    await assertSafeAtomicTarget({
      targetPath: temporaryPath,
      checkpointDirectory,
      allowMissing: false,
    });
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await assertSafeAtomicTarget({
      targetPath: temporaryPath,
      checkpointDirectory,
      allowMissing: false,
    });
    await handle.close();
    handle = undefined;
    await ensureSafeCheckpointDirectory(projectRoot);
    await rename(temporaryPath, targetPath);
    await assertSafeAtomicTarget({
      targetPath,
      checkpointDirectory,
      allowMissing: false,
    });
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function canonicalDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  const direct = await lstat(value);
  if (!direct.isDirectory() || direct.isSymbolicLink()) {
    throw new Error(`${label} must be a safe directory`);
  }
  return realpath(value);
}

function calculateStateSha256(inputs) {
  const paths = Object.keys(inputs);
  paths.sort(compareText);
  const hash = createHash('sha256');
  for (let index = 0; index < paths.length; index += 1) {
    const relative = paths[index];
    hash.update(relative, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(inputs[relative], 'ascii');
    hash.update('\n', 'ascii');
  }
  return hash.digest('hex');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}


function assertInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes its allowed root`);
  }
}

function assertUnique(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === values[index - 1]) {
      throw new Error(`duplicate checkpoint input: ${values[index]}`);
    }
  }
}

function contains(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function parseCliArguments(values) {
  const result = Object.create(null);
  const allowed = ['milestone', 'output'];
  for (let index = 0; index < values.length; index += 1) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(values[index]);
    if (!match) throw new Error(`invalid CLI argument: ${values[index]}`);
    const [, name, raw] = match;
    if (!contains(allowed, name)) {
      throw new Error(`unexpected or forbidden CLI argument: ${name}`);
    }
    if (Object.hasOwn(result, name)) {
      throw new Error(`duplicate CLI argument: ${name}`);
    }
    result[name] = raw;
  }
  return result;
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    const args = parseCliArguments(process.argv.slice(2));
    const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
    const generated = await generateCheckpointAtFixedRoot({
      projectRoot,
      milestone: args.milestone ?? DEFAULT_MILESTONE,
      output: args.output ?? DEFAULT_OUTPUT,
    });
    const activation = await activateGeneratedCheckpoint({
      generated,
      projectRoot,
    });
    const checkpoint = generated.checkpoint;
    process.stdout.write(`${JSON.stringify({
      ok: true,
      milestone: checkpoint.milestone,
      inputCount: checkpoint.inputCount,
      stateSha256: checkpoint.stateSha256,
      checkpointSha256: sha256(await readFile(generated.checkpointPath)),
      activationSelfCheck: activation.ok,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
