import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  deepFreeze,
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';
import {
  assertExactFields,
  assertNoProhibitedClaims,
  freezeCandidate,
  requiredText,
  requireIsoTimestamp,
  validateBoundaryChecks,
  validateReview,
  validateTextArray,
} from './growth_common_contract.mjs';
import {
  createGrowthExperiment,
  EXTERNAL_ACTIONS,
} from './growth_experiment_manager.mjs';
import {
  assertNoDuplicateJsonKeys,
  assertPlainData,
} from './strict_json.mjs';
import {
  createContentCustomerGrowthDebugReport,
} from './content_customer_growth_debugger.mjs';

const SHA256 = /^[0-9a-f]{64}$/u;
const TOP_FIELDS = [
  'schemaVersion', 'capabilityId', 'enterpriseId', 'businessProjectId',
  'taskId', 'runId', 'status', 'knowledgeContext', 'scope', 'evidence',
  'monthlyCapacity', 'channelPlans', 'customerLifecycle', 'consentPolicy',
  'nurturePlan', 'dealHandoff', 'repurchase', 'experiments',
  'externalActions', 'boundaryChecks', 'browserTimelineBindings',
  'collaborationRequests', 'debugReport', 'review',
];
const UPSTREAM_IDS = [
  'growth-opportunity-brief',
  'benchmark-mechanism-map',
  'brand-brief',
  'deal-handoff-contract',
];
const CHANNELS = [
  'short-video',
  'xiaohongshu',
  'permission-private-domain',
];
const WEEKLY_LIMITS = new Map([
  ['short-video', 5],
  ['xiaohongshu', 3],
  ['permission-private-domain', 2],
]);
const LIFECYCLE_STAGES = [
  'anonymous-awareness',
  'active-interest',
  'consented-nurture',
  'explicit-inquiry',
  'service',
  'repurchase-candidate',
];
const HANDOFF_FIELDS = [
  'enterpriseId', 'taskId', 'handoffVersion', 'consentStatus',
  'consentPurpose', 'retentionUntil', 'optOutStatus', 'source',
  'touchpoints', 'customerReference', 'segmentNeedStage',
  'evidenceReferences', 'knownUnknowns', 'promisesLimitsRisksNextActions',
];
const ACTIONS = [...EXTERNAL_ACTIONS];

export const CONTENT_CUSTOMER_GROWTH_V2 = deepFreeze({
  upstreamArtifactIds: UPSTREAM_IDS,
  channels: CHANNELS,
  lifecycleStages: LIFECYCLE_STAGES,
  handoffFields: HANDOFF_FIELDS,
  externalActions: ACTIONS,
});

export function validateContentCustomerGrowthV2Candidate(
  value,
  options = {},
) {
  assertPlainData(value, 'content customer growth v2 candidate', {
    maxArrayLength: 1_000,
    maxNodes: 30_000,
  });
  assertPlainData(options, 'content customer growth trusted options', {
    maxArrayLength: 20,
    maxNodes: 200,
  });
  const trusted = validateTrustedOptions(options);
  assertExactFields(value, TOP_FIELDS, 'content customer growth v2 candidate');
  validateEnvelope(value, trusted.expectedIdentity);
  const roots = createRoots(value, trusted.projectRoot);
  validateKnowledge(
    value.knowledgeContext,
    value,
    roots,
    trusted.expectedKnowledgeReceipt,
  );
  const upstream = validateScope(
    value.scope,
    value,
    roots,
    trusted.expectedUpstreamArtifacts,
    trusted.expectedCommercePolicy,
  );
  const evidenceIds = validateEvidence(value.evidence, roots, trusted.referenceAt);
  validateMonthlyCapacity(value.monthlyCapacity);
  validateChannelPlans(value.channelPlans, upstream, evidenceIds);
  validateLifecycle(value.customerLifecycle);
  validateConsent(value.consentPolicy);
  validateNurturePlan(value.nurturePlan);
  validateDealHandoff(
    value.dealHandoff,
    upstream,
    trusted.expectedCommercePolicy,
  );
  validateRepurchase(value.repurchase);
  validateExternalActions(value.externalActions);
  validateExperiments(value.experiments);
  validateBoundaryChecks(value.boundaryChecks);
  validateBrowserTimelineBindings(
    value.browserTimelineBindings,
    value,
    roots,
  );
  validateCollaborations(value.collaborationRequests);
  validateDebugReport(value.debugReport, value);
  assertExactFields(
    value.review,
    ['baselineMetrics', 'reviewAt', 'decisionRules'],
    'review',
  );
  validateReview(value.review);
  assertNoProhibitedClaims(value);
  return freezeCandidate(value);
}

function validateTrustedOptions(options) {
  assertExactFields(options, [
    'expectedIdentity',
    'projectRoot',
    'expectedUpstreamArtifacts',
    'expectedKnowledgeReceipt',
    'expectedCommercePolicy',
    'referenceAt',
  ], 'content customer growth trusted options');
  assertExactFields(options.expectedIdentity, [
    'enterpriseId',
    'businessProjectId',
    'taskId',
    'runId',
  ], 'expected identity');
  requireEnterpriseId(options.expectedIdentity.enterpriseId);
  requireBusinessProjectId(options.expectedIdentity.businessProjectId);
  requireSafeId(options.expectedIdentity.taskId, 'expected taskId');
  requireSafeId(options.expectedIdentity.runId, 'expected runId');
  if (typeof options.projectRoot !== 'string' || !options.projectRoot.trim()) {
    throw new Error('trusted projectRoot is required');
  }
  requireDenseArray(
    options.expectedUpstreamArtifacts,
    'expected upstream artifacts',
    4,
    4,
  );
  options.expectedUpstreamArtifacts.forEach((item, index) => {
    validateArtifactIdentity(item, `expected upstream artifacts[${index}]`);
    if (item.artifactId !== UPSTREAM_IDS[index]) {
      throw new Error('expected upstream artifacts must use the fixed order');
    }
  });
  assertExactFields(options.expectedKnowledgeReceipt, [
    'relativePath',
    'status',
    'sha256',
  ], 'expected knowledge receipt');
  requiredText(
    options.expectedKnowledgeReceipt.relativePath,
    'expected knowledge receipt path',
    1_000,
  );
  if (!['matched', 'no_hit', 'degraded'].includes(
    options.expectedKnowledgeReceipt.status,
  )) {
    throw new Error('expected knowledge receipt status is invalid');
  }
  requireSha(
    options.expectedKnowledgeReceipt.sha256,
    'expected knowledge receipt SHA-256',
  );
  assertExactFields(options.expectedCommercePolicy, [
    'priceStatus',
    'refundRuleStatus',
  ], 'expected commerce policy');
  for (const field of ['priceStatus', 'refundRuleStatus']) {
    if (!['finalized', 'not_finalized'].includes(
      options.expectedCommercePolicy[field],
    )) {
      throw new Error(`expected commerce policy ${field} is invalid`);
    }
  }
  requireIsoTimestamp(options.referenceAt, 'trusted referenceAt');
  return options;
}

function validateEnvelope(value, expected) {
  if (
    value.schemaVersion !== 2
    || value.capabilityId !== 'content-customer-growth'
    || value.status !== 'candidate'
  ) {
    throw new Error('content customer growth v2 candidate identity is invalid');
  }
  requireEnterpriseId(value.enterpriseId);
  requireBusinessProjectId(value.businessProjectId);
  requireSafeId(value.taskId, 'taskId');
  requireSafeId(value.runId, 'runId');
  for (const field of [
    'enterpriseId',
    'businessProjectId',
    'taskId',
    'runId',
  ]) {
    if (value[field] !== expected[field]) {
      throw new Error(`candidate identity mismatch at ${field}`);
    }
  }
}

function createRoots(envelope, rootInput) {
  const projectRoot = path.resolve(rootInput);
  const businessProjectRoot = path.resolve(
    projectRoot,
    'business-projects',
    envelope.enterpriseId,
    envelope.businessProjectId,
  );
  const runRoot = path.resolve(
    businessProjectRoot,
    'organizations',
    'ai-growth-strategist',
    'runs',
    envelope.runId,
  );
  for (const [candidate, label] of [
    [projectRoot, 'projectRoot'],
    [businessProjectRoot, 'business project root'],
    [runRoot, 'run root'],
  ]) {
    assertInside(candidate, projectRoot, label);
    const details = lstatSync(candidate);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`${label} must be a regular directory`);
    }
  }
  const realProjectRoot = realpathSync(projectRoot);
  const realBusinessProjectRoot = realpathSync(businessProjectRoot);
  const realRunRoot = realpathSync(runRoot);
  assertInside(realBusinessProjectRoot, realProjectRoot, 'real business project');
  assertInside(realRunRoot, realProjectRoot, 'real run root');
  return {
    projectRoot,
    businessProjectRoot,
    runRoot,
    realBusinessProjectRoot,
    realRunRoot,
  };
}

function validateKnowledge(value, envelope, roots, expected) {
  assertExactFields(value, [
    'status',
    'evidencePath',
    'evidenceSha256',
  ], 'knowledgeContext');
  if (
    value.status !== expected.status
    || value.evidencePath !== expected.relativePath
    || value.evidenceSha256 !== expected.sha256
  ) {
    throw new Error('knowledge receipt does not match trusted receipt binding');
  }
  const expectedPath = path.resolve(
    roots.runRoot,
    'evidence',
    'knowledge-context.json',
  );
  const receiptPath = resolveSafeRelative(
    roots.projectRoot,
    value.evidencePath,
    roots.runRoot,
    'knowledge receipt',
  );
  if (receiptPath !== expectedPath) {
    throw new Error('knowledge receipt path is not task-bound');
  }
  const document = parseJsonFileWithSha(
    receiptPath,
    value.evidenceSha256,
    'knowledge receipt',
  );
  for (const field of [
    'enterpriseId',
    'businessProjectId',
    'taskId',
    'runId',
    'capabilityId',
  ]) {
    if (document[field] !== envelope[field]) {
      throw new Error(`knowledge receipt identity mismatch at ${field}`);
    }
  }
  if (document.schemaVersion !== 2 || document.status !== value.status) {
    throw new Error('knowledge receipt version or status mismatch');
  }
  if (value.status === 'matched'
    && (!Array.isArray(document.sources) || document.sources.length === 0)) {
    throw new Error('matched knowledge receipt requires bound sources');
  }
  if (
    value.status !== 'matched'
    && (
      !Array.isArray(document.limitations)
      || document.limitations.length === 0
    )
  ) {
    throw new Error('no_hit or degraded receipt requires limitations');
  }
  if (value.status === 'matched') {
    document.sources.forEach((source, index) => {
      assertExactFields(
        source,
        ['relativePath', 'sha256'],
        `knowledge receipt sources[${index}]`,
      );
      requireSha(source.sha256, `knowledge source[${index}] SHA-256`);
      const sourcePath = resolveSafeRelative(
        roots.projectRoot,
        source.relativePath,
        path.resolve(roots.runRoot, 'evidence', 'knowledge-sources'),
        `knowledge source[${index}]`,
      );
      readFileWithSha(
        sourcePath,
        source.sha256,
        `knowledge source[${index}]`,
      );
    });
  }
}

function validateScope(value, envelope, roots, expectedArtifacts, commerce) {
  assertExactFields(value, [
    'objective', 'timeRange', 'constraints', 'upstreamArtifacts',
  ], 'scope');
  requireDenseArray(value.upstreamArtifacts, 'scope upstream artifacts', 4, 4);
  const index = new Map();
  value.upstreamArtifacts.forEach((item, position) => {
    assertExactFields(item, [
      'artifactId',
      'version',
      'sha256',
      'path',
    ], `scope.upstreamArtifacts[${position}]`);
    validateArtifactIdentity(item, `scope.upstreamArtifacts[${position}]`);
    requiredText(item.path, `${item.artifactId}.path`, 1_000);
    const trusted = expectedArtifacts[position];
    if (
      item.artifactId !== UPSTREAM_IDS[position]
      || item.artifactId !== trusted.artifactId
      || item.version !== trusted.version
      || item.sha256 !== trusted.sha256
    ) {
      throw new Error(`upstream artifact version or SHA-256 binding mismatch at ${position}`);
    }
    const artifactPath = resolveSafeRelative(
      roots.projectRoot,
      item.path,
      roots.businessProjectRoot,
      item.artifactId,
    );
    const expectedPath = path.resolve(
      roots.businessProjectRoot,
      'shared-artifacts',
      item.artifactId,
      `v${item.version}.json`,
    );
    if (artifactPath !== expectedPath) {
      throw new Error(`${item.artifactId} path/version is inconsistent`);
    }
    const document = parseJsonFileWithSha(
      artifactPath,
      item.sha256,
      item.artifactId,
    );
    if (
      document.schemaVersion !== 1
      || document.status !== 'published'
      || document.artifactId !== item.artifactId
      || document.version !== item.version
      || document.enterpriseId !== envelope.enterpriseId
      || document.businessProjectId !== envelope.businessProjectId
    ) {
      throw new Error(`${item.artifactId} published document binding mismatch`);
    }
    index.set(item.artifactId, item);
  });
  for (const field of ['objective', 'timeRange']) {
    requiredText(value[field], `scope.${field}`, 1_000);
  }
  validateTextArray(value.constraints, 'scope.constraints', 2);
  return index;
}

function validateEvidence(value, roots, referenceAt) {
  requireDenseArray(value, 'evidence', 1, 200);
  const ids = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    assertExactFields(item, [
      'id', 'type', 'claim', 'sourceReference', 'sourceVersion',
      'sourceSha256', 'observedAt', 'appliesTo', 'confidence',
    ], `evidence[${index}]`);
    const id = requireSafeId(item.id, `evidence[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate evidence id: ${id}`);
    if (![
      'enterprise_fact', 'customer_quote', 'behavior_data',
      'feishu_knowledge', 'public_source', 'inference', 'hypothesis',
      'unknown',
    ].includes(item.type)) {
      throw new Error(`${id}.type is invalid`);
    }
    requiredText(item.claim, `${id}.claim`, 2_000);
    requiredText(item.sourceReference, `${id}.sourceReference`, 1_000);
    requiredText(item.sourceVersion, `${id}.sourceVersion`, 300);
    requireSha(item.sourceSha256, `${id}.sourceSha256`);
    requireIsoTimestamp(item.observedAt, `${id}.observedAt`);
    if (Date.parse(item.observedAt) > Date.parse(referenceAt)) {
      throw new Error(`${id}.observedAt cannot be in the future`);
    }
    requiredText(item.appliesTo, `${id}.appliesTo`, 1_000);
    if (!['A', 'B', 'C', 'D'].includes(item.confidence)) {
      throw new Error(`${id}.confidence must be A-D`);
    }
    ids.set(id, item.type);
  }
  return ids;
}

function validateMonthlyCapacity(value) {
  assertExactFields(value, [
    'planningHorizonDays',
    'channelLimits',
  ], 'monthlyCapacity');
  if (
    !Number.isInteger(value.planningHorizonDays)
    || value.planningHorizonDays < 28
    || value.planningHorizonDays > 31
  ) {
    throw new Error('monthlyCapacity.planningHorizonDays must be 28-31');
  }
  requireDenseArray(value.channelLimits, 'monthlyCapacity.channelLimits', 3, 3);
  value.channelLimits.forEach((limit, index) => {
    assertExactFields(limit, [
      'channel',
      'maximumUnitsPerWeek',
      'maximumUnitsPerMonth',
    ], `monthlyCapacity.channelLimits[${index}]`);
    if (limit.channel !== CHANNELS[index]) {
      throw new Error('monthly capacity must cover the three channels in fixed order');
    }
    if (
      limit.maximumUnitsPerWeek !== WEEKLY_LIMITS.get(limit.channel)
      || !Number.isInteger(limit.maximumUnitsPerMonth)
      || limit.maximumUnitsPerMonth < 1
      || limit.maximumUnitsPerMonth > limit.maximumUnitsPerWeek * 5
    ) {
      throw new Error(`${limit.channel} monthly capacity is invalid`);
    }
  });
}

function validateChannelPlans(value, upstream, evidenceIds) {
  requireDenseArray(value, 'channelPlans', 3, 3);
  const brand = upstream.get('brand-brief');
  value.forEach((plan, index) => {
    assertExactFields(plan, [
      'channel', 'audienceStage', 'objective', 'evidenceRefs',
      'brandArtifact', 'contentUnits', 'frequencyLimit', 'monthlyUnits',
      'metrics', 'experiment',
    ], `channelPlans[${index}]`);
    if (plan.channel !== CHANNELS[index]) {
      throw new Error('channel plans must be complete and in fixed order');
    }
    if (!LIFECYCLE_STAGES.includes(plan.audienceStage)) {
      throw new Error(`${plan.channel} contains invalid lifecycle stage`);
    }
    requiredText(plan.objective, `${plan.channel}.objective`, 1_000);
    if (plan.frequencyLimit !== WEEKLY_LIMITS.get(plan.channel)) {
      throw new Error(`${plan.channel} exceeds or changes its weekly capacity`);
    }
    if (
      !Number.isInteger(plan.monthlyUnits)
      || plan.monthlyUnits < 1
      || plan.monthlyUnits > plan.frequencyLimit * 5
    ) {
      throw new Error(`${plan.channel} monthly units exceed capacity`);
    }
    requireDenseArray(plan.contentUnits, `${plan.channel}.contentUnits`, 1, 20);
    plan.contentUnits.forEach((unit, position) => {
      assertExactFields(unit, [
        'topic', 'format', 'proof', 'evidenceRefs', 'cta',
        'allowedClaimReferences', 'stopConditions',
      ], `${plan.channel}.contentUnits[${position}]`);
      for (const field of ['topic', 'format', 'proof', 'cta']) {
        requiredText(unit[field], `${plan.channel}.${field}`, 1_000);
      }
      validateTextArray(unit.evidenceRefs, `${plan.channel}.unit.evidenceRefs`, 2);
      if (unit.evidenceRefs.some((ref) => !evidenceIds.has(ref))) {
        throw new Error(`${plan.channel} content unit contains unknown evidence`);
      }
      if (!unit.evidenceRefs.some((ref) => isFactualEvidence(
        evidenceIds.get(ref),
      ))) {
        throw new Error(
          `${plan.channel} content unit requires at least one fact evidence`,
        );
      }
      validateTextArray(
        unit.allowedClaimReferences,
        `${plan.channel}.allowedClaimReferences`,
        1,
      );
      validateTextArray(unit.stopConditions, `${plan.channel}.stopConditions`, 1);
    });
    assertExactFields(plan.brandArtifact, [
      'artifactId', 'version', 'sha256', 'path',
    ], `${plan.channel}.brandArtifact`);
    if (
      plan.brandArtifact.artifactId !== brand.artifactId
      || plan.brandArtifact.version !== brand.version
      || plan.brandArtifact.sha256 !== brand.sha256
      || plan.brandArtifact.path !== brand.path
    ) {
      throw new Error(`${plan.channel} brand brief artifact binding mismatch`);
    }
    validateTextArray(plan.evidenceRefs, `${plan.channel}.evidenceRefs`, 1);
    if (plan.evidenceRefs.some((ref) => !evidenceIds.has(ref))) {
      throw new Error(`${plan.channel} contains unknown evidence reference`);
    }
    validateTextArray(plan.metrics, `${plan.channel}.metrics`, 1);
    const experiment = createGrowthExperiment(plan.experiment);
    if (!experiment.requiresApproval) {
      throw new Error(`${plan.channel} experiment must preserve external approval`);
    }
  });
}

function validateLifecycle(value) {
  requireDenseArray(value, 'lifecycle', 6, 6);
  value.forEach((stage, index) => {
    assertExactFields(stage, [
      'stage',
      'entrySignal',
      'allowedActions',
      'exitSignal',
    ], `lifecycle[${index}]`);
    if (stage.stage !== LIFECYCLE_STAGES[index]) {
      throw new Error('lifecycle must contain the fixed six stages in order');
    }
    requiredText(stage.entrySignal, `${stage.stage}.entrySignal`, 1_000);
    validateTextArray(stage.allowedActions, `${stage.stage}.allowedActions`, 1);
    requiredText(stage.exitSignal, `${stage.stage}.exitSignal`, 1_000);
  });
  const inquiry = value.find((stage) => stage.stage === 'explicit-inquiry');
  if (
    hasPassiveSignal(inquiry.entrySignal)
    || value.some((stage) => (
      hasPassiveSignal(stage.exitSignal)
      && hasExplicitInquirySignal(stage.exitSignal)
    ))
  ) {
    throw new Error('passive engagement cannot become explicit inquiry');
  }
}

function validateConsent(value) {
  assertExactFields(value, [
    'purpose', 'allowedChannels', 'retentionDays', 'optOutMechanism',
    'refusalStopsContact', 'expiryStopsContact', 'noAutomatedOutreach',
    'noProactiveContact',
  ], 'consentPolicy');
  if (
    value.refusalStopsContact !== true
    || value.expiryStopsContact !== true
    || value.noAutomatedOutreach !== true
    || value.noProactiveContact !== true
  ) {
    throw new Error('consent requires refusal and expiry stop; automated outreach and proactive contact are forbidden');
  }
  requiredText(value.purpose, 'consentPolicy.purpose', 1_000);
  validateTextArray(value.allowedChannels, 'consentPolicy.allowedChannels', 1);
  if (
    value.allowedChannels.length !== 1
    || value.allowedChannels[0] !== 'permission-private-domain'
  ) {
    throw new Error('consent allowed channel must be permission-private-domain');
  }
  if (
    !Number.isInteger(value.retentionDays)
    || value.retentionDays < 1
    || value.retentionDays > 3_650
  ) {
    throw new Error('consent retentionDays must be 1-3650');
  }
  requiredText(value.optOutMechanism, 'consentPolicy opt-out mechanism', 1_000);
}

function validateNurturePlan(value) {
  assertExactFields(value, [
    'sequence',
    'silenceHandling',
    'refusalHandling',
    'expiryHandling',
  ], 'nurturePlan');
  const expected = [
    'problem-recognition',
    'method-education',
    'self-diagnosis',
    'applicability-boundary',
    'customer-initiated-request',
    'deal-officer-handoff',
  ];
  if (
    !Array.isArray(value.sequence)
    || value.sequence.length !== expected.length
    || expected.some((item, index) => value.sequence[index] !== item)
  ) {
    throw new Error('nurture plan must follow the fixed customer-led sequence');
  }
  for (const field of [
    'silenceHandling',
    'refusalHandling',
    'expiryHandling',
  ]) {
    requiredText(value[field], `nurturePlan.${field}`, 1_000);
  }
}

function validateDealHandoff(value, upstream, commerce) {
  assertExactFields(value, [
    'version', 'sourceArtifact', 'triggers', 'nonTriggers',
    'customerReferenceRule', 'requiredFields', 'feedbackFields',
    'pricePolicyStatus', 'refundPolicyStatus',
  ], 'dealHandoff');
  const contract = upstream.get('deal-handoff-contract');
  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new Error('deal handoff version must be positive');
  }
  assertExactFields(value.sourceArtifact, [
    'artifactId', 'version', 'sha256', 'path',
  ], 'dealHandoff.sourceArtifact');
  if (
    value.sourceArtifact.artifactId !== contract.artifactId
    || value.sourceArtifact.version !== contract.version
    || value.sourceArtifact.sha256 !== contract.sha256
    || value.sourceArtifact.path !== contract.path
  ) {
    throw new Error('deal handoff upstream version/SHA binding mismatch');
  }
  const expectedPrice = commerce.priceStatus === 'finalized'
    ? 'confirmed'
    : 'undecided';
  const expectedRefund = commerce.refundRuleStatus === 'finalized'
    ? 'confirmed'
    : 'undecided';
  if (
    value.pricePolicyStatus !== expectedPrice
    || value.refundPolicyStatus !== expectedRefund
  ) {
    throw new Error(
      'deal handoff commerce status does not match trusted price/refund policy',
    );
  }
  validateTextArray(value.triggers, 'dealHandoff.triggers', 1);
  validateTextArray(value.nonTriggers, 'dealHandoff.nonTriggers', 1);
  if (
    value.triggers.some((trigger) => hasPassiveSignal(trigger))
    || value.triggers.some((trigger) => !hasCustomerInitiatedDealSignal(trigger))
  ) {
    throw new Error(
      'deal handoff requires an explicit customer-initiated inquiry, quote, purchase or renewal',
    );
  }
  const piiRule = requiredText(
    value.customerReferenceRule,
    'dealHandoff.customerReferenceRule',
    1_000,
  );
  if (/raw\s+(?:phone|email)|明文(?:手机|邮箱)/iu.test(piiRule)) {
    throw new Error('deal handoff cannot contain raw PII');
  }
  if (
    !Array.isArray(value.requiredFields)
    || value.requiredFields.length !== HANDOFF_FIELDS.length
    || HANDOFF_FIELDS.some((field, index) => value.requiredFields[index] !== field)
  ) {
    throw new Error('deal handoff must contain the complete fixed 14 fields');
  }
  validateTextArray(value.feedbackFields, 'dealHandoff.feedbackFields', 1);
}

function validateRepurchase(value) {
  assertExactFields(value, [
    'eligibilitySignals', 'exclusions', 'contentActions',
    'dealHandoffTrigger', 'noUnrequestedFollowUp',
  ], 'repurchase');
  validateTextArray(value.eligibilitySignals, 'repurchase.eligibilitySignals', 1);
  validateTextArray(value.exclusions, 'repurchase.exclusions', 1);
  validateTextArray(value.contentActions, 'repurchase.contentActions', 1);
  requiredText(
    value.dealHandoffTrigger,
    'repurchase.dealHandoffTrigger',
    1_000,
  );
  const eligibilityText = value.eligibilitySignals.join(' ');
  if (
    hasPassiveSignal(eligibilityText)
    || hasRepurchaseConflict(eligibilityText)
    || !hasServiceCompletionSignal(eligibilityText)
    || !hasCustomerInitiatedRepurchaseSignal(eligibilityText)
    || !hasFinalizedProductPriceSignal(eligibilityText)
  ) {
    throw new Error(
      '复购 eligibility requires service completion, customer-initiated demand and finalized product/price without complaint, refund, delivery or opt-out conflicts',
    );
  }
  if (
    hasPassiveSignal(value.dealHandoffTrigger)
    || !hasCustomerInitiatedRepurchaseSignal(value.dealHandoffTrigger)
  ) {
    throw new Error(
      'repurchase handoff requires an explicit customer-initiated renewal or purchase request',
    );
  }
  if (value.noUnrequestedFollowUp !== true) {
    throw new Error('repurchase must forbid unrequested follow-up');
  }
  const exclusionText = value.exclusions.join(' ');
  for (const required of [/投诉/u, /退款/u, /交付/u, /退出|拒绝/u]) {
    if (!required.test(exclusionText)) {
      throw new Error('repurchase exclusions must include complaint, refund, delivery and opt-out');
    }
  }
}

function validateExternalActions(value) {
  requireDenseArray(value, 'externalActions', ACTIONS.length, ACTIONS.length);
  value.forEach((gate, index) => {
    assertExactFields(gate, [
      'action',
      'gate',
      'approvalId',
    ], `externalActions[${index}]`);
    if (
      gate.action !== ACTIONS[index]
      || gate.gate !== 'awaiting_approval'
      || gate.approvalId !== null
    ) {
      throw new Error('every external action must remain awaiting_approval');
    }
  });
}

function validateExperiments(value) {
  requireDenseArray(value, 'experiments', 1, 20);
  value.forEach((item) => createGrowthExperiment(item));
}

function validateCollaborations(value) {
  requireDenseArray(value, 'collaborationRequests', 2, 10);
  const allowed = new Set([
    'ai-brand-officer',
    'ai-deal-officer',
    'ai-helmsman',
  ]);
  value.forEach((item, index) => {
    assertExactFields(item, [
      'targetOrganization',
      'reason',
      'artifactBinding',
    ], `collaborationRequests[${index}]`);
    if (!allowed.has(item.targetOrganization)) {
      throw new Error('collaboration target is invalid');
    }
    requiredText(item.reason, 'collaboration reason', 1_000);
    requiredText(item.artifactBinding, 'collaboration artifactBinding', 300);
  });
}

function validateBrowserTimelineBindings(value, envelope, roots) {
  requireDenseArray(value, 'browserTimelineBindings', 3, 3);
  value.forEach((binding, index) => {
    assertExactFields(binding, [
      'stepId',
      'used',
      'continuousActionStandard',
      'controller',
      'timelinePath',
    ], `browserTimelineBindings[${index}]`);
    const expectedStep = `${CHANNELS[index]}-plan`;
    if (
      binding.stepId !== expectedStep
      || binding.continuousActionStandard
        !== 'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md'
      || binding.controller
        !== 'scripts/browser_continuous_action_controller.mjs'
      || typeof binding.used !== 'boolean'
    ) {
      throw new Error('browser timeline binding does not reuse the shared runtime');
    }
    if (!binding.used && binding.timelinePath !== null) {
      throw new Error('unused browser action cannot claim a timeline');
    }
    if (binding.used) {
      const expectedPath = [
        'temp',
        'content-customer-growth',
        envelope.enterpriseId,
        envelope.businessProjectId,
        envelope.taskId,
        envelope.runId,
        `${binding.stepId}.jsonl`,
      ].join('/');
      if (binding.timelinePath !== expectedPath) {
        throw new Error('browser timeline is outside the current task identity');
      }
      validateBrowserTimelineFile(binding.timelinePath, binding, envelope, roots);
    }
  });
}

function validateDebugReport(value, candidate) {
  assertExactFields(value, [
    'status',
    'channelLifecycleMatrix',
    'diagnostics',
    'remainingUnknowns',
  ], 'debugReport');
  if (!['passed', 'passed_with_unknowns', 'blocked'].includes(value.status)) {
    throw new Error('debugReport.status is invalid');
  }
  requireDenseArray(
    value.channelLifecycleMatrix,
    'debugReport.channelLifecycleMatrix',
    18,
    18,
  );
  for (const channel of CHANNELS) {
    for (const stage of LIFECYCLE_STAGES) {
      if (!value.channelLifecycleMatrix.some(
        (item) => item.channel === channel && item.stage === stage,
      )) {
        throw new Error('debug report must cover every channel×lifecycle cell');
      }
    }
  }
  value.channelLifecycleMatrix.forEach((item, index) => {
    assertExactFields(item, [
      'channel', 'stage', 'status', 'code',
    ], `debugReport.channelLifecycleMatrix[${index}]`);
    requiredText(item.status, 'debug matrix status', 100);
    requireSafeId(item.code, 'debug matrix code');
  });
  requireDenseArray(value.diagnostics, 'debugReport.diagnostics', 1, 100);
  value.diagnostics.forEach((item, index) => {
    assertExactFields(item, [
      'code', 'severity', 'field', 'explanation', 'recoveryAction',
    ], `debugReport.diagnostics[${index}]`);
    requireDiagnosticCode(item.code);
    if (!['info', 'warning', 'blocking'].includes(item.severity)) {
      throw new Error('diagnostic severity is invalid');
    }
    for (const field of ['field', 'explanation', 'recoveryAction']) {
      requiredText(item[field], `diagnostic.${field}`, 2_000);
    }
  });
  validateTextArray(
    value.remainingUnknowns,
    'debugReport.remainingUnknowns',
    value.status === 'passed' ? 0 : 1,
  );
  const expected = createContentCustomerGrowthDebugReport(candidate);
  if (!isDeepStrictEqual(value, expected)) {
    throw new Error(
      'debug report does not match the deterministic content diagnostic result',
    );
  }
}

function validateBrowserTimelineFile(relativePath, binding, envelope, roots) {
  const allowedRoot = path.resolve(
    roots.projectRoot,
    'temp',
    'content-customer-growth',
    envelope.enterpriseId,
    envelope.businessProjectId,
    envelope.taskId,
    envelope.runId,
  );
  const timelinePath = resolveSafeRelative(
    roots.projectRoot,
    relativePath,
    allowedRoot,
    'browser timeline',
  );
  const bytes = readFileSync(timelinePath);
  if (bytes.length === 0 || bytes.length > 1024 * 1024) {
    throw new Error('browser timeline file size is invalid');
  }
  const source = bytes.toString('utf8');
  if (source.charCodeAt(0) === 0xFEFF || !source.endsWith('\n')) {
    throw new Error('browser timeline must be UTF-8 without BOM and end in newline');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.some((line) => !line.trim())) {
    throw new Error('browser timeline contains a blank record');
  }
  const entries = lines.map((line, index) => {
    assertNoDuplicateJsonKeys(line, `browser timeline line ${index + 1}`);
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `browser timeline line ${index + 1} is invalid JSON: ${error.message}`,
        { cause: error },
      );
    }
  });
  const identity = entries[0];
  assertExactFields(identity, [
    'schemaVersion',
    'event',
    'enterpriseId',
    'businessProjectId',
    'taskId',
    'runId',
    'stepId',
    'controller',
  ], 'browser timeline identity');
  if (
    identity.schemaVersion !== 1
    || identity.event !== 'content_timeline_identity'
    || identity.enterpriseId !== envelope.enterpriseId
    || identity.businessProjectId !== envelope.businessProjectId
    || identity.taskId !== envelope.taskId
    || identity.runId !== envelope.runId
    || identity.stepId !== binding.stepId
    || identity.controller
      !== 'scripts/browser_continuous_action_controller.mjs'
  ) {
    throw new Error('browser timeline identity does not match the current task');
  }
  if (
    !entries.some((entry) => entry.event === 'sequence_started')
    || !entries.some((entry) => entry.event === 'sequence_completed')
  ) {
    throw new Error('browser timeline is missing a completed shared sequence');
  }
}

function isFactualEvidence(type) {
  return [
    'enterprise_fact',
    'customer_quote',
    'behavior_data',
    'feishu_knowledge',
    'public_source',
  ].includes(type);
}

function requireDiagnosticCode(value) {
  if (
    typeof value !== 'string'
    || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u.test(value)
  ) {
    throw new Error('diagnostic code is invalid or unsafe');
  }
  return value;
}

function hasPassiveSignal(value) {
  return /(?:\b(?:view|click|like|follow|collect|watch|download)\b|观看|浏览|点击|点赞|关注|收藏|领取|被动到场|被动信号)/iu.test(
    value,
  );
}

function hasExplicitInquirySignal(value) {
  return /(?:explicit[\s-]*inquiry|明确询盘|主动咨询|自主咨询|报价请求|购买请求|续费请求)/iu.test(
    value,
  );
}

function hasCustomerInitiatedDealSignal(value) {
  return /(?:(?:客户|customer).*(?:自主|主动|明确|initiated|explicit).*(?:咨询|询盘|报价|购买|续费|inquiry|quote|purchase|renew)|(?:咨询|询盘|报价|购买|续费|inquiry|quote|purchase|renew).*(?:请求|request))/iu.test(
    value,
  );
}

function hasCustomerInitiatedRepurchaseSignal(value) {
  return /(?:(?:客户|customer).*(?:自主|主动|明确|initiated|explicit).*(?:进一步需求|续费|再次购买|购买|renew|repurchase|purchase|need)|(?:续费|再次购买|repurchase|renew).*(?:请求|request))/iu.test(
    value,
  );
}

function hasServiceCompletionSignal(value) {
  return /(?:主要服务完成|服务已完成|service\s+(?:is\s+)?complete)/iu.test(value);
}

function hasFinalizedProductPriceSignal(value) {
  return /(?:产品.*价格.*(?:已确认|已定版)|product.*price.*(?:confirmed|finalized))/iu.test(
    value,
  );
}

function hasRepurchaseConflict(value) {
  return /(?:未解决投诉|活跃投诉|未解决退款|退款处理中|未解决交付|交付问题|客户已退出|客户拒绝|active complaint|unresolved refund|delivery issue|opted out|refused)/iu.test(
    value,
  );
}

function validateArtifactIdentity(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an artifact object`);
  }
  for (const field of ['artifactId', 'version', 'sha256']) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing ${field}`);
    }
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => ![
      'artifactId', 'version', 'sha256', 'path',
    ].includes(key))
    || keys.length < 3
    || keys.length > 4
  ) {
    throw new Error(`${label} artifact fields are invalid`);
  }
  requireSafeId(value.artifactId, `${label}.artifactId`);
  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new Error(`${label}.version must be a positive integer`);
  }
  requireSha(value.sha256, `${label}.sha256`);
}

function requireSha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function requireDenseArray(value, label, minimum, maximum) {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || Object.keys(value).length !== value.length
  ) {
    throw new Error(`${label} must be a dense array with ${minimum}-${maximum} items`);
  }
}

function resolveSafeRelative(projectRoot, relativePath, allowedRoot, label) {
  requiredText(relativePath, `${label} path`, 1_000);
  if (
    path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`${label} path is unsafe`);
  }
  const resolved = path.resolve(projectRoot, relativePath);
  assertInside(resolved, allowedRoot, label);
  assertRegularPathChain(projectRoot, allowedRoot, `${label} allowed root`);
  assertRegularPathChain(projectRoot, resolved, label);
  const details = lstatSync(resolved);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-link file`);
  }
  const real = realpathSync(resolved);
  const realProjectRoot = realpathSync(projectRoot);
  const realAllowedRoot = realpathSync(allowedRoot);
  assertInside(realAllowedRoot, realProjectRoot, `real ${label} allowed root`);
  assertInside(real, realAllowedRoot, `real ${label}`);
  return resolved;
}

function assertRegularPathChain(projectRoot, target, label) {
  const root = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(target);
  assertInside(resolvedTarget, root, label);
  const relative = path.relative(root, resolvedTarget);
  let cursor = root;
  const parts = relative ? relative.split(path.sep) : [];
  const rootDetails = lstatSync(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error(`${label} project root must be a regular directory`);
  }
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const details = lstatSync(cursor);
    if (details.isSymbolicLink()) {
      throw new Error(`${label} must not cross a symbolic link or junction`);
    }
    if (index < parts.length - 1 && !details.isDirectory()) {
      throw new Error(`${label} parent must be a regular directory`);
    }
  }
}

function assertInside(candidate, parent, label) {
  const relative = path.relative(parent, candidate);
  if (
    relative.startsWith('..')
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${label} is outside its trusted root`);
  }
}

function readFileWithSha(filePath, expectedSha, label) {
  const bytes = readFileSync(filePath);
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== expectedSha) {
    throw new Error(`${label} SHA-256 does not match`);
  }
  return bytes;
}

function parseJsonFileWithSha(filePath, expectedSha, label) {
  const source = readFileWithSha(filePath, expectedSha, label).toString('utf8');
  assertNoDuplicateJsonKeys(source, label);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}
