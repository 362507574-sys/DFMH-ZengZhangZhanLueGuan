import {
  assertEvidenceRefs,
  assertExactFields,
  assertNoProhibitedClaims,
  freezeCandidate,
  requiredId,
  requiredText,
  requireIsoTimestamp,
  validateBoundaryChecks,
  validateCandidateEnvelope,
  validateEvidence,
  validateReview,
  validateTextArray,
} from './growth_common_contract.mjs';

const TOP_FIELDS = [
  'schemaVersion', 'capabilityId', 'enterpriseId', 'taskId', 'status',
  'knowledgeContext', 'scope', 'evidence', 'brandBrief', 'contentPlan',
  'customerLifecycle', 'consentPolicy', 'dealHandoff', 'repurchase',
  'experiments', 'safetyChecks', 'boundaryChecks', 'collaborationRequests',
  'review',
];

const HANDOFF_FIELDS = [
  'enterpriseId', 'taskId', 'handoffVersion', 'consentStatus',
  'consentPurpose', 'retentionUntil', 'optOutStatus', 'source',
  'touchpoints', 'customerReference', 'segmentNeedStage',
  'evidenceReferences', 'knownUnknowns', 'promisesLimitsRisksNextActions',
];

export function validateContentCustomerGrowthCandidate(value) {
  validateCandidateEnvelope(value, 'content-customer-growth');
  assertExactFields(value, TOP_FIELDS, 'content and customer growth candidate');
  validateScope(value.scope);
  const evidenceIndex = validateEvidence(value.evidence);
  const brandVersion = validateBrandBrief(value.brandBrief);
  validateContentPlan(value.contentPlan, evidenceIndex, brandVersion);
  validateLifecycle(value.customerLifecycle);
  validateConsent(value.consentPolicy);
  validateDealHandoff(value.dealHandoff);
  validateRepurchase(value.repurchase);
  validateExperiments(value.experiments);
  validateSafety(value.safetyChecks);
  validateBoundaryChecks(value.boundaryChecks);
  validateCollaborations(value.collaborationRequests);
  validateReview(value.review);
  assertNoProhibitedClaims(value);
  return freezeCandidate(value);
}

function validateScope(scope) {
  assertExactFields(scope, [
    'growthOpportunityRef', 'objective', 'channels', 'timeRange', 'constraints',
  ], 'scope');
  requiredId(scope.growthOpportunityRef, 'scope.growthOpportunityRef');
  requiredText(scope.objective, 'scope.objective', 1_000);
  validateTextArray(scope.channels, 'scope.channels', 1);
  requiredText(scope.timeRange, 'scope.timeRange', 300);
  validateTextArray(scope.constraints, 'scope.constraints', 1);
}

function validateBrandBrief(brief) {
  assertExactFields(brief, [
    'version', 'effectiveAt', 'valueProposition', 'allowedClaims',
    'forbiddenClaims', 'reviewTriggers',
  ], 'brandBrief');
  const version = requiredText(brief.version, 'brandBrief.version', 200);
  requireIsoTimestamp(brief.effectiveAt, 'brandBrief.effectiveAt');
  requiredText(brief.valueProposition, 'brandBrief.valueProposition', 1_500);
  validateTextArray(brief.allowedClaims, 'brandBrief.allowedClaims', 1);
  validateTextArray(brief.forbiddenClaims, 'brandBrief.forbiddenClaims', 1);
  validateTextArray(brief.reviewTriggers, 'brandBrief.reviewTriggers', 1);
  return version;
}

function validateContentPlan(plan, evidenceIndex, brandVersion) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('contentPlan requires at least one content unit');
  }
  const ids = new Set();
  plan.forEach((content, index) => {
    assertExactFields(content, [
      'id', 'channel', 'audienceStage', 'objective', 'evidenceRefs', 'format',
      'topic', 'callToAction', 'brandBriefVersion', 'frequencyLimit',
    ], `contentPlan[${index}]`);
    const id = requiredId(content.id, `contentPlan[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate content id: ${id}`);
    ids.add(id);
    for (const field of [
      'channel', 'audienceStage', 'objective', 'format', 'topic',
      'callToAction', 'frequencyLimit',
    ]) requiredText(content[field], `${id}.${field}`, 1_000);
    if (content.brandBriefVersion !== brandVersion) {
      throw new Error(`${id} brand brief version does not match the active version`);
    }
    assertEvidenceRefs({
      refs: content.evidenceRefs,
      evidenceIndex,
      minimum: 2,
      requireFact: true,
      label: `${id}.evidenceRefs`,
    });
  });
}

function validateLifecycle(stages) {
  if (!Array.isArray(stages) || stages.length < 2) {
    throw new Error('customerLifecycle requires at least two stages');
  }
  const names = new Set();
  stages.forEach((stage, index) => {
    assertExactFields(stage, [
      'stage', 'entrySignal', 'allowedActions', 'exitSignal',
    ], `customerLifecycle[${index}]`);
    const name = requiredText(stage.stage, `customerLifecycle[${index}].stage`, 100);
    if (names.has(name)) throw new Error(`duplicate lifecycle stage: ${name}`);
    names.add(name);
    requiredText(stage.entrySignal, `${name}.entrySignal`, 1_000);
    validateTextArray(stage.allowedActions, `${name}.allowedActions`, 1);
    requiredText(stage.exitSignal, `${name}.exitSignal`, 1_000);
  });
}

function validateConsent(policy) {
  assertExactFields(policy, [
    'required', 'purpose', 'retentionDays', 'optOutMechanism',
    'refusalStopsContact', 'noAutomatedOutreach',
  ], 'consentPolicy');
  if (policy.required !== true
    || policy.refusalStopsContact !== true
    || policy.noAutomatedOutreach !== true) {
    throw new Error('consent is required; refusal must stop contact and automated outreach is forbidden');
  }
  requiredText(policy.purpose, 'consentPolicy.purpose', 1_000);
  if (!Number.isInteger(policy.retentionDays)
    || policy.retentionDays < 1
    || policy.retentionDays > 3_650) {
    throw new Error('consentPolicy.retentionDays must be 1-3650');
  }
  requiredText(policy.optOutMechanism, 'consentPolicy.optOutMechanism', 1_000);
}

function validateDealHandoff(handoff) {
  assertExactFields(handoff, [
    'version', 'triggers', 'nonTriggers', 'customerReferenceRule',
    'requiredFields', 'feedbackFields',
  ], 'dealHandoff');
  requiredText(handoff.version, 'dealHandoff.version', 200);
  validateTextArray(handoff.triggers, 'dealHandoff.triggers', 1);
  validateTextArray(handoff.nonTriggers, 'dealHandoff.nonTriggers', 1);
  const rule = requiredText(
    handoff.customerReferenceRule,
    'dealHandoff.customerReferenceRule',
    1_000,
  );
  if (/(?:raw\s+(?:phone|email)|原始(?:手机号|邮箱)|明文(?:手机号|邮箱))/iu.test(rule)) {
    throw new Error('deal handoff must use a customer reference and exclude raw PII, phone or email');
  }
  if (!Array.isArray(handoff.requiredFields)
    || handoff.requiredFields.length !== HANDOFF_FIELDS.length
    || new Set(handoff.requiredFields).size !== HANDOFF_FIELDS.length
    || HANDOFF_FIELDS.some((field) => !handoff.requiredFields.includes(field))) {
    throw new Error('deal handoff required fields are incomplete');
  }
  validateTextArray(handoff.feedbackFields, 'dealHandoff.feedbackFields', 1);
}

function validateRepurchase(repurchase) {
  assertExactFields(repurchase, [
    'eligibilitySignals', 'exclusions', 'contentActions', 'dealHandoffTrigger',
  ], 'repurchase');
  validateTextArray(repurchase.eligibilitySignals, 'repurchase.eligibilitySignals', 1);
  validateTextArray(repurchase.exclusions, 'repurchase.exclusions', 1);
  validateTextArray(repurchase.contentActions, 'repurchase.contentActions', 1);
  requiredText(repurchase.dealHandoffTrigger, 'repurchase.dealHandoffTrigger', 1_000);
}

function validateExperiments(experiments) {
  if (!Array.isArray(experiments) || experiments.length === 0) {
    throw new Error('at least one content experiment is required');
  }
  experiments.forEach((experiment, index) => {
    assertExactFields(experiment, [
      'id', 'hypothesis', 'method', 'metric', 'target', 'maximumDays',
      'maximumCost', 'stopConditions',
    ], `experiments[${index}]`);
    requiredId(experiment.id, `experiments[${index}].id`);
    for (const field of [
      'hypothesis', 'method', 'metric', 'target', 'maximumCost',
    ]) requiredText(experiment[field], `experiment.${field}`, 1_000);
    if (!Number.isInteger(experiment.maximumDays)
      || experiment.maximumDays < 1
      || experiment.maximumDays > 180) {
      throw new Error('experiment maximumDays must be 1-180');
    }
    validateTextArray(experiment.stopConditions, 'experiment.stopConditions', 1);
  });
}

function validateSafety(checks) {
  assertExactFields(checks, [
    'fakeScarcity', 'hiddenFees', 'coercion', 'vulnerableGroupTargeting',
    'fabricatedProof',
  ], 'safetyChecks');
  for (const [field, state] of Object.entries(checks)) {
    if (state !== false) throw new Error(`safety risk is forbidden: ${field}`);
  }
}

function validateCollaborations(requests) {
  if (!Array.isArray(requests)) throw new Error('collaborationRequests must be an array');
  const allowed = new Set(['ai-brand-officer', 'ai-deal-officer', 'ai-helmsman']);
  requests.forEach((request, index) => {
    assertExactFields(request, ['targetOrganization', 'reason'], `collaborationRequests[${index}]`);
    if (!allowed.has(request.targetOrganization)) {
      throw new Error('collaboration target is invalid');
    }
    requiredText(request.reason, 'collaboration reason', 1_000);
  });
}
