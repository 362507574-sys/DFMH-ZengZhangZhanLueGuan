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

import {
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
import { createGrowthExperiment } from './growth_experiment_manager.mjs';
import { classifyPrivatePerformanceText } from './competitive_benchmark_claim_classifier.mjs';
import {
  assertNoDuplicateJsonKeys,
  assertPlainData,
} from './strict_json.mjs';

const TOP_FIELDS = Object.freeze([
  'schemaVersion',
  'capabilityId',
  'enterpriseId',
  'businessProjectId',
  'taskId',
  'runId',
  'status',
  'knowledgeContext',
  'scope',
  'evidence',
  'samples',
  'transfers',
  'boundaryChecks',
  'collaborationRequests',
  'debugReport',
  'review',
]);
const LAYER_IDS = Object.freeze([
  'positioning',
  'productStrategy',
  'contentMechanism',
  'acquisitionChannels',
  'observableCustomerPath',
]);
const SAMPLE_FIELDS = Object.freeze([
  'id',
  'name',
  'kind',
  'selectionReason',
  'observedAt',
  'evidenceRefs',
  'layers',
  'privateUnknowns',
]);
const LAYER_FIELDS = Object.freeze([
  'publicFacts',
  'inferences',
  'unknowns',
  'evidenceRefs',
]);
const EVIDENCE_FIELDS = Object.freeze([
  'id',
  'type',
  'claim',
  'sourcePath',
  'sourceVersion',
  'sourceSha256',
  'observedAt',
  'appliesTo',
]);
const TRANSFER_FIELDS = Object.freeze([
  'id',
  'evidenceRefs',
  'surfaceAction',
  'underlyingMechanism',
  'enterpriseFit',
  'originalImplementation',
  'doNotCopy',
  'antiCopyChecks',
  'experiment',
]);
const ANTI_COPY_FIELDS = Object.freeze([
  'copiesName',
  'copiesSlogan',
  'copiesCoreCopy',
  'copiesVisualIdentity',
  'copiesCases',
  'brandConfusionRisk',
  'intellectualPropertyRisk',
]);
const REQUIRED_DO_NOT_COPY = Object.freeze([
  '名称',
  '口号',
  '核心文案',
  '视觉身份',
  '案例',
]);
const DIAGNOSTIC_FIELDS = Object.freeze([
  'code',
  'severity',
  'affectedSample',
  'explanation',
  'recoveryAction',
]);
const UPSTREAM_DOCUMENT_FIELDS = Object.freeze([
  'schemaVersion',
  'artifactId',
  'version',
  'enterpriseId',
  'businessProjectId',
  'opportunity',
  'status',
]);
const RECEIPT_FIELDS = Object.freeze([
  'schemaVersion',
  'enterpriseId',
  'businessProjectId',
  'taskId',
  'runId',
  'capabilityId',
  'status',
  'query',
  'sources',
  'limitations',
]);
const DIAGNOSTIC_SEVERITY = new Map([
  ['public_scope_only', 'info'],
  ['all_sources_current', 'info'],
  ['ok', 'info'],
  ['missing_alternative_sample', 'warning'],
  ['limited_direct_sample', 'warning'],
  ['stale_source', 'warning'],
  ['presence_is_not_effectiveness', 'warning'],
  ['observable_path_gap', 'warning'],
  ['private_performance_claim', 'blocking'],
  ['copy_risk', 'blocking'],
  ['brand_confusion', 'blocking'],
  ['intellectual_property_risk', 'blocking'],
  ['price_deal_boundary_change', 'blocking'],
  ['invalid_sample_mix', 'blocking'],
  ['future_source', 'blocking'],
]);
const COLLABORATION_TARGETS = new Set([
  'ai-brand-officer',
  'ai-deal-officer',
  'ai-helmsman',
  'ai-organization-officer',
]);
const EVIDENCE_TYPES = new Set(['public_fact', 'scope_fact']);
const SHA256 = /^[0-9a-f]{64}$/u;
const PRIVATE_PERFORMANCE_WITH_NUMBER =
  /(?:private\s+(?:conversion|revenue|profit)|转化率|成交率|私信率|复购率|收入|营收|利润).{0,40}(?:\d+(?:\.\d+)?\s*(?:%|percent|万|万元|元|million|billion))/iu;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SOURCE_AGE_DAYS = 365;
const FACT_INFERENCE_MARKER =
  /(?:可能|推测|推断|预计|或许|大概|likely|probably|may|might|infer)/iu;

export function validateCompetitiveBenchmarkV2Candidate(value, options) {
  assertPlainData(value, 'competitive benchmark v2 candidate', {
    maxDepth: 32,
    maxNodes: 20_000,
    maxArrayLength: 1_000,
  });
  assertPlainData(options, 'competitive benchmark trusted options', {
    maxDepth: 8,
    maxNodes: 50,
    maxArrayLength: 10,
  });
  const trusted = validateTrustedOptions(options);
  assertExactFields(value, TOP_FIELDS, 'competitive benchmark v2 candidate');
  validateEnvelope(value, trusted.expectedIdentity);
  const roots = createTrustedRoots(value, trusted.projectRoot);
  validateKnowledgeContext(
    value.knowledgeContext,
    roots,
    value,
    trusted.expectedKnowledgeReceipt,
  );
  validateScope(value.scope, roots, trusted.expectedUpstream, value);
  const evidenceIndex = validateEvidence(
    value.evidence,
    roots,
    trusted.referenceAt,
  );
  validateSamples(value.samples, evidenceIndex);
  validateTransfers(value.transfers, evidenceIndex);
  validateBoundaryChecks(value.boundaryChecks);
  validateCollaborations(value.collaborationRequests);
  validateDebugReport(value.debugReport, value, trusted.referenceAt);
  assertExactFields(
    value.review,
    ['baselineMetrics', 'reviewAt', 'decisionRules'],
    'review',
  );
  validateReview(value.review);
  auditCandidateBusinessText(value);
  assertNoProhibitedClaims(value);
  return freezeCandidate(value);
}

function validateTrustedOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error(
      'v2 candidate requires trusted expected identity and projectRoot',
    );
  }
  assertExactFields(
    options,
    [
      'expectedIdentity',
      'projectRoot',
      'expectedUpstream',
      'expectedKnowledgeReceipt',
      'referenceAt',
    ],
    'competitive benchmark trusted options',
  );
  assertExactFields(
    options.expectedIdentity,
    ['enterpriseId', 'businessProjectId', 'taskId', 'runId'],
    'competitive benchmark expected identity',
  );
  requireEnterpriseId(options.expectedIdentity.enterpriseId);
  requireBusinessProjectId(options.expectedIdentity.businessProjectId);
  requireSafeId(options.expectedIdentity.taskId, 'expected taskId');
  requireSafeId(options.expectedIdentity.runId, 'expected runId');
  assertExactFields(
    options.expectedUpstream,
    ['artifactId', 'version', 'sha256'],
    'competitive benchmark expected upstream',
  );
  requiredText(
    options.expectedUpstream.artifactId,
    'expected upstream artifactId',
    200,
  );
  if (
    !Number.isInteger(options.expectedUpstream.version)
    || options.expectedUpstream.version < 1
  ) {
    throw new Error('expected upstream version must be a positive integer');
  }
  requireSha(options.expectedUpstream.sha256, 'expected upstream SHA-256');
  assertExactFields(
    options.expectedKnowledgeReceipt,
    ['relativePath', 'status', 'sha256'],
    'expected knowledge receipt',
  );
  requiredText(
    options.expectedKnowledgeReceipt.relativePath,
    'expected knowledge receipt relativePath',
    1_000,
  );
  if (
    path.isAbsolute(options.expectedKnowledgeReceipt.relativePath)
    || options.expectedKnowledgeReceipt.relativePath
      .split(/[\\/]/u)
      .includes('..')
  ) {
    throw new Error('expected knowledge receipt relativePath is unsafe');
  }
  if (
    !['matched', 'degraded', 'no_hit']
      .includes(options.expectedKnowledgeReceipt.status)
  ) {
    throw new Error('expected knowledge receipt status is invalid');
  }
  requireSha(
    options.expectedKnowledgeReceipt.sha256,
    'expected knowledge receipt SHA-256',
  );
  requireIsoTimestamp(options.referenceAt, 'trusted referenceAt');
  if (
    typeof options.projectRoot !== 'string'
    || !options.projectRoot.trim()
  ) {
    throw new Error('trusted projectRoot is required');
  }
  return options;
}

function validateEnvelope(value, expected) {
  if (
    value.schemaVersion !== 2
    || value.capabilityId !== 'competitive-benchmark-analysis'
    || value.status !== 'candidate'
  ) {
    throw new Error('competitive benchmark v2 candidate identity is invalid');
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

function createTrustedRoots(envelope, projectRootInput) {
  const projectRoot = path.resolve(projectRootInput);
  assertSafeDirectory(projectRoot, 'projectRoot');
  const realProjectRoot = realpathSync(projectRoot);
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
  assertInside(projectRoot, businessProjectRoot, 'business project root');
  assertInside(projectRoot, runRoot, 'run root');
  assertSafePathChain(projectRoot, businessProjectRoot, 'business project root');
  assertSafePathChain(projectRoot, runRoot, 'run root');
  const realBusinessProjectRoot = realpathSync(businessProjectRoot);
  const realRunRoot = realpathSync(runRoot);
  assertInside(realProjectRoot, realBusinessProjectRoot, 'real business project');
  assertInside(realProjectRoot, realRunRoot, 'real run root');
  return Object.freeze({
    projectRoot,
    realProjectRoot,
    businessProjectRoot,
    realBusinessProjectRoot,
    runRoot,
    realRunRoot,
  });
}

function validateKnowledgeContext(value, roots, envelope, expectedTrusted) {
  assertExactFields(
    value,
    ['status', 'evidencePath', 'evidenceSha256'],
    'knowledgeContext',
  );
  if (!['matched', 'degraded', 'no_hit'].includes(value.status)) {
    throw new Error('knowledge context status is invalid');
  }
  requiredText(value.evidencePath, 'knowledgeContext.evidencePath', 1_000);
  requireSha(value.evidenceSha256, 'knowledgeContext.evidenceSha256');
  if (value.evidencePath !== expectedTrusted.relativePath) {
    throw new Error('expected knowledge receipt path mismatch');
  }
  if (value.status !== expectedTrusted.status) {
    throw new Error('expected knowledge receipt status mismatch');
  }
  if (value.evidenceSha256 !== expectedTrusted.sha256) {
    throw new Error('expected knowledge receipt SHA-256 mismatch');
  }
  const expected = path.resolve(roots.runRoot, 'evidence', 'knowledge-context.json');
  const receipt = resolveTrustedRelativePath({
    roots,
    relativePath: value.evidencePath,
    allowedRoot: roots.runRoot,
    realAllowedRoot: roots.realRunRoot,
    label: 'knowledge receipt',
  });
  if (path.resolve(receipt) !== expected) {
    throw new Error('knowledge receipt path is outside the current project run');
  }
  const bytes = verifyRegularFileSha(
    receipt,
    value.evidenceSha256,
    'knowledge receipt',
  );
  const document = parseStrictJson(bytes, 'knowledge receipt');
  assertExactFields(document, RECEIPT_FIELDS, 'knowledge receipt document');
  if (document.schemaVersion !== 2) {
    throw new Error('knowledge receipt schemaVersion must be 2');
  }
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
  if (document.status !== value.status) {
    throw new Error('knowledge receipt status does not match candidate');
  }
  requiredText(document.query, 'knowledge receipt query', 2_000);
  validateKnowledgeReceiptSources(document.sources);
  validateTextArray(
    document.limitations,
    'knowledge receipt limitations',
    0,
  );
  validateKnowledgeReceiptSemantics(document, roots);
}

function validateScope(value, roots, expectedUpstream, envelope) {
  assertExactFields(value, [
    'upstreamArtifact',
    'objective',
    'productOrService',
    'region',
    'timeRange',
    'brandBriefVersion',
    'constraints',
  ], 'scope');
  for (const field of [
    'objective',
    'productOrService',
    'region',
    'timeRange',
    'brandBriefVersion',
  ]) {
    requiredText(value[field], `scope.${field}`, 1_000);
  }
  validateTextArray(value.constraints, 'scope.constraints', 1);
  validateUpstreamArtifact(
    value.upstreamArtifact,
    roots,
    expectedUpstream,
    envelope,
  );
}

function validateUpstreamArtifact(value, roots, expectedTrusted, envelope) {
  assertExactFields(
    value,
    ['artifactId', 'version', 'sha256', 'path'],
    'scope.upstreamArtifact',
  );
  if (value.artifactId !== 'growth-opportunity-brief') {
    throw new Error('upstream artifactId must be growth-opportunity-brief');
  }
  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new Error('upstream artifact version must be a positive integer');
  }
  requireSha(value.sha256, 'upstream artifact SHA-256');
  requiredText(value.path, 'upstream artifact path', 1_000);
  for (const field of ['artifactId', 'version', 'sha256']) {
    if (value[field] !== expectedTrusted[field]) {
      const label = field === 'sha256' ? 'SHA-256' : field;
      throw new Error(`expected upstream artifact mismatch at ${label}`);
    }
  }
  const expected = path.resolve(
    roots.businessProjectRoot,
    'shared-artifacts',
    'growth-opportunity-brief',
    `v${value.version}.json`,
  );
  const upstream = resolveTrustedRelativePath({
    roots,
    relativePath: value.path,
    allowedRoot: roots.businessProjectRoot,
    realAllowedRoot: roots.realBusinessProjectRoot,
    label: 'upstream artifact',
  });
  if (path.resolve(upstream) !== expected) {
    throw new Error('upstream artifact path or version is inconsistent');
  }
  const bytes = verifyRegularFileSha(
    upstream,
    value.sha256,
    'upstream artifact',
  );
  const document = parseStrictJson(bytes, 'upstream artifact');
  assertExactFields(
    document,
    UPSTREAM_DOCUMENT_FIELDS,
    'upstream artifact document',
  );
  if (
    document.schemaVersion !== 1
    || document.status !== 'published'
  ) {
    throw new Error('upstream artifact must be schema 1 and published');
  }
  for (const field of [
    'artifactId',
    'version',
    'enterpriseId',
    'businessProjectId',
  ]) {
    const expected = field === 'enterpriseId'
      || field === 'businessProjectId'
      ? envelope[field]
      : expectedTrusted[field];
    if (document[field] !== expected) {
      throw new Error(`upstream artifact document mismatch at ${field}`);
    }
  }
  requiredText(document.opportunity, 'upstream artifact opportunity', 5_000);
}

function validateEvidence(value, roots, referenceAt) {
  requireDenseArray(value, 'evidence', 4, 200);
  const index = new Map();
  for (let position = 0; position < value.length; position += 1) {
    const item = value[position];
    assertExactFields(item, EVIDENCE_FIELDS, `evidence[${position}]`);
    const id = requireSafeId(item.id, `evidence[${position}].id`);
    if (index.has(id)) throw new Error(`duplicate evidence id: ${id}`);
    if (!EVIDENCE_TYPES.has(item.type)) {
      throw new Error(`${id}.type must be public_fact or scope_fact`);
    }
    requiredText(item.claim, `${id}.claim`, 2_000);
    if (classifyPrivatePerformanceText(item.claim, {
      context: item.type,
    }).prohibitedAssertion) {
      throw new Error(`private performance text audit failed at ${id}.claim`);
    }
    requiredText(item.sourcePath, `${id}.sourcePath`, 1_000);
    requiredText(item.sourceVersion, `${id}.sourceVersion`, 300);
    requireSha(item.sourceSha256, `${id}.sourceSha256`);
    requireIsoTimestamp(item.observedAt, `${id}.observedAt`);
    if (Date.parse(item.observedAt) > Date.parse(referenceAt)) {
      throw new Error(`${id}.observedAt cannot be in the future`);
    }
    requireSafeId(item.appliesTo, `${id}.appliesTo`);
    const sourcePath = resolveTrustedRelativePath({
      roots,
      relativePath: item.sourcePath,
      allowedRoot: path.resolve(roots.runRoot, 'evidence', 'sources'),
      realAllowedRoot: realpathSync(
        path.resolve(roots.runRoot, 'evidence', 'sources'),
      ),
      label: `${id} source`,
    });
    const sourceBytes = verifyRegularFileSha(
      sourcePath,
      item.sourceSha256,
      `${id} source`,
    );
    if (
      item.type === 'public_fact'
      && !normalizeText(sourceBytes.toString('utf8'))
        .includes(normalizeText(item.claim))
    ) {
      throw new Error(`${id} public_fact claim exceeds its bound source`);
    }
    index.set(id, item);
  }
  return index;
}

function validateSamples(value, evidenceIndex) {
  requireDenseArray(value, 'samples', 4, 4);
  let direct = 0;
  let alternative = 0;
  const ids = new Set();
  for (let position = 0; position < value.length; position += 1) {
    const sample = value[position];
    assertExactFields(sample, SAMPLE_FIELDS, `samples[${position}]`);
    const id = requireSafeId(sample.id, `samples[${position}].id`);
    if (ids.has(id)) throw new Error(`duplicate sample id: ${id}`);
    ids.add(id);
    requiredText(sample.name, `${id}.name`, 300);
    requiredText(sample.selectionReason, `${id}.selectionReason`, 1_000);
    requireIsoTimestamp(sample.observedAt, `${id}.observedAt`);
    if (sample.kind === 'direct') direct += 1;
    else if (sample.kind === 'alternative') alternative += 1;
    else throw new Error(`${id}.kind must be direct or alternative`);
    validateEvidenceRefs(sample.evidenceRefs, evidenceIndex, `${id}.evidenceRefs`);
    assertExactFields(sample.layers, LAYER_IDS, `${id}.layers`);
    for (const layerId of LAYER_IDS) {
      validateLayer(sample.layers[layerId], evidenceIndex, id, layerId);
    }
    validateTextArray(sample.privateUnknowns, `${id}.privateUnknowns`, 1);
    validatePrivateBucket(
      sample.privateUnknowns,
      'private_unknown',
      `${id}.privateUnknowns`,
    );
  }
  if (direct !== 3 || alternative !== 1) {
    throw new Error(
      'benchmark sample requires exactly three direct and one alternative sample',
    );
  }
}

function validateLayer(value, evidenceIndex, sampleId, layerId) {
  assertExactFields(value, LAYER_FIELDS, `${sampleId}.${layerId}`);
  validateTextArray(
    value.publicFacts,
    `${sampleId}.${layerId}.publicFacts`,
    1,
  );
  validateTextArray(
    value.inferences,
    `${sampleId}.${layerId}.inferences`,
    1,
  );
  validateTextArray(
    value.unknowns,
    `${sampleId}.${layerId}.unknowns`,
    1,
  );
  if (value.publicFacts.some((item) => FACT_INFERENCE_MARKER.test(item))) {
    throw new Error(
      `${sampleId}.${layerId}.publicFacts cannot contain inference language`,
    );
  }
  validatePrivateBucket(
    value.publicFacts,
    'public_fact',
    `${sampleId}.${layerId}.publicFacts`,
  );
  validatePrivateBucket(
    value.inferences,
    'inference',
    `${sampleId}.${layerId}.inferences`,
  );
  validatePrivateBucket(
    value.unknowns,
    'unknown',
    `${sampleId}.${layerId}.unknowns`,
  );
  const buckets = [
    ['publicFacts', value.publicFacts],
    ['inferences', value.inferences],
    ['unknowns', value.unknowns],
  ];
  const seen = new Map();
  for (const [bucket, items] of buckets) {
    for (const item of items) {
      const normalized = normalizeText(item);
      const previous = seen.get(normalized);
      if (previous && previous !== bucket) {
        throw new Error(
          `${sampleId}.${layerId} has overlap between ${previous} and ${bucket}`,
        );
      }
      seen.set(normalized, bucket);
    }
  }
  const evidence = validateEvidenceRefs(
    value.evidenceRefs,
    evidenceIndex,
    `${sampleId}.${layerId}.evidenceRefs`,
  );
  if (evidence.some((item) => item.appliesTo !== sampleId)) {
    throw new Error(`${sampleId}.${layerId} references another sample`);
  }
}

function validateTransfers(value, evidenceIndex) {
  requireDenseArray(value, 'transfers', 1, 100);
  const ids = new Set();
  for (let position = 0; position < value.length; position += 1) {
    const transfer = value[position];
    assertExactFields(transfer, TRANSFER_FIELDS, `transfers[${position}]`);
    const id = requireSafeId(transfer.id, `transfers[${position}].id`);
    if (ids.has(id)) throw new Error(`duplicate transfer id: ${id}`);
    ids.add(id);
    validateEvidenceRefs(
      transfer.evidenceRefs,
      evidenceIndex,
      `${id}.evidenceRefs`,
      2,
    );
    for (const field of [
      'surfaceAction',
      'underlyingMechanism',
      'enterpriseFit',
      'originalImplementation',
    ]) {
      requiredText(transfer[field], `${id}.${field}`, 2_000);
    }
    if (
      normalizeText(transfer.surfaceAction)
      === normalizeText(transfer.underlyingMechanism)
    ) {
      throw new Error(`${id} surface action and mechanism must be distinct`);
    }
    validateTextArray(transfer.doNotCopy, `${id}.doNotCopy`, 5);
    for (const required of REQUIRED_DO_NOT_COPY) {
      if (!transfer.doNotCopy.includes(required)) {
        throw new Error(`${id}.doNotCopy is missing ${required}`);
      }
    }
    validateAntiCopyChecks(transfer.antiCopyChecks, id);
    validateExperiment(transfer.experiment, id);
  }
}

function validateAntiCopyChecks(value, transferId) {
  assertExactFields(value, ANTI_COPY_FIELDS, `${transferId}.antiCopyChecks`);
  for (const field of ANTI_COPY_FIELDS.slice(0, 5)) {
    if (value[field] !== false) {
      throw new Error(`${transferId} copy risk check failed: ${field}`);
    }
  }
  if (value.brandConfusionRisk !== 'none') {
    throw new Error(`${transferId} brand confusion risk must be none`);
  }
  if (value.intellectualPropertyRisk !== 'none') {
    throw new Error(`${transferId} intellectual property risk must be none`);
  }
}

function validateExperiment(value, transferId) {
  const input = structuredClone(value);
  delete input.requiresApproval;
  let normalized;
  try {
    normalized = createGrowthExperiment(input);
  } catch (error) {
    throw new Error(
      `${transferId}.experiment is invalid: ${error.message}`,
      { cause: error },
    );
  }
  if (normalized.requiresApproval !== value.requiresApproval) {
    throw new Error(`${transferId}.experiment approval marker is invalid`);
  }
}

function validateCollaborations(value) {
  requireDenseArray(value, 'collaborationRequests', 0, 100);
  for (let position = 0; position < value.length; position += 1) {
    const request = value[position];
    assertExactFields(
      request,
      ['targetOrganization', 'reason'],
      `collaborationRequests[${position}]`,
    );
    if (!COLLABORATION_TARGETS.has(request.targetOrganization)) {
      throw new Error('collaboration target is invalid');
    }
    requiredText(request.reason, 'collaboration reason', 1_000);
  }
}

function validateDebugReport(value, candidate, referenceAt) {
  assertExactFields(
    value,
    ['status', 'diagnostics', 'remainingUnknowns'],
    'debugReport',
  );
  if (!['passed', 'passed_with_unknowns', 'blocked'].includes(value.status)) {
    throw new Error('debugReport.status is invalid');
  }
  requireDenseArray(value.diagnostics, 'debugReport.diagnostics', 1, 200);
  let hasBlocking = false;
  let hasWarning = false;
  const sampleIds = new Set(candidate.samples.map((sample) => sample.id));
  for (let position = 0; position < value.diagnostics.length; position += 1) {
    const item = value.diagnostics[position];
    assertExactFields(
      item,
      DIAGNOSTIC_FIELDS,
      `debugReport.diagnostics[${position}]`,
    );
    if (
      typeof item.code !== 'string'
      || !/^[a-z][a-z0-9_-]{1,119}$/u.test(item.code)
    ) {
      throw new Error('diagnostic.code is invalid');
    }
    if (!['info', 'warning', 'blocking'].includes(item.severity)) {
      throw new Error('diagnostic severity is invalid');
    }
    const expectedSeverity = DIAGNOSTIC_SEVERITY.get(item.code);
    if (!expectedSeverity) {
      throw new Error(`diagnostic code is not approved: ${item.code}`);
    }
    if (item.severity !== expectedSeverity) {
      throw new Error(
        `debug diagnostic ${item.code} severity must be ${expectedSeverity}`,
      );
    }
    if (
      item.affectedSample !== null
      && item.affectedSample !== 'global'
      && !sampleIds.has(item.affectedSample)
    ) {
      throw new Error('diagnostic.affectedSample references unknown sample');
    }
    if (item.affectedSample !== null) {
      requireSafeId(item.affectedSample, 'diagnostic.affectedSample');
    }
    requiredText(item.explanation, 'diagnostic.explanation', 1_000);
    requiredText(item.recoveryAction, 'diagnostic.recoveryAction', 1_000);
    if (item.severity === 'blocking') hasBlocking = true;
    if (item.severity === 'warning') hasWarning = true;
  }
  if (hasBlocking && value.status !== 'blocked') {
    throw new Error('debug report with blocking diagnostic must be blocked');
  }
  if (!hasBlocking && value.status === 'blocked') {
    throw new Error('blocked debug report requires blocking diagnostic');
  }
  if (hasWarning && value.status === 'passed') {
    throw new Error('warning diagnostic cannot report passed status');
  }
  const stale = candidate.evidence.some((item) => (
    (Date.parse(referenceAt) - Date.parse(item.observedAt)) / 86_400_000
      > MAX_SOURCE_AGE_DAYS
  ));
  const hasStaleDiagnostic = value.diagnostics.some(
    (item) => item.code === 'stale_source' && item.severity === 'warning',
  );
  if (stale && !hasStaleDiagnostic) {
    throw new Error(
      'stale_source warning requiring action must be present for stale evidence',
    );
  }
  if (!stale && hasStaleDiagnostic) {
    throw new Error('stale_source diagnostic does not match current evidence');
  }
  if (stale && value.status === 'passed') {
    throw new Error('stale_source warning cannot report passed status');
  }
  validateTextArray(
    value.remainingUnknowns,
    'debugReport.remainingUnknowns',
    value.status === 'passed' && !hasWarning ? 0 : 1,
  );
}

function validateKnowledgeReceiptSemantics(document, roots) {
  if (document.status === 'no_hit') {
    if (document.sources.length !== 0 || document.limitations.length === 0) {
      throw new Error(
        'no_hit knowledge receipt requires empty sources and limitations',
      );
    }
    return;
  }
  if (document.status === 'degraded' && document.limitations.length === 0) {
    throw new Error('degraded knowledge receipt requires limitations');
  }
  if (document.status === 'matched' && document.sources.length === 0) {
    throw new Error('matched knowledge receipt requires a real matching source');
  }
  if (document.sources.length === 0) return;
  const allowedRoot = path.resolve(
    roots.runRoot,
    'evidence',
    'knowledge-sources',
  );
  let realAllowedRoot;
  try {
    realAllowedRoot = realpathSync(allowedRoot);
  } catch {
    throw new Error('knowledge matching source root is missing');
  }
  for (let index = 0; index < document.sources.length; index += 1) {
    const source = document.sources[index];
    const sourcePath = resolveTrustedRelativePath({
      roots,
      relativePath: source.relativePath,
      allowedRoot,
      realAllowedRoot,
      label: `knowledge matching source[${index}]`,
    });
    verifyRegularFileSha(
      sourcePath,
      source.sha256,
      `knowledge matching source[${index}]`,
    );
  }
}

function validateKnowledgeReceiptSources(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(
      'knowledge receipt sources must be a bounded array of source objects',
    );
  }
  const paths = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const source = value[index];
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(
        `knowledge receipt source[${index}] must be a plain data object`,
      );
    }
    assertExactFields(
      source,
      ['relativePath', 'sha256'],
      `knowledge receipt source[${index}]`,
    );
    requiredText(
      source.relativePath,
      `knowledge receipt source[${index}].relativePath`,
      1_000,
    );
    requireSha(
      source.sha256,
      `knowledge receipt source[${index}].sha256`,
    );
    if (paths.has(source.relativePath)) {
      throw new Error('knowledge receipt source paths must be unique');
    }
    paths.add(source.relativePath);
  }
}

function auditCandidateBusinessText(candidate) {
  const audit = (text, context, location) => {
    const result = classifyPrivatePerformanceText(text, { context });
    if (result.prohibitedAssertion) {
      throw new Error(`private performance text audit failed at ${location}`);
    }
  };
  const auditArray = (items, context, location) => {
    items.forEach((item, index) => audit(item, context, `${location}[${index}]`));
  };
  audit(candidate.scope.objective, 'inference', 'scope.objective');
  audit(candidate.scope.productOrService, 'inference', 'scope.productOrService');
  auditArray(candidate.scope.constraints, 'inference', 'scope.constraints');
  candidate.evidence.forEach((item, index) => {
    audit(item.claim, item.type, `evidence[${index}].claim`);
  });
  candidate.samples.forEach((sample, sampleIndex) => {
    audit(sample.selectionReason, 'inference', `samples[${sampleIndex}].selectionReason`);
    for (const layerId of LAYER_IDS) {
      const layer = sample.layers[layerId];
      auditArray(layer.publicFacts, 'public_fact', `samples[${sampleIndex}].layers.${layerId}.publicFacts`);
      auditArray(layer.inferences, 'inference', `samples[${sampleIndex}].layers.${layerId}.inferences`);
      auditArray(layer.unknowns, 'unknown', `samples[${sampleIndex}].layers.${layerId}.unknowns`);
    }
    auditArray(
      sample.privateUnknowns,
      'private_unknown',
      `samples[${sampleIndex}].privateUnknowns`,
    );
  });
  candidate.transfers.forEach((transfer, index) => {
    for (const field of [
      'surfaceAction',
      'underlyingMechanism',
      'enterpriseFit',
      'originalImplementation',
    ]) {
      audit(transfer[field], 'inference', `transfers[${index}].${field}`);
    }
    auditArray(transfer.doNotCopy, 'label', `transfers[${index}].doNotCopy`);
    const experiment = transfer.experiment;
    audit(experiment.hypothesis, 'hypothesis', `transfers[${index}].experiment.hypothesis`);
    for (const field of ['experimentObject', 'control', 'sample', 'maximumCost', 'dataCollectionMethod']) {
      audit(experiment[field], 'inference', `transfers[${index}].experiment.${field}`);
    }
    audit(experiment.metric, 'label', `transfers[${index}].experiment.metric`);
    auditArray(experiment.secondaryMetrics, 'label', `transfers[${index}].experiment.secondaryMetrics`);
    auditArray(experiment.riskMetrics, 'label', `transfers[${index}].experiment.riskMetrics`);
    auditArray(experiment.stopConditions, 'operational', `transfers[${index}].experiment.stopConditions`);
  });
  candidate.collaborationRequests.forEach((request, index) => {
    audit(request.reason, 'inference', `collaborationRequests[${index}].reason`);
  });
  candidate.debugReport.diagnostics.forEach((item, index) => {
    audit(item.explanation, 'inference', `debugReport.diagnostics[${index}].explanation`);
    audit(item.recoveryAction, 'operational', `debugReport.diagnostics[${index}].recoveryAction`);
  });
  auditArray(
    candidate.debugReport.remainingUnknowns,
    'unknown',
    'debugReport.remainingUnknowns',
  );
  auditArray(candidate.review.baselineMetrics, 'inference', 'review.baselineMetrics');
  auditArray(candidate.review.decisionRules, 'operational', 'review.decisionRules');
}

function validateEvidenceRefs(
  value,
  evidenceIndex,
  label,
  minimum = 1,
) {
  requireDenseArray(value, label, minimum, 100);
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} must contain unique references`);
  }
  return value.map((reference) => {
    if (!evidenceIndex.has(reference)) {
      throw new Error(`${label} contains unknown evidence: ${reference}`);
    }
    return evidenceIndex.get(reference);
  });
}

function validatePrivateBucket(values, context, label) {
  for (let index = 0; index < values.length; index += 1) {
    const classified = classifyPrivatePerformanceText(values[index], {
      context,
    });
    if (classified.prohibitedAssertion) {
      throw new Error(
        `private performance claim must remain explicitly unknown at ${label}[${index}]`,
      );
    }
  }
}

function parseStrictJson(bytes, label) {
  const source = bytes.toString('utf8');
  assertNoDuplicateJsonKeys(source, label);
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} must contain valid JSON`, { cause: error });
  }
  assertPlainData(value, `${label} document`, {
    maxDepth: 16,
    maxNodes: 2_000,
    maxArrayLength: 200,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} JSON must be an object`);
  }
  return value;
}

function resolveTrustedRelativePath({
  roots,
  relativePath,
  allowedRoot,
  realAllowedRoot,
  label,
}) {
  if (
    typeof relativePath !== 'string'
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`${label} path is absolute or escapes projectRoot`);
  }
  const target = path.resolve(roots.projectRoot, relativePath);
  assertInside(allowedRoot, target, label);
  assertSafePathChain(roots.projectRoot, target, label);
  const physical = realpathSync(target);
  assertInside(realAllowedRoot, physical, `real ${label}`);
  return target;
}

function verifyRegularFileSha(filePath, expectedSha, label) {
  let details;
  try {
    details = lstatSync(filePath);
  } catch {
    throw new Error(`${label} is missing or cannot be read`);
  }
  if (
    !details.isFile()
    || details.isSymbolicLink()
    || details.size > MAX_FILE_BYTES
  ) {
    throw new Error(`${label} must be a bounded regular non-link file`);
  }
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(filePath, flags);
  let bytes;
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile()
      || (details.ino && opened.ino && details.ino !== opened.ino)
      || (details.dev && opened.dev && details.dev !== opened.dev)
    ) {
      throw new Error(`${label} changed during secure read`);
    }
    bytes = readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha) {
    throw new Error(`${label} SHA-256 does not match`);
  }
  return bytes;
}

function assertSafeDirectory(directory, label) {
  let details;
  try {
    details = lstatSync(directory);
  } catch {
    throw new Error(`${label} is missing or cannot be read`);
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a safe directory without links`);
  }
}

function assertSafePathChain(root, target, label) {
  assertInside(root, target, label);
  const relative = path.relative(root, target);
  let current = root;
  const parts = relative ? relative.split(path.sep) : [];
  for (const part of parts) {
    current = path.join(current, part);
    let details;
    try {
      details = lstatSync(current);
    } catch {
      throw new Error(`${label} is missing or cannot be read`);
    }
    if (details.isSymbolicLink()) {
      throw new Error(`${label} contains a symlink, junction or reparse point`);
    }
  }
}

function assertInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${label} is outside its trusted root`);
  }
}

function requireDenseArray(value, label, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(
      `${label} must be a dense array with ${minimum}-${maximum} items`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be a dense array`);
    }
  }
}

function requireSha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
}

function normalizeText(value) {
  return value
    .trim()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}
