import { assertPlainObject, deepFreeze } from './strict_json.mjs';

const TARGET_CAPABILITIES = new Map([
  ['ai-brand-officer', new Set([
    'brand-consistency-review',
    'brand-brief',
    'brand-positioning-review',
  ])],
  ['ai-deal-officer', new Set([
    'lead-handoff-review',
    'deal-boundary-review',
    'conversion-feedback',
  ])],
  ['ai-organization-officer', new Set([
    'growth-team-process',
    'growth-role-design',
    'growth-training-design',
  ])],
  ['ai-helmsman', new Set([
    'strategy-boundary-review',
    'business-model-review',
  ])],
]);
const REQUEST_FIELDS = new Set([
  'schemaVersion',
  'contractVersion',
  'parentTaskId',
  'requestId',
  'enterpriseId',
  'primaryOrganization',
  'requestingOrganization',
  'targetOrganization',
  'requestedCapability',
  'scope',
  'expectedOutcome',
  'evidenceRequirements',
  'accessEnvelope',
  'constraints',
  'recursionDepth',
  'status',
]);

export function createCollaborationRequest(value) {
  assertPlainObject(value, 'collaboration request');
  assertExactFields(value, REQUEST_FIELDS, 'collaboration request');
  if (value.schemaVersion !== 1 || value.contractVersion !== 1) {
    throw new Error('collaboration contract version is invalid');
  }
  if (value.primaryOrganization !== 'ai-growth-strategist'
    || value.requestingOrganization !== 'ai-growth-strategist') {
    throw new Error('collaboration request cannot change unique primary organization');
  }
  if (value.targetOrganization === value.requestingOrganization) {
    throw new Error('collaboration self-call is forbidden');
  }
  const allowedCapabilities = TARGET_CAPABILITIES.get(value.targetOrganization);
  if (!allowedCapabilities?.has(value.requestedCapability)) {
    throw new Error('target organization or requested capability is invalid');
  }
  requiredId(value.parentTaskId, 'parentTaskId', 120);
  requiredId(value.requestId, 'requestId', 120);
  requiredId(value.enterpriseId, 'enterpriseId', 64);
  const scope = requiredText(value.scope, 'scope', 1_000);
  if (scope.length < 10 || /全部处理|全权处理|接管任务/u.test(scope)) {
    throw new Error('collaboration request requires a bounded scope');
  }
  requiredText(value.expectedOutcome, 'expectedOutcome', 1_000);
  if (!Array.isArray(value.evidenceRequirements)
    || value.evidenceRequirements.length < 3
    || value.evidenceRequirements.some((item) => !requiredText(
      item,
      'evidence requirement',
      300,
    ))) {
    throw new Error('collaboration evidence requirements are incomplete');
  }
  assertPlainObject(value.accessEnvelope, 'accessEnvelope');
  if (value.accessEnvelope.enterpriseId !== value.enterpriseId) {
    throw new Error('collaboration access enterprise mismatch');
  }
  if (!Array.isArray(value.accessEnvelope.allowedScopes)
    || !Array.isArray(value.accessEnvelope.deniedScopes)) {
    throw new Error('collaboration access scopes are incomplete');
  }
  assertPlainObject(value.constraints, 'constraints');
  if (value.recursionDepth !== 1
    || value.constraints.maxDelegationDepth !== 1) {
    throw new Error('collaboration delegation depth must stay at one');
  }
  if (value.constraints.externalWriteAllowed !== false) {
    throw new Error('collaboration external writes are forbidden');
  }
  if (value.status !== 'requested') {
    throw new Error('collaboration request status must be requested');
  }
  return deepFreeze(structuredClone(value));
}

export function validateCollaborationResult({ request, result } = {}) {
  const expected = createCollaborationRequest(request);
  assertPlainObject(result, 'collaboration result');
  const matches = [
    ['contractVersion', expected.contractVersion],
    ['parentTaskId', expected.parentTaskId],
    ['requestId', expected.requestId],
    ['enterpriseId', expected.enterpriseId],
    ['primaryOrganization', expected.primaryOrganization],
    ['respondingOrganization', expected.targetOrganization],
    ['requestedCapability', expected.requestedCapability],
  ];
  for (const [field, value] of matches) {
    if (result[field] !== value) {
      throw new Error(`collaboration ${field} mismatch`);
    }
  }
  if (result.schemaVersion !== 1
    || !['completed', 'partial', 'failed'].includes(result.status)) {
    throw new Error('collaboration result status is invalid');
  }
  for (const field of [
    'artifacts',
    'evidence',
    'assumptions',
    'risks',
    'unresolvedItems',
  ]) {
    if (!Array.isArray(result[field])) {
      throw new Error(`collaboration result ${field} must be an array`);
    }
  }
  if (result.status === 'completed' && result.evidence.length === 0) {
    throw new Error('completed collaboration result requires evidence');
  }
  for (const [index, artifact] of result.artifacts.entries()) {
    assertPlainObject(artifact, `artifact[${index}]`);
    requiredText(artifact.path, `artifact[${index}].path`, 1_000);
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? '')) {
      throw new Error(`collaboration artifact hash is invalid at ${index}`);
    }
  }
  return deepFreeze(structuredClone(result));
}

function assertExactFields(value, fields, label) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new Error(`${label} has unexpected field: ${key}`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing required field: ${field}`);
    }
  }
}

function requiredText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new Error(`${label} exceeds size limit`);
  return result;
}

function requiredId(value, label, maximum) {
  const result = requiredText(value, label, maximum);
  if (!/^[a-z0-9][a-z0-9-]{2,119}$/u.test(result)) {
    throw new Error(`${label} is invalid`);
  }
  return result;
}
