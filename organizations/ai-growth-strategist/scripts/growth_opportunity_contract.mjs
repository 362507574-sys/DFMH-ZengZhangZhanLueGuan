import {
  assertEvidenceRefs,
  assertExactFields,
  assertNoProhibitedClaims,
  freezeCandidate,
  requiredId,
  requiredText,
  validateBoundaryChecks,
  validateCandidateEnvelope,
  validateEvidence,
  validateReview,
  validateTextArray,
} from './growth_common_contract.mjs';

const TOP_FIELDS = [
  'schemaVersion', 'capabilityId', 'enterpriseId', 'taskId', 'status',
  'knowledgeContext', 'scope', 'evidence', 'opportunities', 'priorityOrder',
  'boundaryChecks', 'collaborationRequests', 'review',
];
const OPPORTUNITY_FIELDS = [
  'id', 'title', 'targetSegment', 'customerNeed', 'evidenceRefs',
  'growthMechanism', 'growthPositioning', 'score', 'validationExperiment',
  'risks', 'unknowns',
];

export function validateGrowthOpportunityCandidate(value) {
  validateCandidateEnvelope(value, 'growth-opportunity-analysis');
  assertExactFields(value, TOP_FIELDS, 'growth opportunity candidate');
  validateScope(value.scope);
  const evidenceIndex = validateEvidence(value.evidence);
  if (!Array.isArray(value.opportunities) || value.opportunities.length === 0) {
    throw new Error('at least one growth opportunity is required');
  }
  const opportunityIds = new Set();
  for (const [index, opportunity] of value.opportunities.entries()) {
    assertExactFields(opportunity, OPPORTUNITY_FIELDS, `opportunities[${index}]`);
    const id = requiredId(opportunity.id, `opportunities[${index}].id`);
    if (opportunityIds.has(id)) throw new Error(`duplicate opportunity id: ${id}`);
    opportunityIds.add(id);
    requiredText(opportunity.title, `${id}.title`, 300);
    requiredText(opportunity.targetSegment, `${id}.targetSegment`, 500);
    requiredText(opportunity.customerNeed, `${id}.customerNeed`, 1_000);
    assertEvidenceRefs({
      refs: opportunity.evidenceRefs,
      evidenceIndex,
      minimum: 2,
      requireFact: true,
      label: `${id}.evidenceRefs`,
    });
    requiredText(opportunity.growthMechanism, `${id}.growthMechanism`, 1_500);
    validateGrowthPositioning(opportunity.growthPositioning, id);
    validateScore(opportunity.score, id);
    validateExperiment(opportunity.validationExperiment, id);
    validateTextArray(opportunity.risks, `${id}.risks`, 1);
    validateTextArray(opportunity.unknowns, `${id}.unknowns`, 1);
  }
  validatePriorityOrder(value.priorityOrder, opportunityIds);
  validateBoundaryChecks(value.boundaryChecks);
  validateCollaborations(value.collaborationRequests);
  validateReview(value.review);
  assertNoProhibitedClaims(value);
  return freezeCandidate(value);
}

function validateScope(scope) {
  assertExactFields(scope, [
    'businessGoal', 'productOrService', 'region', 'timeRange', 'constraints',
  ], 'scope');
  requiredText(scope.businessGoal, 'scope.businessGoal', 1_000);
  requiredText(scope.productOrService, 'scope.productOrService', 1_000);
  requiredText(scope.region, 'scope.region', 300);
  requiredText(scope.timeRange, 'scope.timeRange', 300);
  validateTextArray(scope.constraints, 'scope.constraints', 1);
}

function validateGrowthPositioning(value, opportunityId) {
  assertExactFields(value, [
    'prioritySegment', 'scenario', 'channel', 'notBrandRepositioning',
  ], `${opportunityId}.growthPositioning`);
  requiredText(value.prioritySegment, 'prioritySegment', 500);
  requiredText(value.scenario, 'scenario', 500);
  requiredText(value.channel, 'channel', 500);
  if (value.notBrandRepositioning !== true) {
    throw new Error('growth positioning must not replace brand positioning');
  }
}

function validateScore(score, opportunityId) {
  assertExactFields(score, [
    'demand', 'enterpriseFit', 'reachability', 'competition', 'effort', 'risk',
    'total',
  ], `${opportunityId}.score`);
  for (const key of [
    'demand', 'enterpriseFit', 'reachability', 'competition', 'effort', 'risk',
  ]) {
    if (!Number.isInteger(score[key]) || score[key] < 1 || score[key] > 5) {
      throw new Error(`${opportunityId} score ${key} must be 1-5`);
    }
  }
  const expected = score.demand + score.enterpriseFit + score.reachability
    + (6 - score.competition) + (6 - score.effort) + (6 - score.risk);
  if (score.total !== expected) {
    throw new Error(`${opportunityId} score total must equal ${expected}`);
  }
}

function validateExperiment(experiment, opportunityId) {
  assertExactFields(experiment, [
    'hypothesis', 'method', 'metric', 'target', 'maximumDays', 'maximumCost',
    'stopConditions',
  ], `${opportunityId}.validationExperiment`);
  for (const key of ['hypothesis', 'method', 'metric', 'target', 'maximumCost']) {
    requiredText(experiment[key], `${opportunityId}.${key}`, 1_000);
  }
  if (!Number.isInteger(experiment.maximumDays)
    || experiment.maximumDays < 1
    || experiment.maximumDays > 180) {
    throw new Error(`${opportunityId} maximumDays must be 1-180`);
  }
  validateTextArray(experiment.stopConditions, `${opportunityId}.stopConditions`, 1);
}

function validatePriorityOrder(value, opportunityIds) {
  if (!Array.isArray(value)
    || value.length !== opportunityIds.size
    || new Set(value).size !== opportunityIds.size
    || value.some((id) => !opportunityIds.has(id))) {
    throw new Error('priorityOrder must contain every opportunity exactly once');
  }
}

function validateCollaborations(value) {
  if (!Array.isArray(value)) throw new Error('collaborationRequests must be an array');
  const allowed = new Set([
    'ai-helmsman', 'ai-brand-officer', 'ai-deal-officer',
    'ai-organization-officer',
  ]);
  value.forEach((request, index) => {
    assertExactFields(
      request,
      ['targetOrganization', 'reason'],
      `collaborationRequests[${index}]`,
    );
    if (!allowed.has(request.targetOrganization)) {
      throw new Error('collaboration target is invalid');
    }
    requiredText(request.reason, 'collaboration reason', 1_000);
  });
}
