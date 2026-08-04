import { createHash } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { types as utilTypes } from 'node:util';

import {
  assertEvidenceRefs,
  assertExactFields,
  assertNoProhibitedClaims,
  EVIDENCE_TYPES,
  FACT_TYPES,
  freezeCandidate,
  requiredId,
  requiredText,
  requireIsoTimestamp,
  validateBoundaryChecks,
  validateReview,
  validateTextArray,
} from './growth_common_contract.mjs';
import { createGrowthExperiment } from './growth_experiment_manager.mjs';
import { assertPlainData } from './strict_json.mjs';
import {
  requireBusinessProjectId,
  requireEnterpriseId,
} from '../../../scripts/control-center/project_contract.mjs';

const TOP_FIELDS = [
  'schemaVersion', 'capabilityId', 'enterpriseId', 'businessProjectId',
  'taskId', 'runId', 'status', 'knowledgeContext', 'scope', 'evidence',
  'analysisBranches', 'opportunities', 'priorityMap', 'boundaryChecks',
  'collaborationRequests', 'debugReport', 'review',
];
const EVIDENCE_FIELDS = [
  'id', 'type', 'claim', 'sourceReference', 'sourceVersion', 'sourceSha256',
  'observedAt', 'appliesTo', 'confidence', 'polarity', 'conflictReferences',
];
const BRANCH_FIELDS = [
  'id', 'status', 'findings', 'evidenceRefs', 'inferences', 'unknowns',
];
const BRANCH_IDS = [
  'market-trends',
  'user-demand',
  'industry-opportunity',
  'enterprise-growth-space',
];
const OPPORTUNITY_FIELDS = [
  'id', 'title', 'targetSegment', 'customerProblem', 'scenario', 'mechanism',
  'evidenceRefs', 'counterEvidenceRefs', 'unknowns', 'attractiveness',
  'confidence', 'experiment',
];
const ATTRACTIVENESS_FIELDS = [
  'demandStrength', 'enterpriseFit', 'reachability', 'potentialValue',
  'timing', 'competitionAndEffort', 'total',
];
const CONFIDENCE_FIELDS = [
  'grade', 'reason', 'evidenceTypeCount', 'hasEnterpriseBehaviorData',
];
const PRIORITY_FIELDS = [
  'opportunityId', 'attractiveness', 'confidence', 'decision',
];
const DIAGNOSTIC_FIELDS = [
  'code', 'severity', 'field', 'explanation', 'recoveryAction',
];
const COLLABORATION_TARGETS = new Set([
  'ai-helmsman',
  'ai-brand-officer',
  'ai-deal-officer',
  'ai-organization-officer',
]);
const PRIORITY_DECISIONS = new Set([
  'priority_experiment',
  'evidence_first',
  'hold',
  'stop',
]);
const SHA256 = /^[0-9a-f]{64}$/u;

export function validateGrowthOpportunityV2Candidate(value, options = {}) {
  assertPlainData(value, 'growth opportunity v2 candidate', {
    maxArrayLength: 1_000,
    maxNodes: 20_000,
  });
  assertPlainData(options, 'validator options', {
    maxArrayLength: 20,
    maxNodes: 100,
  });
  assertExactFields(value, TOP_FIELDS, 'growth opportunity v2 candidate');
  validateEnvelope(value, options.expectedIdentity);
  validateKnowledgeContext(value.knowledgeContext, value, options.projectRoot);
  validateScope(value.scope);
  const evidenceIndex = validateV2Evidence(value.evidence);
  validateAnalysisBranches(value.analysisBranches, evidenceIndex);
  const opportunityIndex = validateOpportunities(
    value.opportunities,
    evidenceIndex,
  );
  validatePriorityMap(value.priorityMap, opportunityIndex);
  validateBoundaryChecks(value.boundaryChecks);
  validateCollaborations(value.collaborationRequests);
  validateDebugReport(value.debugReport);
  validateReview(value.review);
  assertNoProhibitedClaims(value);
  return freezeCandidate(value);
}

function validateEnvelope(value, expectedIdentity) {
  if (
    value.schemaVersion !== 2
    || value.capabilityId !== 'growth-opportunity-analysis'
    || value.status !== 'candidate'
  ) {
    throw new Error('growth opportunity v2 candidate identity is invalid');
  }
  requireEnterpriseId(value.enterpriseId);
  requireBusinessProjectId(value.businessProjectId);
  requiredId(value.taskId, 'taskId');
  requiredId(value.runId, 'runId');
  if (expectedIdentity) {
    for (const field of [
      'enterpriseId',
      'businessProjectId',
      'taskId',
      'runId',
    ]) {
      if (value[field] !== expectedIdentity[field]) {
        throw new Error(`candidate identity mismatch at ${field}`);
      }
    }
  }
}

function validateKnowledgeContext(value, envelope, projectRoot) {
  assertExactFields(
    value,
    ['status', 'evidencePath', 'evidenceSha256'],
    'knowledgeContext',
  );
  if (!['matched', 'no_hit', 'degraded'].includes(value.status)) {
    throw new Error('knowledge context status is invalid');
  }
  requiredText(value.evidencePath, 'knowledgeContext.evidencePath', 1_000);
  if (typeof value.evidenceSha256 !== 'string'
    || !SHA256.test(value.evidenceSha256)) {
    throw new Error('knowledgeContext.evidenceSha256 must be lowercase SHA-256');
  }
  if (path.isAbsolute(value.evidencePath)
    || value.evidencePath.split(/[\\/]/u).includes('..')) {
    throw new Error('knowledge receipt path escapes the current project');
  }
  if (value.status === 'matched' && !projectRoot) {
    throw new Error(
      'matched knowledge receipt requires a trusted projectRoot for verification',
    );
  }
  if (projectRoot) {
    verifyKnowledgeReceipt(value, envelope, projectRoot);
  }
}

function verifyKnowledgeReceipt(value, envelope, projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new Error('trusted projectRoot is required');
  }
  const root = path.resolve(projectRoot);
  assertSafePathChain(root, root, 'projectRoot');
  const realRoot = realpathSync(root);
  const expectedRunRoot = path.resolve(
    root,
    'business-projects',
    envelope.enterpriseId,
    envelope.businessProjectId,
    'organizations',
    'ai-growth-strategist',
    'runs',
    envelope.runId,
  );
  const receiptPath = path.resolve(root, value.evidencePath);
  if (!isInside(receiptPath, expectedRunRoot)) {
    throw new Error('knowledge receipt path is outside the current project run');
  }
  if (!isInside(expectedRunRoot, root)) {
    throw new Error('logical expected run root is outside projectRoot');
  }
  assertSafePathChain(root, expectedRunRoot, 'expected run root');
  const realExpectedRunRoot = realpathSync(expectedRunRoot);
  if (!isInside(realExpectedRunRoot, realRoot)) {
    throw new Error('real expected run root is outside real projectRoot');
  }
  assertSafePathChain(root, receiptPath, 'knowledge receipt');
  let details;
  try {
    details = lstatSync(receiptPath);
  } catch {
    throw new Error('knowledge receipt is missing or cannot be read');
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('knowledge receipt must be a regular non-link file');
  }
  const realReceipt = realpathSync(receiptPath);
  if (!isInside(realReceipt, realExpectedRunRoot)) {
    throw new Error('knowledge receipt resolves outside the current project run');
  }
  const flags = fsConstants.O_RDONLY
    | (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(realReceipt, flags);
  let bytes;
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile()
      || (details.ino && opened.ino && details.ino !== opened.ino)
      || (details.dev && opened.dev && details.dev !== opened.dev)) {
      throw new Error('knowledge receipt changed during secure read');
    }
    bytes = readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== value.evidenceSha256) {
    throw new Error('knowledge receipt SHA-256 does not match');
  }
}

function assertSafePathChain(root, target, label) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside projectRoot`);
  }
  const parts = relative ? relative.split(path.sep) : [];
  let current = root;
  const rootDetails = safeLstat(current, label);
  if (rootDetails.isSymbolicLink()) {
    throw new Error(`${label} contains a symlink, junction or reparse point`);
  }
  for (const part of parts) {
    current = path.join(current, part);
    const details = safeLstat(current, label);
    if (details.isSymbolicLink()) {
      throw new Error(`${label} contains a symlink, junction or reparse point`);
    }
  }
}

function safeLstat(filePath, label) {
  try {
    return lstatSync(filePath);
  } catch {
    throw new Error(`${label} is missing or cannot be read`);
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateScope(value) {
  assertExactFields(value, [
    'businessGoal',
    'productOrService',
    'region',
    'timeRange',
    'constraints',
  ], 'scope');
  requiredText(value.businessGoal, 'scope.businessGoal', 1_000);
  requiredText(value.productOrService, 'scope.productOrService', 1_000);
  requiredText(value.region, 'scope.region', 300);
  requiredText(value.timeRange, 'scope.timeRange', 300);
  validateTextArray(value.constraints, 'scope.constraints', 1);
}

function validateV2Evidence(value) {
  assertBoundedDenseArray(value, 'growth opportunity v2 evidence', 1, 1_000);
  if (value.length === 0) {
    throw new Error('growth opportunity v2 evidence is required');
  }
  const index = new Map();
  value.forEach((item, position) => {
    assertExactFields(item, EVIDENCE_FIELDS, `evidence[${position}]`);
    const id = requiredId(item.id, `evidence[${position}].id`);
    if (index.has(id)) throw new Error(`duplicate evidence id: ${id}`);
    if (!EVIDENCE_TYPES.has(item.type)) {
      throw new Error(`evidence type is invalid: ${item.type}`);
    }
    requiredText(item.claim, `${id}.claim`, 2_000);
    requiredText(item.sourceReference, `${id}.sourceReference`, 1_000);
    requiredText(item.sourceVersion, `${id}.sourceVersion`, 500);
    if (typeof item.sourceSha256 !== 'string'
      || !SHA256.test(item.sourceSha256)) {
      throw new Error(`${id}.sourceSha256 must be lowercase SHA-256`);
    }
    requireIsoTimestamp(item.observedAt, `${id}.observedAt`);
    requiredText(item.appliesTo, `${id}.appliesTo`, 1_000);
    if (!['A', 'B', 'C', 'D'].includes(item.confidence)) {
      throw new Error(`${id}.confidence must be A-D`);
    }
    if (!['support', 'counter', 'neutral'].includes(item.polarity)) {
      throw new Error(`${id}.polarity is invalid`);
    }
    requireUniqueTextArray(
      item.conflictReferences,
      `${id}.conflictReferences`,
      0,
    );
    index.set(id, item);
  });
  for (const item of value) {
    for (const reference of item.conflictReferences) {
      if (!index.has(reference) || reference === item.id) {
        throw new Error(`${item.id}.conflictReferences contains invalid evidence`);
      }
      if (!index.get(reference).conflictReferences.includes(item.id)) {
        throw new Error('evidence conflict references must be symmetric');
      }
    }
  }
  return index;
}

function validateAnalysisBranches(value, evidenceIndex) {
  assertBoundedDenseArray(
    value,
    'analysis branches',
    BRANCH_IDS.length,
    BRANCH_IDS.length,
  );
  if (value.length !== BRANCH_IDS.length) {
    throw new Error('analysis branches must contain all four branches');
  }
  value.forEach((branch, index) => {
    assertExactFields(branch, BRANCH_FIELDS, `analysisBranches[${index}]`);
    if (branch.id !== BRANCH_IDS[index]) {
      throw new Error('analysis branch order is invalid');
    }
    if (!['supported', 'limited', 'blocked'].includes(branch.status)) {
      throw new Error(`${branch.id}.status is invalid`);
    }
    validateTextArray(branch.findings, `${branch.id}.findings`, 1);
    assertEvidenceRefs({
      refs: branch.evidenceRefs,
      evidenceIndex,
      minimum: 1,
      label: `${branch.id}.evidenceRefs`,
    });
    validateTextArray(branch.inferences, `${branch.id}.inferences`, 1);
    validateTextArray(branch.unknowns, `${branch.id}.unknowns`, 1);
  });
}

function validateOpportunities(value, evidenceIndex) {
  assertBoundedDenseArray(value, 'v2 opportunities', 1, 100);
  if (value.length === 0) {
    throw new Error('at least one v2 opportunity is required');
  }
  const index = new Map();
  value.forEach((opportunity, position) => {
    assertExactFields(
      opportunity,
      OPPORTUNITY_FIELDS,
      `opportunities[${position}]`,
    );
    const id = requiredId(opportunity.id, `opportunities[${position}].id`);
    if (index.has(id)) throw new Error(`duplicate opportunity id: ${id}`);
    requiredText(opportunity.title, `${id}.title`, 500);
    requiredText(opportunity.targetSegment, `${id}.targetSegment`, 1_000);
    requiredText(opportunity.customerProblem, `${id}.customerProblem`, 1_500);
    requiredText(opportunity.scenario, `${id}.scenario`, 1_000);
    requiredText(opportunity.mechanism, `${id}.mechanism`, 2_000);
    const evidenceItems = assertEvidenceRefs({
      refs: opportunity.evidenceRefs,
      evidenceIndex,
      minimum: 2,
      requireFact: true,
      label: `${id}.evidenceRefs`,
    });
    const counterEvidenceItems = assertEvidenceRefs({
      refs: opportunity.counterEvidenceRefs,
      evidenceIndex,
      minimum: 1,
      label: `${id}.counter evidence`,
    });
    const overlap = opportunity.counterEvidenceRefs.find(
      (reference) => opportunity.evidenceRefs.includes(reference),
    );
    if (overlap) {
      throw new Error(`${id}.counter evidence must not overlap positive evidence`);
    }
    if (counterEvidenceItems.some((item) => item.polarity !== 'counter')) {
      throw new Error(`${id}.counter evidence must have counter polarity`);
    }
    if (evidenceItems.some((item) => item.polarity === 'counter')) {
      throw new Error(`${id}.positive evidence cannot have counter polarity`);
    }
    validateTextArray(opportunity.unknowns, `${id}.unknowns`, 1);
    const total = validateAttractiveness(opportunity.attractiveness, id);
    const confidence = validateConfidence(
      opportunity.confidence,
      evidenceItems,
      id,
    );
    validateExperiment(opportunity.experiment, id);
    index.set(id, { total, confidence });
  });
  return index;
}

function validateAttractiveness(value, opportunityId) {
  assertExactFields(
    value,
    ATTRACTIVENESS_FIELDS,
    `${opportunityId}.attractiveness`,
  );
  for (const field of ATTRACTIVENESS_FIELDS.slice(0, -1)) {
    if (!Number.isInteger(value[field])
      || value[field] < 0
      || value[field] > 100) {
      throw new Error(
        `${opportunityId}.attractiveness.${field} must be an integer 0-100`,
      );
    }
  }
  const expected = Math.round(
    value.demandStrength * 0.25
    + value.enterpriseFit * 0.20
    + value.reachability * 0.15
    + value.potentialValue * 0.15
    + value.timing * 0.10
    + value.competitionAndEffort * 0.15,
  );
  if (value.total !== expected) {
    throw new Error(
      `${opportunityId}.attractiveness total must equal ${expected}`,
    );
  }
  return expected;
}

function validateConfidence(value, evidenceItems, opportunityId) {
  assertExactFields(
    value,
    CONFIDENCE_FIELDS,
    `${opportunityId}.confidence`,
  );
  if (!['A', 'B', 'C', 'D'].includes(value.grade)) {
    throw new Error(`${opportunityId}.confidence grade must be A-D`);
  }
  requiredText(value.reason, `${opportunityId}.confidence.reason`, 1_000);
  if (!Number.isInteger(value.evidenceTypeCount)
    || value.evidenceTypeCount < 1) {
    throw new Error(`${opportunityId}.confidence evidenceTypeCount is invalid`);
  }
  const reliableItems = evidenceItems.filter(
    (item) => FACT_TYPES.has(item.type),
  );
  const actualTypeCount = new Set(
    reliableItems.map((item) => item.type),
  ).size;
  if (value.evidenceTypeCount !== actualTypeCount) {
    throw new Error(
      `${opportunityId}.confidence evidenceTypeCount does not match evidence`,
    );
  }
  const actualHasBehavior = reliableItems.some(
    (item) => item.type === 'behavior_data',
  );
  if (
    typeof value.hasEnterpriseBehaviorData !== 'boolean'
    || value.hasEnterpriseBehaviorData !== actualHasBehavior
  ) {
    throw new Error(
      `${opportunityId}.confidence enterprise behavior marker is invalid`,
    );
  }
  if (
    value.grade === 'A'
    && (value.evidenceTypeCount < 3 || !value.hasEnterpriseBehaviorData)
  ) {
    throw new Error(
      'confidence A requires three evidence types and enterprise behavior data',
    );
  }
  if (value.grade === 'B' && value.evidenceTypeCount < 2) {
    throw new Error('confidence B requires two evidence types');
  }
  if (
    ['A', 'B'].includes(value.grade)
    && evidenceItems.some((item) => item.conflictReferences.length > 0)
  ) {
    throw new Error(
      `${opportunityId}.confidence cannot be high with unresolved conflict`,
    );
  }
  return value.grade;
}

function validateExperiment(value, opportunityId) {
  const input = structuredClone(value);
  delete input.requiresApproval;
  let normalized;
  try {
    normalized = createGrowthExperiment(input);
  } catch (error) {
    throw new Error(
      `${opportunityId}.experiment is invalid: ${error.message}`,
      { cause: error },
    );
  }
  if (normalized.requiresApproval !== value.requiresApproval) {
    throw new Error(`${opportunityId}.experiment approval marker is invalid`);
  }
}

function validatePriorityMap(value, opportunityIndex) {
  assertBoundedDenseArray(value, 'priorityMap', 1, 100);
  if (value.length !== opportunityIndex.size || value.length === 0) {
    throw new Error('priorityMap must cover every opportunity');
  }
  const seen = new Set();
  value.forEach((entry, position) => {
    assertExactFields(entry, PRIORITY_FIELDS, `priorityMap[${position}]`);
    if (!opportunityIndex.has(entry.opportunityId)
      || seen.has(entry.opportunityId)) {
      throw new Error('priorityMap opportunityId is unknown or duplicated');
    }
    seen.add(entry.opportunityId);
    const expected = opportunityIndex.get(entry.opportunityId);
    if (
      entry.attractiveness !== expected.total
      || entry.confidence !== expected.confidence
    ) {
      throw new Error('priorityMap does not match dual evaluation');
    }
    if (!PRIORITY_DECISIONS.has(entry.decision)) {
      throw new Error('priorityMap decision is invalid');
    }
    if (entry.decision !== expectedPriorityDecision(
      expected.total,
      expected.confidence,
    )) {
      throw new Error('priorityMap decision does not match dual evaluation');
    }
  });
}

function expectedPriorityDecision(attractiveness, confidence) {
  if (attractiveness >= 70) {
    return ['A', 'B'].includes(confidence)
      ? 'priority_experiment'
      : 'evidence_first';
  }
  if (attractiveness < 50 && ['C', 'D'].includes(confidence)) {
    return 'stop';
  }
  return 'hold';
}

function validateCollaborations(value) {
  assertBoundedDenseArray(value, 'collaborationRequests', 0, 100);
  value.forEach((request, position) => {
    assertExactFields(
      request,
      ['targetOrganization', 'reason'],
      `collaborationRequests[${position}]`,
    );
    if (!COLLABORATION_TARGETS.has(request.targetOrganization)) {
      throw new Error('collaboration target is invalid');
    }
    requiredText(request.reason, 'collaboration reason', 1_000);
  });
}

function validateDebugReport(value) {
  assertExactFields(
    value,
    ['status', 'diagnostics', 'remainingUnknowns'],
    'debugReport',
  );
  if (!['passed', 'passed_with_unknowns', 'blocked'].includes(value.status)) {
    throw new Error('debugReport.status is invalid');
  }
  if (!Array.isArray(value.diagnostics) || value.diagnostics.length === 0) {
    throw new Error('debugReport.diagnostics is required');
  }
  value.diagnostics.forEach((diagnostic, position) => {
    assertExactFields(
      diagnostic,
      DIAGNOSTIC_FIELDS,
      `debugReport.diagnostics[${position}]`,
    );
    requiredText(diagnostic.code, 'diagnostic.code', 120);
    if (!/^[a-z][a-z0-9_-]{1,119}$/u.test(diagnostic.code)) {
      throw new Error('diagnostic.code is invalid');
    }
    if (!['info', 'warning', 'blocking'].includes(diagnostic.severity)) {
      throw new Error('diagnostic severity is invalid');
    }
    requiredText(diagnostic.field, 'diagnostic.field', 500);
    requiredText(diagnostic.explanation, 'diagnostic.explanation', 1_000);
    requiredText(diagnostic.recoveryAction, 'diagnostic.recoveryAction', 1_000);
  });
  const hasBlocking = value.diagnostics.some(
    (diagnostic) => diagnostic.severity === 'blocking',
  );
  if (hasBlocking && value.status !== 'blocked') {
    throw new Error('debugReport with blocking diagnostics must be blocked');
  }
  if (!hasBlocking && value.status === 'blocked') {
    throw new Error('blocked debugReport requires a blocking diagnostic');
  }
  validateTextArray(
    value.remainingUnknowns,
    'debugReport.remainingUnknowns',
    value.status === 'passed' ? 0 : 1,
  );
}

function requireUniqueTextArray(value, label, minimum) {
  validateTextArray(value, label, minimum);
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} must be unique`);
  }
}

function assertBoundedDenseArray(value, label, minimum, maximum) {
  if (!Array.isArray(value)) {
    throw new Error(
      `${label} must be an array within the maximum size limit`,
    );
  }
  if (utilTypes.isProxy(value)) {
    throw new Error(`${label} must not be a Proxy array`);
  }
  if (value.length < minimum || value.length > maximum) {
    throw new Error(
      `${label} must be an array within the maximum size limit`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be a dense array`);
    }
  }
}
