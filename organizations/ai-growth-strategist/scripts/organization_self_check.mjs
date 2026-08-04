import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ORGANIZATION_RELATIVE = 'organizations/ai-growth-strategist';
const CHECKPOINT_DIRECTORY_RELATIVE =
  'temp/growth-strategist-v02-implementation/checkpoints';
const CURRENT_RELATIVE = `${CHECKPOINT_DIRECTORY_RELATIVE}/current.json`;
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
const SKILLS = Object.freeze([
  Object.freeze({
    id: 'growth-opportunity-analysis',
    name: '增长机会分析',
    status: 'designing',
    workflow: 'GROWTH_OPPORTUNITY_ANALYSIS.md',
  }),
  Object.freeze({
    id: 'competitive-benchmark-analysis',
    name: '竞争对标拆解',
    status: 'designing',
    workflow: 'COMPETITIVE_BENCHMARK_ANALYSIS.md',
  }),
  Object.freeze({
    id: 'content-customer-growth',
    name: '内容与客户增长',
    status: 'designing',
    workflow: 'CONTENT_CUSTOMER_GROWTH.md',
  }),
]);
const PUBLIC_DEPENDENCIES = Object.freeze([
  Object.freeze({
    id: 'public.promotional-poster',
    mode: 'via-control-center',
  }),
  Object.freeze({
    id: 'public.taobao-ecommerce-image-set',
    mode: 'via-control-center',
  }),
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
const CONFIG_FIELDS = Object.freeze([
  'schemaVersion',
  'id',
  'displayName',
  'systemName',
  'deploymentMode',
  'status',
  'acceptsFormalTasks',
  'rootControllerRegistration',
  'formalTaskRouting',
  'peerOrganizationCalls',
  'coreSkills',
  'publicSkillDependencies',
]);
const REGISTRY_ORGANIZATION_FIELDS = Object.freeze([
  'id',
  'displayName',
  'aliases',
  'systemName',
  'status',
  'acceptsFormalTasks',
  'directory',
  'coreSkills',
]);
const SKILL_FIELDS = Object.freeze(['id', 'name', 'status']);
const DEPENDENCY_FIELDS = Object.freeze(['id', 'mode']);
const CURRENT_FIELDS = Object.freeze([
  'schemaVersion',
  'milestone',
  'checkpointPath',
  'stateSha256',
  'checkpointSha256',
]);
const CHECKPOINT_FIELDS = Object.freeze([
  'schemaVersion',
  'milestone',
  'status',
  'generatedAt',
  'organizationStatus',
  'acceptsFormalTasks',
  'externalActionsRequireApproval',
  'runtimeAssetCount',
  'externalActionCount',
  'organizationNodeTests',
  'projectRegressionTests',
  'skillsValid',
  'projectSelfCheckIssues',
  'verification',
  'inputs',
  'inputCount',
  'stateSha256',
  'sha256',
  'noGitCheckpoint',
]);
const VERIFICATION_FIELDS = Object.freeze([
  'mode',
  'organizationSuite',
  'organizationNodeTests',
  'organizationTestMinimum',
  'organizationStdoutSha256',
  'organizationStderrSha256',
  'projectRegressionSuite',
  'projectRegressionTests',
  'projectRegressionMinimum',
  'projectRegressionStdoutSha256',
  'projectRegressionStderrSha256',
  'projectSelfCheckIssues',
  'projectSelfCheckStdoutSha256',
  'projectSelfCheckStderrSha256',
  'skillValidatorPath',
  'skillValidatorSha256',
  'pythonExecutablePath',
  'pythonExecutableSha256',
  'pythonVersion',
  'skillValidationCommands',
  'skillsValid',
  'skillValidationStdoutSha256',
  'skillValidationStderrSha256',
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
const SAFE_SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_MILESTONE = /^[a-z0-9][a-z0-9-]{2,80}$/u;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 30_000;
const ORGANIZATION_TEST_MINIMUM = 60;
const PROJECT_REGRESSION_MINIMUM = 11;
const TOOL_TIMEOUT_MS = 30_000;
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

export async function runOrganizationSelfCheck() {
  if (arguments.length !== 0) {
    throw new TypeError(
      'production organization self-check accepts zero arguments and uses its fixed project root',
    );
  }
  const projectRootInput = path.resolve(import.meta.dirname, '..', '..', '..');
  try {
    return await performOrganizationSelfCheck(projectRootInput);
  } catch (error) {
    return frozenResult({
      failures: [`organization self-check failed safely: ${error.message}`],
      checkpointVerified: false,
    });
  }
}

async function performOrganizationSelfCheck(projectRootInput) {
  const projectRoot = await canonicalDirectory(projectRootInput, 'projectRoot');
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

  const relativeInputs = await enumerateOrganizationInputs({
    projectRoot,
    organizationRoot: canonicalOrganizationRoot,
  });
  for (let index = 0; index < ROOT_INPUTS.length; index += 1) {
    relativeInputs.push(ROOT_INPUTS[index]);
  }
  relativeInputs.sort(compareText);
  assertUnique(relativeInputs);
  for (let index = 0; index < RUNTIME_ASSETS.length; index += 1) {
    const required = `${ORGANIZATION_RELATIVE}/${RUNTIME_ASSETS[index]}`;
    if (!contains(relativeInputs, required)) {
      throw new Error(`missing runtime asset: ${RUNTIME_ASSETS[index]}`);
    }
  }

  const currentHashes = {};
  const inputBytes = Object.create(null);
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
    currentHashes[relative] = sha256(bytes);
    inputBytes[relative] = bytes;
  }

  const currentPath = path.join(projectRoot, ...CURRENT_RELATIVE.split('/'));
  const current = parseJsonObject(
    await readSafeRegularFile({
      allowedRoot: projectRoot,
      filePath: currentPath,
      label: 'current checkpoint pointer',
    }),
    'current checkpoint pointer',
  );
  assertExactFields(current, CURRENT_FIELDS, 'current checkpoint pointer');
  if (
    current.schemaVersion !== 2
    || typeof current.milestone !== 'string'
    || !SAFE_MILESTONE.test(current.milestone)
    || typeof current.checkpointPath !== 'string'
    || !SAFE_SHA256.test(current.stateSha256)
    || !SAFE_SHA256.test(current.checkpointSha256)
  ) {
    throw new Error('current checkpoint pointer contract is invalid');
  }
  const expectedPrefix = `${CHECKPOINT_DIRECTORY_RELATIVE}/`;
  if (
    !current.checkpointPath.startsWith(expectedPrefix)
    || current.checkpointPath === CURRENT_RELATIVE
    || current.checkpointPath.includes('\\')
    || current.checkpointPath.includes('%')
    || path.posix.normalize(current.checkpointPath) !== current.checkpointPath
  ) {
    throw new Error('current checkpoint pointer escapes its checkpoint directory');
  }
  const checkpointPath = path.resolve(
    projectRoot,
    ...current.checkpointPath.split('/'),
  );
  const checkpointDirectory = path.resolve(
    projectRoot,
    ...CHECKPOINT_DIRECTORY_RELATIVE.split('/'),
  );
  assertInside(checkpointDirectory, checkpointPath, 'current checkpoint pointer');
  const checkpointBytes = await readSafeRegularFile({
    allowedRoot: checkpointDirectory,
    filePath: checkpointPath,
    label: 'current checkpoint',
  });
  if (sha256(checkpointBytes) !== current.checkpointSha256) {
    throw new Error('current checkpoint SHA-256 integrity check failed');
  }
  const checkpoint = parseJsonObject(checkpointBytes, 'current checkpoint');
  validateCheckpointProjection(checkpoint, current);
  await validateExternalToolchain({
    checkpoint,
    projectRoot,
  });
  const checkpointPaths = Object.keys(checkpoint.inputs);
  checkpointPaths.sort(compareText);
  if (!sameStringArray(checkpointPaths, relativeInputs)) {
    throw new Error('checkpoint input scope is stale or incomplete');
  }
  for (let index = 0; index < relativeInputs.length; index += 1) {
    const relative = relativeInputs[index];
    if (checkpoint.inputs[relative] !== currentHashes[relative]) {
      throw new Error(`checkpoint hash is stale: ${relative}`);
    }
    if (checkpoint.sha256[relative] !== currentHashes[relative]) {
      throw new Error(`checkpoint legacy sha256 is stale: ${relative}`);
    }
  }
  const currentStateSha256 = calculateStateSha256(currentHashes);
  if (
    checkpoint.stateSha256 !== currentStateSha256
    || current.stateSha256 !== currentStateSha256
  ) {
    throw new Error('checkpoint stateSha256 is stale');
  }

  const failures = [];
  const configRelative =
    `${ORGANIZATION_RELATIVE}/config/organization.json`;
  const registryRelative = 'control-center/registries/organizations.json';
  const config = parseJsonObject(inputBytes[configRelative], 'organization config');
  const registry = parseJsonObject(inputBytes[registryRelative], 'root registry');
  validateConfigProjection(config, failures);
  validateRegistryProjection(registry, failures);

  const runtimeReview = await reviewRuntimeModules({
    organizationRoot: canonicalOrganizationRoot,
  });
  if (!runtimeReview.ok) {
    failures.push(runtimeReview.failure);
  }
  const validatorReview = await reviewValidators({
    organizationRoot: canonicalOrganizationRoot,
  });
  if (!validatorReview.ok) {
    failures.push(validatorReview.failure);
  }

  return frozenResult({
    failures,
    checkpointVerified: true,
    checkpointMilestone: checkpoint.milestone,
    checkpointPath: current.checkpointPath,
    inputCount: checkpoint.inputCount,
    stateSha256: checkpoint.stateSha256,
    externalActions: runtimeReview.ok
      ? runtimeReview.externalActions
      : EXTERNAL_ACTIONS,
  });
}

function validateCheckpointProjection(checkpoint, current) {
  assertExactFields(checkpoint, CHECKPOINT_FIELDS, 'current checkpoint');
  if (
    checkpoint.schemaVersion !== 4
    || checkpoint.milestone !== current.milestone
    || checkpoint.status !== 'passed'
    || typeof checkpoint.generatedAt !== 'string'
    || Number.isNaN(Date.parse(checkpoint.generatedAt))
    || new Date(checkpoint.generatedAt).toISOString() !== checkpoint.generatedAt
    || checkpoint.organizationStatus !== 'designing'
    || checkpoint.acceptsFormalTasks !== false
    || checkpoint.externalActionsRequireApproval !== true
    || checkpoint.runtimeAssetCount !== RUNTIME_ASSETS.length
    || checkpoint.externalActionCount !== 8
    || !Number.isSafeInteger(checkpoint.organizationNodeTests)
    || checkpoint.organizationNodeTests < 0
    || !Number.isSafeInteger(checkpoint.projectRegressionTests)
    || checkpoint.projectRegressionTests < 0
    || checkpoint.skillsValid !== 3
    || !Number.isSafeInteger(checkpoint.projectSelfCheckIssues)
    || checkpoint.projectSelfCheckIssues !== 0
    || !Number.isSafeInteger(checkpoint.inputCount)
    || checkpoint.inputCount < 1
    || !SAFE_SHA256.test(checkpoint.stateSha256)
    || checkpoint.noGitCheckpoint !== true
  ) {
    throw new Error('current checkpoint projection is invalid');
  }
  assertHashObject(checkpoint.inputs, checkpoint.inputCount, 'checkpoint inputs');
  assertHashObject(checkpoint.sha256, checkpoint.inputCount, 'checkpoint sha256');
  validateMachineVerification(checkpoint);
  if (
    JSON.stringify(checkpoint.inputs) !== JSON.stringify(checkpoint.sha256)
    || checkpoint.stateSha256 !== current.stateSha256
  ) {
    throw new Error('checkpoint hashes or current pointer are inconsistent');
  }
}

function validateMachineVerification(checkpoint) {
  const verification = checkpoint.verification;
  assertExactFields(
    verification,
    VERIFICATION_FIELDS,
    'checkpoint machine verification',
  );
  if (
    verification.mode !== 'generator-executed-fixed-suite-v1'
    || !sameStringArray(
      verification.organizationSuite,
      ORGANIZATION_PROOF_TESTS,
    )
    || verification.organizationNodeTests !== checkpoint.organizationNodeTests
    || verification.organizationTestMinimum !== ORGANIZATION_TEST_MINIMUM
    || verification.organizationNodeTests < ORGANIZATION_TEST_MINIMUM
    || !SAFE_SHA256.test(verification.organizationStdoutSha256)
    || !SAFE_SHA256.test(verification.organizationStderrSha256)
    || !sameStringArray(
      verification.projectRegressionSuite,
      PROJECT_REGRESSION_TESTS,
    )
    || verification.projectRegressionTests !== checkpoint.projectRegressionTests
    || verification.projectRegressionMinimum !== PROJECT_REGRESSION_MINIMUM
    || verification.projectRegressionTests < PROJECT_REGRESSION_MINIMUM
    || !SAFE_SHA256.test(verification.projectRegressionStdoutSha256)
    || !SAFE_SHA256.test(verification.projectRegressionStderrSha256)
    || verification.projectSelfCheckIssues !== 0
    || verification.projectSelfCheckIssues !== checkpoint.projectSelfCheckIssues
    || verification.skillsValid !== 3
    || verification.skillsValid !== checkpoint.skillsValid
    || !SAFE_SHA256.test(verification.projectSelfCheckStdoutSha256)
    || !SAFE_SHA256.test(verification.projectSelfCheckStderrSha256)
    || typeof verification.skillValidatorPath !== 'string'
    || !SAFE_SHA256.test(verification.skillValidatorSha256)
    || typeof verification.pythonExecutablePath !== 'string'
    || !SAFE_SHA256.test(verification.pythonExecutableSha256)
    || typeof verification.pythonVersion !== 'string'
    || !/^\d+\.\d+\.\d+$/u.test(verification.pythonVersion)
    || !Array.isArray(verification.skillValidationCommands)
    || verification.skillValidationCommands.length !== SKILL_IDS.length
    || !SAFE_SHA256.test(verification.skillValidationStdoutSha256)
    || !SAFE_SHA256.test(verification.skillValidationStderrSha256)
  ) {
    throw new Error('checkpoint machine verification is invalid or below minimum');
  }
}

async function validateExternalToolchain({ checkpoint, projectRoot }) {
  const verification = checkpoint.verification;
  const validator = await inspectFixedTool({
    fixedPath: SKILL_VALIDATOR_PATH,
    trustedRoot: SKILL_VALIDATOR_TRUSTED_ROOT,
    label: 'skill validator tool',
  });
  if (
    verification.skillValidatorPath !== validator.path
    || verification.skillValidatorSha256 !== validator.sha256
  ) {
    throw new Error('skill validator tool path or SHA-256 is stale');
  }

  const python = await inspectFixedTool({
    fixedPath: PYTHON_EXECUTABLE_PATH,
    trustedRoot: PYTHON_TRUSTED_ROOT,
    label: 'Python executable',
  });
  if (
    verification.pythonExecutablePath !== python.path
    || verification.pythonExecutableSha256 !== python.sha256
  ) {
    throw new Error('Python executable path or SHA-256 is stale');
  }
  const versionResult = await runToolCommand({
    command: python.path,
    args: [...PYTHON_VERSION_ARGUMENTS],
    cwd: projectRoot,
    label: 'Python version',
  });
  if (
    versionResult.stderr !== ''
    || !/^\d+\.\d+\.\d+\r?\n$/u.test(versionResult.stdout)
    || versionResult.stdout.trim() !== verification.pythonVersion
  ) {
    throw new Error('Python version does not match checkpoint verification');
  }

  const expectedCommands = [];
  for (let index = 0; index < SKILL_IDS.length; index += 1) {
    const skillId = SKILL_IDS[index];
    expectedCommands.push({
      skillId,
      arguments: [
        validator.path,
        path.join(
          projectRoot,
          'organizations',
          'ai-growth-strategist',
          'skills',
          skillId,
        ),
      ],
    });
  }
  if (
    JSON.stringify(verification.skillValidationCommands)
    !== JSON.stringify(expectedCommands)
  ) {
    throw new Error('skill validator command arguments are invalid or stale');
  }
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

function runToolCommand({ command, args, cwd, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`${label} timed out after ${TOOL_TIMEOUT_MS}ms`));
    }, TOOL_TIMEOUT_MS);
    child.once('error', (error) => {
      finish(new Error(`${label} failed to start: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (code !== 0 || signal !== null) {
        finish(new Error(
          `${label} failed: code=${code} signal=${signal ?? 'none'}`,
        ));
        return;
      }
      finish(null, { stdout, stderr });
    });
  });
}

function validateConfigProjection(config, failures) {
  try {
    assertExactFields(config, CONFIG_FIELDS, 'organization config');
    assertScalarProjection(config, {
      schemaVersion: 1,
      id: 'ai-growth-strategist',
      displayName: 'AI增长战略官',
      systemName: '增长获客系统',
      deploymentMode: 'same_project_organization_module',
      status: 'designing',
      acceptsFormalTasks: false,
      rootControllerRegistration: 'registered_designing',
      formalTaskRouting: 'fallback_existing',
      peerOrganizationCalls: 'contract_only',
    }, 'organization config');
    assertSkillArray(config.coreSkills, 'organization config coreSkills');
    assertDependencyArray(config.publicSkillDependencies);
  } catch (error) {
    failures.push(`organization config projection failed: ${error.message}`);
  }
}

function validateRegistryProjection(registry, failures) {
  try {
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
      throw new Error('root registry must be an object');
    }
    if (!Array.isArray(registry.organizations)) {
      throw new Error('root registry organizations must be an array');
    }
    let registered = null;
    for (let index = 0; index < registry.organizations.length; index += 1) {
      const item = registry.organizations[index];
      if (item?.id === 'ai-growth-strategist') {
        if (registered !== null) {
          throw new Error('growth strategist is duplicated in root registry');
        }
        registered = item;
      }
    }
    if (registered === null) {
      throw new Error('growth strategist is absent from root registry');
    }
    assertExactFields(
      registered,
      REGISTRY_ORGANIZATION_FIELDS,
      'growth strategist root registry projection',
    );
    assertScalarProjection(registered, {
      id: 'ai-growth-strategist',
      displayName: 'AI增长战略官',
      systemName: '增长获客系统',
      status: 'designing',
      acceptsFormalTasks: false,
      directory: 'organizations/ai-growth-strategist',
    }, 'growth strategist root registry projection');
    if (!sameStringArray(registered.aliases, ['增长战略官', '增长官'])) {
      throw new Error('growth strategist aliases are inconsistent');
    }
    assertSkillArray(registered.coreSkills, 'root registry coreSkills');
  } catch (error) {
    failures.push(`root registry projection failed: ${error.message}`);
  }
}

async function reviewRuntimeModules({ organizationRoot }) {
  const nonce = randomUUID();
  const source = String.raw`
const nonce = process.argv[1];
const gateUrl = process.argv[2];
const managerUrl = process.argv[3];
const stringify = JSON.stringify;
const freeze = Object.freeze;
const isFrozen = Object.isFrozen;
const write = process.stdout.write.bind(process.stdout);
for (const prototype of [
  Array.prototype,
  Object.prototype,
  Set.prototype,
  Map.prototype,
]) freeze(prototype);
const gate = await import(gateUrl);
const manager = await import(managerUrl);
const actions = manager.EXTERNAL_ACTIONS;
const expected = [
  'publish_content',
  'paid_media',
  'contact_customer',
  'change_price',
  'change_refund_rule',
  'brand_commitment',
  'deal_commitment',
  'write_external_system',
];
const values = [...actions];
const namedValues = [...actions.values()];
const exact = stringify(values) === stringify(expected)
  && stringify(namedValues) === stringify(expected);
const result = {
  nonce,
  identity: gate.EXTERNAL_ACTIONS === actions,
  exact,
  size: actions.size,
  frozen: isFrozen(actions),
  noMutators: actions.add === undefined
    && actions.delete === undefined
    && actions.clear === undefined,
  values,
};
write(stringify(result) + '\n');
`;
  const result = await runIsolatedNode({
    source,
    args: [
      nonce,
      pathToFileURL(path.join(
        organizationRoot,
        'scripts',
        'growth_approval_gate.mjs',
      )).href,
      pathToFileURL(path.join(
        organizationRoot,
        'scripts',
        'growth_experiment_manager.mjs',
      )).href,
    ],
    label: 'runtime module review',
  });
  if (!result.ok) return result;
  const value = result.value;
  if (
    value.nonce !== nonce
    || value.identity !== true
    || value.exact !== true
    || value.size !== 8
    || value.frozen !== true
    || value.noMutators !== true
    || !sameStringArray(value.values, EXTERNAL_ACTIONS)
  ) {
    return {
      ok: false,
      failure: 'runtime module review reported external action drift',
    };
  }
  return { ok: true, externalActions: value.values };
}

async function reviewValidators({ organizationRoot }) {
  const nonce = randomUUID();
  const source = String.raw`
const nonce = process.argv[1];
const organizationRootUrl = process.argv[2];
const organizationRootPath = process.argv[3];
const stringify = JSON.stringify;
const freeze = Object.freeze;
const write = process.stdout.write.bind(process.stdout);
for (const prototype of [
  Array.prototype,
  Object.prototype,
  Set.prototype,
  Map.prototype,
]) freeze(prototype);
const { readFile } = await import('node:fs/promises');
const modules = [
  ['growth_opportunity_contract.mjs', 'validateGrowthOpportunityCandidate', 'growth-opportunity-analysis.demo.json'],
  ['competitive_benchmark_contract.mjs', 'validateCompetitiveBenchmarkCandidate', 'competitive-benchmark-analysis.demo.json'],
  ['content_customer_growth_contract.mjs', 'validateContentCustomerGrowthCandidate', 'content-customer-growth.demo.json'],
];
let validated = 0;
for (let index = 0; index < modules.length; index += 1) {
  const [script, validator, example] = modules[index];
  const loaded = await import(organizationRootUrl + '/scripts/' + script);
  const raw = await readFile(organizationRootPath + '/examples/' + example, 'utf8');
  loaded[validator](JSON.parse(raw));
  validated += 1;
}
write(stringify({ nonce, validated }) + '\n');
`;
  const result = await runIsolatedNode({
    source,
    args: [
      nonce,
      pathToFileURL(organizationRoot).href,
      organizationRoot.replaceAll('\\', '/'),
    ],
    label: 'validator review',
  });
  if (!result.ok) return result;
  if (result.value.nonce !== nonce || result.value.validated !== 3) {
    return {
      ok: false,
      failure: 'validator review returned an invalid result',
    };
  }
  return { ok: true };
}

function runIsolatedNode({ source, args, label }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', source, ...args],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        failure: `${label} timed out after ${CHILD_TIMEOUT_MS}ms`,
      });
    }, CHILD_TIMEOUT_MS);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.once('error', (error) => {
      finish({ ok: false, failure: `${label} failed to start: ${error.message}` });
    });
    child.once('close', (code, signal) => {
      if (code !== 0 || signal !== null || stderr !== '') {
        finish({
          ok: false,
          failure: `${label} child failed: code=${code} signal=${signal ?? 'none'} ${stderr.trim()}`,
        });
        return;
      }
      if (!stdout.endsWith('\n') || stdout.slice(0, -1).includes('\n')) {
        finish({ ok: false, failure: `${label} emitted anomalous output` });
        return;
      }
      try {
        const value = JSON.parse(stdout);
        if (`${JSON.stringify(value)}\n` !== stdout) {
          finish({ ok: false, failure: `${label} output is not canonical JSON` });
          return;
        }
        finish({ ok: true, value });
      } catch (error) {
        finish({ ok: false, failure: `${label} output is invalid: ${error.message}` });
      }
    });
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
    throw new Error(`${label} cannot be read: ${error.message}`, { cause: error });
  });
  if (
    !details.isFile()
    || details.isSymbolicLink()
    || details.size > MAX_INPUT_BYTES
  ) {
    throw new Error(`${label} must be a regular bounded file`);
  }
  const physical = await realpath(filePath);
  assertInside(allowedRoot, physical, label);
  return readFile(filePath);
}

function parseJsonObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} JSON is invalid: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactFields(value, expectedFields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedFields.length) {
    throw new Error(`${label} has missing or unexpected fields`);
  }
  for (let index = 0; index < expectedFields.length; index += 1) {
    if (!Object.hasOwn(value, expectedFields[index])) {
      throw new Error(`${label} is missing field: ${expectedFields[index]}`);
    }
  }
  for (let index = 0; index < keys.length; index += 1) {
    if (typeof keys[index] !== 'string' || !contains(expectedFields, keys[index])) {
      throw new Error(`${label} has unexpected field: ${String(keys[index])}`);
    }
  }
}

function assertHashObject(value, expectedCount, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== expectedCount) {
    throw new Error(`${label} count is inconsistent`);
  }
  const sorted = [...keys];
  sorted.sort(compareText);
  if (!sameStringArray(keys, sorted)) {
    throw new Error(`${label} paths must be canonically sorted`);
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (
      typeof key !== 'string'
      || key.includes('\\')
      || path.posix.normalize(key) !== key
      || key.startsWith('../')
      || !SAFE_SHA256.test(value[key])
    ) {
      throw new Error(`${label} contains an unsafe path or hash`);
    }
  }
}

function assertScalarProjection(actual, expected, label) {
  const keys = Object.keys(expected);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (actual[key] !== expected[key]) {
      throw new Error(`${label}.${key} is inconsistent`);
    }
  }
}

function assertSkillArray(value, label) {
  if (!Array.isArray(value) || value.length !== SKILLS.length) {
    throw new Error(`${label} must contain exactly three skills`);
  }
  for (let index = 0; index < SKILLS.length; index += 1) {
    assertExactFields(value[index], SKILL_FIELDS, `${label}[${index}]`);
    assertScalarProjection(value[index], {
      id: SKILLS[index].id,
      name: SKILLS[index].name,
      status: SKILLS[index].status,
    }, `${label}[${index}]`);
  }
}

function assertDependencyArray(value) {
  if (!Array.isArray(value) || value.length !== PUBLIC_DEPENDENCIES.length) {
    throw new Error('publicSkillDependencies must contain exactly two entries');
  }
  for (let index = 0; index < PUBLIC_DEPENDENCIES.length; index += 1) {
    assertExactFields(
      value[index],
      DEPENDENCY_FIELDS,
      `publicSkillDependencies[${index}]`,
    );
    assertScalarProjection(
      value[index],
      PUBLIC_DEPENDENCIES[index],
      `publicSkillDependencies[${index}]`,
    );
  }
}

async function canonicalDirectory(value, label) {
  const details = await lstat(value);
  if (!details.isDirectory() || details.isSymbolicLink()) {
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

function frozenResult({
  failures,
  checkpointVerified,
  checkpointMilestone = null,
  checkpointPath = null,
  inputCount = 0,
  stateSha256 = null,
  externalActions = EXTERNAL_ACTIONS,
}) {
  const frozenFailures = Object.freeze([...failures]);
  return Object.freeze({
    ok: frozenFailures.length === 0,
    skillCount: SKILLS.length,
    obsoleteSkillIds: Object.freeze([]),
    runtimeAssets: RUNTIME_ASSETS,
    runtimeAssetCount: RUNTIME_ASSETS.length,
    externalActions: Object.freeze([...externalActions]),
    externalActionCount: externalActions.length,
    organizationStatus: 'designing',
    acceptsFormalTasks: false,
    checkpointVerified,
    checkpointMilestone,
    checkpointPath,
    inputCount,
    stateSha256,
    failures: frozenFailures,
  });
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
      throw new Error(`duplicate self-check input: ${values[index]}`);
    }
  }
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const result = await runOrganizationSelfCheck();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
