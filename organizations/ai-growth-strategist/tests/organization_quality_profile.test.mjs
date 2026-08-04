import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const organizationRoot = path.join(
  projectRoot,
  'organizations',
  'ai-growth-strategist',
);
const qualityPath = path.join(
  organizationRoot,
  'quality',
  'organization-quality.json',
);
const skillIds = [
  'growth-opportunity-analysis',
  'competitive-benchmark-analysis',
  'content-customer-growth',
];
const requiredGapCodes = [
  'real_enterprise_task',
  'modification_closure',
  'exception_recovery',
  'cross_organization_handoff',
];
const evidenceLevels = new Set([
  'design',
  'simulation',
  'internal_real',
  'real_accepted',
]);

test('all growth strategist skills declare explicit dependencies', async () => {
  for (const skillId of skillIds) {
    const skillPath = path.join(
      organizationRoot,
      'skills',
      skillId,
      'SKILL.md',
    );
    const skill = await readFile(skillPath, 'utf8');
    assert.match(
      skill,
      /^## 依赖\s*$/mu,
      `${skillId} must contain an explicit ## 依赖 section`,
    );
  }
});

test('organization quality profile uses the unified honest schema', async () => {
  const profile = JSON.parse(await readFile(qualityPath, 'utf8'));
  assertExactFields(profile, [
    'schemaVersion',
    'organizationId',
    'declaredRootStatus',
    'acceptsFormalTasks',
    'skills',
    'fast',
    'accurate',
    'stable',
    'knownGaps',
    'nextOrganizationGate',
  ], 'organization quality profile');
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.organizationId, 'ai-growth-strategist');
  assert.equal(profile.declaredRootStatus, 'designing');
  assert.equal(profile.acceptsFormalTasks, false);
  assert.deepEqual(profile.skills.map((skill) => skill.id), skillIds);

  for (const skill of profile.skills) {
    assertExactFields(skill, [
      'id',
      'skillPath',
      'workflowPath',
      'runtimePaths',
      'testPaths',
      'qualityProofPaths',
      'evidenceLevel',
      'knownGaps',
      'nextGate',
    ], `quality profile skill ${skill.id}`);
    assert.ok(evidenceLevels.has(skill.evidenceLevel));
    assert.notEqual(
      skill.evidenceLevel,
      'real_accepted',
      `${skill.id} has no accepted real-enterprise evidence`,
    );
    assertNonEmptyPathArray(skill.runtimePaths, `${skill.id}.runtimePaths`);
    assertNonEmptyPathArray(skill.testPaths, `${skill.id}.testPaths`);
    assertNonEmptyPathArray(
      skill.qualityProofPaths,
      `${skill.id}.qualityProofPaths`,
    );
    assertSafeProjectPath(skill.skillPath, `${skill.id}.skillPath`);
    assertSafeProjectPath(skill.workflowPath, `${skill.id}.workflowPath`);
    assertIncludesGapCodes(skill.knownGaps, `${skill.id}.knownGaps`);
    assert.equal(typeof skill.nextGate, 'string');
    assert.ok(skill.nextGate.trim());
    await assertPathsExist([
      skill.skillPath,
      skill.workflowPath,
      ...skill.runtimePaths,
      ...skill.testPaths,
      ...skill.qualityProofPaths,
    ]);
  }

  assertCapabilityGroup(profile.fast, [
    'boundedDispatch',
    'reusesSharedRuntime',
    'evidencePaths',
  ], 'fast');
  assertCapabilityGroup(profile.accurate, [
    'separatesEvidence',
    'locksExactDependencies',
    'hasQualityGate',
    'evidencePaths',
  ], 'accurate');
  assertCapabilityGroup(profile.stable, [
    'persistsState',
    'idempotentResume',
    'boundedRetry',
    'evidencePaths',
  ], 'stable');

  assertIncludesGapCodes(profile.knownGaps, 'knownGaps');
  assert.equal(typeof profile.nextOrganizationGate, 'string');
  assert.ok(profile.nextOrganizationGate.trim());

  const sharedRuntime = 'organizations/ai-growth-strategist/scripts/growth_common_contract.mjs';
  for (const skill of profile.skills) {
    assert.ok(
      skill.runtimePaths.includes(sharedRuntime),
      `${skill.id} must register the shared growth runtime`,
    );
  }

  const benchmark = profile.skills.find(
    (skill) => skill.id === 'competitive-benchmark-analysis',
  );
  for (const required of [
    'organizations/ai-growth-strategist/scripts/competitive_benchmark_v2_contract.mjs',
    'organizations/ai-growth-strategist/scripts/competitive_benchmark_claim_classifier.mjs',
    'organizations/ai-growth-strategist/scripts/competitive_benchmark_planner.mjs',
    'organizations/ai-growth-strategist/scripts/competitive_benchmark_debugger.mjs',
    'organizations/ai-growth-strategist/scripts/competitive_benchmark_forward_proof.mjs',
  ]) {
    assert.ok(benchmark.runtimePaths.includes(required), required);
  }
  for (const required of [
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_contract.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_hardening.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_third_round.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_fourth_round.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_fifth_round.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_sixth_round.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_seventh_round.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_eighth_round.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_ninth_round.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_claim_classifier.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_skill_contract_doc.test.mjs',
    'organizations/ai-growth-strategist/tests/competitive_benchmark_forward_proof.test.mjs',
  ]) {
    assert.ok(benchmark.testPaths.includes(required), required);
  }
  assert.deepEqual(benchmark.qualityProofPaths, [
    'organizations/ai-growth-strategist/quality/proofs/competitive-benchmark-v02-forward-proof/manifest.json',
  ]);
  await assertPathsExist(benchmark.qualityProofPaths);
});

function assertCapabilityGroup(value, expectedFields, label) {
  assertExactFields(value, expectedFields, label);
  for (const [key, item] of Object.entries(value)) {
    if (key === 'evidencePaths') {
      assertNonEmptyPathArray(item, `${label}.evidencePaths`);
      continue;
    }
    assert.equal(typeof item, 'boolean', `${label}.${key} must be boolean`);
  }
}

function assertNonEmptyPathArray(value, label) {
  assert.ok(Array.isArray(value) && value.length > 0, `${label} must be non-empty`);
  for (const [index, item] of value.entries()) {
    assertSafeProjectPath(item, `${label}[${index}]`);
  }
}

function assertSafeProjectPath(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  assert.equal(value.includes('\\'), false, `${label} must use forward slashes`);
  assert.equal(path.isAbsolute(value), false, `${label} must be project-relative`);
  assert.equal(
    value.split('/').includes('..'),
    false,
    `${label} must not escape the project`,
  );
  assert.ok(
    value.startsWith('organizations/ai-growth-strategist/'),
    `${label} must stay in the organization directory`,
  );
}

function assertIncludesGapCodes(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  for (const code of requiredGapCodes) {
    assert.ok(
      value.some((item) => (
        typeof item === 'string'
        && item.startsWith(`${code}:`)
      )),
      `${label} must declare ${code}`,
    );
  }
}

async function assertPathsExist(paths) {
  for (const relativePath of paths) {
    await access(path.join(projectRoot, ...relativePath.split('/')));
  }
}

function assertExactFields(value, expectedFields, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expectedFields].sort(),
    `${label} fields differ`,
  );
}
