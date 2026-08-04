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
  'knowledgeContext', 'scope', 'evidence', 'benchmarks', 'insights',
  'experiments', 'boundaryChecks', 'collaborationRequests', 'review',
];

export function validateCompetitiveBenchmarkCandidate(value) {
  validateCandidateEnvelope(value, 'competitive-benchmark-analysis');
  assertExactFields(value, TOP_FIELDS, 'competitive benchmark candidate');
  validateScope(value.scope);
  const evidenceIndex = validateEvidence(value.evidence);
  const benchmarkIds = validateBenchmarks(value.benchmarks, evidenceIndex);
  const insightIds = validateInsights(value.insights, evidenceIndex);
  validateExperiments(value.experiments, insightIds);
  validateBoundaryChecks(value.boundaryChecks);
  validateCollaborations(value.collaborationRequests);
  validateReview(value.review);
  assertNoProhibitedClaims(value);
  if (benchmarkIds.size < 4) throw new Error('benchmark sample requires at least four items');
  return freezeCandidate(value);
}

function validateScope(scope) {
  assertExactFields(scope, [
    'growthOpportunityRef', 'objective', 'productOrService', 'region',
    'timeRange', 'brandBriefVersion', 'constraints',
  ], 'scope');
  requiredId(scope.growthOpportunityRef, 'scope.growthOpportunityRef');
  for (const field of [
    'objective', 'productOrService', 'region', 'timeRange', 'brandBriefVersion',
  ]) requiredText(scope[field], `scope.${field}`, 1_000);
  validateTextArray(scope.constraints, 'scope.constraints', 1);
}

function validateBenchmarks(benchmarks, evidenceIndex) {
  if (!Array.isArray(benchmarks) || benchmarks.length < 4) {
    throw new Error('benchmark sample requires three direct and one alternative item');
  }
  const ids = new Set();
  let direct = 0;
  let alternative = 0;
  benchmarks.forEach((benchmark, index) => {
    assertExactFields(benchmark, [
      'id', 'name', 'kind', 'evidenceRefs', 'observedPositioning',
      'productStrategy', 'contentMechanism', 'acquisitionChannels',
      'observableCustomerPath', 'unknowns',
    ], `benchmarks[${index}]`);
    const id = requiredId(benchmark.id, `benchmarks[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate benchmark id: ${id}`);
    ids.add(id);
    requiredText(benchmark.name, `${id}.name`, 300);
    if (benchmark.kind === 'direct') direct += 1;
    else if (benchmark.kind === 'alternative') alternative += 1;
    else throw new Error(`${id}.kind must be direct or alternative`);
    assertEvidenceRefs({
      refs: benchmark.evidenceRefs,
      evidenceIndex,
      requireFact: true,
      label: `${id}.evidenceRefs`,
    });
    for (const field of [
      'observedPositioning', 'productStrategy', 'contentMechanism',
      'observableCustomerPath',
    ]) requiredText(benchmark[field], `${id}.${field}`, 1_500);
    validateTextArray(benchmark.acquisitionChannels, `${id}.acquisitionChannels`, 1);
    validateTextArray(benchmark.unknowns, `${id}.unknowns`, 1);
  });
  if (direct < 3 || alternative < 1) {
    throw new Error('benchmark sample requires three direct and one alternative item');
  }
  return ids;
}

function validateInsights(insights, evidenceIndex) {
  if (!Array.isArray(insights) || insights.length === 0) {
    throw new Error('at least one transferable insight is required');
  }
  const ids = new Set();
  insights.forEach((insight, index) => {
    assertExactFields(insight, [
      'id', 'evidenceRefs', 'transferableMechanism', 'ownBrandAdaptation',
      'whyFit', 'doNotCopy', 'antiCopyChecks', 'unknowns',
    ], `insights[${index}]`);
    const id = requiredId(insight.id, `insights[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate insight id: ${id}`);
    ids.add(id);
    assertEvidenceRefs({
      refs: insight.evidenceRefs,
      evidenceIndex,
      minimum: 2,
      requireFact: true,
      label: `${id}.evidenceRefs`,
    });
    for (const field of ['transferableMechanism', 'ownBrandAdaptation', 'whyFit']) {
      requiredText(insight[field], `${id}.${field}`, 1_500);
    }
    validateTextArray(insight.doNotCopy, `${id}.doNotCopy`, 1);
    validateTextArray(insight.unknowns, `${id}.unknowns`, 1);
    validateAntiCopy(insight.antiCopyChecks, id);
  });
  return ids;
}

function validateAntiCopy(checks, id) {
  assertExactFields(checks, [
    'copiesName', 'copiesSlogan', 'copiesCoreCopy', 'copiesVisualIdentity',
    'copiesCases', 'brandConfusionRisk', 'intellectualPropertyRisk',
  ], `${id}.antiCopyChecks`);
  for (const field of [
    'copiesName', 'copiesSlogan', 'copiesCoreCopy', 'copiesVisualIdentity',
    'copiesCases',
  ]) {
    if (checks[field] !== false) {
      throw new Error(`${id} copy and brand risk check failed: ${field}`);
    }
  }
  if (checks.brandConfusionRisk !== 'none'
    || checks.intellectualPropertyRisk !== 'none') {
    throw new Error(`${id} brand or intellectual property risk must be none`);
  }
}

function validateExperiments(experiments, insightIds) {
  if (!Array.isArray(experiments) || experiments.length === 0) {
    throw new Error('at least one benchmark experiment is required');
  }
  experiments.forEach((experiment, index) => {
    assertExactFields(experiment, [
      'id', 'insightRef', 'hypothesis', 'method', 'metric', 'target',
      'maximumDays', 'maximumCost', 'stopConditions',
    ], `experiments[${index}]`);
    requiredId(experiment.id, `experiments[${index}].id`);
    if (!insightIds.has(experiment.insightRef)) {
      throw new Error(`unknown insightRef: ${experiment.insightRef}`);
    }
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
