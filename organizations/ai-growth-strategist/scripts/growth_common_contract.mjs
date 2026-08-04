import {
  assertPlainObject,
  deepFreeze,
} from './strict_json.mjs';
import { types as utilTypes } from 'node:util';

export const EVIDENCE_TYPES = new Set([
  'enterprise_fact',
  'customer_voice',
  'behavior_data',
  'public_source',
  'knowledge_source',
  'inference',
  'hypothesis',
  'unknown',
]);
export const FACT_TYPES = new Set([
  'enterprise_fact',
  'customer_voice',
  'behavior_data',
  'public_source',
  'knowledge_source',
]);
const PROHIBITED_CLAIMS = /(?:保证增长|保证成交|保证收益|100%成交|稳赚|必然翻倍|无风险赚钱|学完就能赚钱)/iu;

export function validateCandidateEnvelope(value, capabilityId) {
  assertPlainObject(value, 'growth candidate');
  if (value.schemaVersion !== 1
    || value.capabilityId !== capabilityId
    || value.status !== 'candidate') {
    throw new Error('candidate identity, version or status is invalid');
  }
  requiredId(value.enterpriseId, 'enterpriseId', 64);
  if (typeof value.taskId !== 'string'
    || !/^[0-9]{8}-[0-9]{3}-[a-z0-9-]{3,80}$/u.test(value.taskId)) {
    throw new Error('taskId is invalid');
  }
  assertPlainObject(value.knowledgeContext, 'knowledgeContext');
  if (!['matched', 'no_hit', 'degraded'].includes(value.knowledgeContext.status)) {
    throw new Error('knowledge context status is invalid');
  }
  requiredText(value.knowledgeContext.evidencePath, 'knowledge evidencePath', 1_000);
}

export function validateEvidence(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('candidate evidence is required');
  }
  const ids = new Set();
  const index = new Map();
  for (const [position, item] of value.entries()) {
    assertPlainObject(item, `evidence[${position}]`);
    assertExactFields(item, [
      'id',
      'type',
      'claim',
      'sourceReference',
      'observedAt',
      'appliesTo',
    ], `evidence[${position}]`);
    const id = requiredId(item.id, `evidence[${position}].id`, 120);
    if (ids.has(id)) throw new Error(`duplicate evidence id: ${id}`);
    ids.add(id);
    if (!EVIDENCE_TYPES.has(item.type)) {
      throw new Error(`evidence type is invalid: ${item.type}`);
    }
    requiredText(item.claim, `evidence[${position}].claim`, 2_000);
    requiredText(
      item.sourceReference,
      `evidence[${position}].sourceReference`,
      1_000,
    );
    requireIsoTimestamp(item.observedAt, `evidence[${position}].observedAt`);
    requiredText(item.appliesTo, `evidence[${position}].appliesTo`, 500);
    index.set(id, item);
  }
  return index;
}

export function assertEvidenceRefs({
  refs,
  evidenceIndex,
  minimum = 1,
  requireFact = false,
  label = 'evidenceRefs',
}) {
  if (!Array.isArray(refs) || utilTypes.isProxy(refs)) {
    throw new Error(`${label} must be a plain data array`);
  }
  if (refs.length > 100) {
    throw new Error(`${label} exceeds maximum size limit`);
  }
  for (let index = 0; index < refs.length; index += 1) {
    if (!Object.hasOwn(refs, index)) {
      throw new Error(`${label} must be a dense array`);
    }
  }
  if (refs.length < minimum || new Set(refs).size !== refs.length) {
    throw new Error(`${label} requires at least ${minimum} unique evidence references`);
  }
  const items = refs.map((ref) => {
    if (!evidenceIndex.has(ref)) throw new Error(`${label} contains unknown evidence: ${ref}`);
    return evidenceIndex.get(ref);
  });
  if (requireFact && !items.some((item) => FACT_TYPES.has(item.type))) {
    throw new Error(`${label} requires at least one fact evidence item`);
  }
  return items;
}

export function assertNoProhibitedClaims(value) {
  const visit = (current, location) => {
    if (typeof current === 'string' && PROHIBITED_CLAIMS.test(current)) {
      throw new Error(`prohibited guarantee or unsupported claim at ${location}`);
    }
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      if (key === 'forbiddenClaims') continue;
      visit(child, `${location}.${key}`);
    }
  };
  visit(value, 'candidate');
}

export function validateBoundaryChecks(value) {
  assertPlainObject(value, 'boundaryChecks');
  assertExactFields(value, [
    'changesEnterpriseStrategy',
    'changesBrandPositioning',
    'changesPricePolicy',
    'changesDealRules',
  ], 'boundaryChecks');
  for (const [key, state] of Object.entries(value)) {
    if (state !== false) throw new Error(`boundary change is forbidden: ${key}`);
  }
}

export function validateReview(value) {
  assertPlainObject(value, 'review');
  if (!Array.isArray(value.baselineMetrics) || value.baselineMetrics.length === 0) {
    throw new Error('review baselineMetrics are required');
  }
  value.baselineMetrics.forEach((item) => requiredText(item, 'baseline metric', 500));
  requireIsoTimestamp(value.reviewAt, 'reviewAt');
  if (!Array.isArray(value.decisionRules) || value.decisionRules.length < 2) {
    throw new Error('review decisionRules require success and stop logic');
  }
  value.decisionRules.forEach((item) => requiredText(item, 'decision rule', 500));
}

export function freezeCandidate(value) {
  return deepFreeze(structuredClone(value));
}

export function assertExactFields(value, fields, label) {
  assertPlainObject(value, label);
  const expected = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label} has unexpected field: ${key}`);
  }
  for (const field of expected) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing required field: ${field}`);
    }
  }
}

export function requiredText(value, label, maximum = 2_000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new Error(`${label} exceeds size limit`);
  return result;
}

export function requiredId(value, label, maximum = 120) {
  const result = requiredText(value, label, maximum);
  if (!/^[a-z0-9][a-z0-9-]{2,119}$/u.test(result)) {
    throw new Error(`${label} is invalid`);
  }
  return result;
}

export function requireIsoTimestamp(value, label) {
  if (typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

export function validateTextArray(value, label, minimum = 0) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must contain at least ${minimum} items`);
  }
  if (utilTypes.isProxy(value)) {
    throw new Error(`${label} must not be a Proxy array`);
  }
  if (value.length < minimum) {
    throw new Error(`${label} must contain at least ${minimum} items`);
  }
  if (value.length > 1_000) {
    throw new Error(`${label} exceeds maximum size limit`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be a dense array`);
    }
  }
  value.forEach((item) => requiredText(item, label, 1_000));
  return value;
}
