import { types as utilTypes } from 'node:util';

import {
  deepFreeze,
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';

const CREATE_FIELDS = Object.freeze([
  'enterpriseId',
  'businessProjectId',
  'runId',
  'items',
]);
const PERSISTED_FIELDS = Object.freeze([
  'schemaVersion',
  'revision',
  ...CREATE_FIELDS,
]);
const IDENTITY_FIELDS = Object.freeze([
  'enterpriseId',
  'businessProjectId',
  'runId',
]);
const ITEM_FIELDS = Object.freeze([
  'id',
  'type',
  'claim',
  'sourceReference',
  'sourceVersion',
  'sourceSha256',
  'observedAt',
  'appliesTo',
  'confidence',
  'conflictReferences',
]);
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_CONFLICT_REFERENCES = 100_000;

export function createGrowthEvidenceLedger(input, expectedIdentity = undefined) {
  const inputFields = ledgerDataProperties(input);
  if (
    Object.hasOwn(inputFields, 'schemaVersion')
    && inputFields.schemaVersion !== 1
  ) {
    throw new Error('growth evidence ledger schemaVersion must be 1');
  }
  const revision = Object.hasOwn(inputFields, 'revision')
    ? requirePositiveSafeInteger(
      inputFields.revision,
      'growth evidence ledger revision',
    )
    : 1;

  const enterpriseId = requireEnterpriseId(inputFields.enterpriseId);
  const businessProjectId = requireBusinessProjectId(
    inputFields.businessProjectId,
  );
  const runId = requireSafeId(inputFields.runId, 'runId');
  const identity = Object.freeze({
    enterpriseId,
    businessProjectId,
    runId,
  });
  if (expectedIdentity !== undefined) {
    const expected = exactDataProperties(
      expectedIdentity,
      IDENTITY_FIELDS,
      'expected identity',
    );
    let normalizedExpected;
    try {
      normalizedExpected = {
        enterpriseId: requireEnterpriseId(expected.enterpriseId),
        businessProjectId: requireBusinessProjectId(expected.businessProjectId),
        runId: requireSafeId(expected.runId, 'expected identity.runId'),
      };
    } catch (error) {
      throw new Error(
        `growth evidence ledger expected identity is invalid: ${error.message}`,
        { cause: error },
      );
    }
    for (const field of IDENTITY_FIELDS) {
      if (normalizedExpected[field] !== identity[field]) {
        throw new Error(`growth evidence ledger identity mismatch: ${field}`);
      }
    }
  }

  let totalConflictReferences = 0;
  const items = copyDenseArray(
    inputFields.items,
    'growth evidence ledger items',
    10_000,
    (value, index) => {
      const item = normalizeEvidenceItem(value, index);
      totalConflictReferences += item.conflictReferences.length;
      if (totalConflictReferences > MAXIMUM_CONFLICT_REFERENCES) {
        throw new Error(
          `growth evidence conflict references exceed size limit of ${MAXIMUM_CONFLICT_REFERENCES}`,
        );
      }
      return item;
    },
  );
  const itemById = Object.create(null);
  const adjacency = Object.create(null);
  for (const item of items) {
    if (Object.hasOwn(itemById, item.id)) {
      throw new Error(`growth evidence id must be globally unique: ${item.id}`);
    }
    itemById[item.id] = item;
    const references = Object.create(null);
    for (let index = 0; index < item.conflictReferences.length; index += 1) {
      references[item.conflictReferences[index]] = true;
    }
    adjacency[item.id] = references;
  }
  validateConflictGraph(items, itemById, adjacency);

  return deepFreeze({
    schemaVersion: 1,
    revision,
    enterpriseId,
    businessProjectId,
    runId,
    items,
  });
}

function ledgerDataProperties(value) {
  assertOrdinaryObject(value, 'growth evidence ledger');
  const ownKeys = Reflect.ownKeys(value);
  const hasSchemaVersion = arrayContains(ownKeys, 'schemaVersion');
  const hasRevision = arrayContains(ownKeys, 'revision');
  return exactDataProperties(
    value,
    hasSchemaVersion || hasRevision ? PERSISTED_FIELDS : CREATE_FIELDS,
    'growth evidence ledger',
  );
}

function normalizeEvidenceItem(value, index) {
  const label = `growth evidence item ${index + 1}`;
  const fields = exactDataProperties(value, ITEM_FIELDS, label);
  const id = requireSafeId(fields.id, `${label}.id`);
  if (!isEvidenceType(fields.type)) {
    throw new Error(`${label}.type is invalid`);
  }
  const claim = requiredText(fields.claim, `${label}.claim`, 4_000);
  const sourceReference = requiredText(
    fields.sourceReference,
    `${label}.sourceReference`,
    1_000,
  );
  const sourceVersion = requiredText(
    fields.sourceVersion,
    `${label}.sourceVersion`,
    200,
  );
  if (
    typeof fields.sourceSha256 !== 'string'
    || !LOWERCASE_SHA256.test(fields.sourceSha256)
  ) {
    throw new Error(`${label}.sourceSha256 must be a lowercase 64-character sha256`);
  }
  const observedAt = requireCanonicalIsoTimestamp(
    fields.observedAt,
    `${label}.observedAt`,
  );
  const appliesTo = requiredText(
    fields.appliesTo,
    `${label}.appliesTo`,
    1_000,
  );
  if (!isConfidenceLevel(fields.confidence)) {
    throw new Error(`${label}.confidence must be A, B, C or D`);
  }
  const conflictReferences = copyDenseArray(
    fields.conflictReferences,
    `${label}.conflictReferences`,
    1_000,
    (reference, referenceIndex) => requireSafeId(
      reference,
      `${label}.conflictReferences[${referenceIndex}]`,
    ),
  );
  const uniqueReferences = Object.create(null);
  for (let index = 0; index < conflictReferences.length; index += 1) {
    const reference = conflictReferences[index];
    if (Object.hasOwn(uniqueReferences, reference)) {
      throw new Error(`${label}.conflictReferences must be unique`);
    }
    uniqueReferences[reference] = true;
  }
  if (arrayContains(conflictReferences, id)) {
    throw new Error(`${label}.conflictReferences cannot reference itself`);
  }

  return {
    id,
    type: fields.type,
    claim,
    sourceReference,
    sourceVersion,
    sourceSha256: fields.sourceSha256,
    observedAt,
    appliesTo,
    confidence: fields.confidence,
    conflictReferences,
  };
}

function validateConflictGraph(items, itemById, adjacency) {
  for (const item of items) {
    for (const reference of item.conflictReferences) {
      if (!Object.hasOwn(itemById, reference)) {
        throw new Error(
          `growth evidence conflict reference is unknown: ${reference}`,
        );
      }
      if (!Object.hasOwn(adjacency[reference], item.id)) {
        throw new Error(
          `growth evidence conflict must be symmetric: ${item.id} and ${reference}`,
        );
      }
    }
  }
}

function exactDataProperties(value, expectedFields, label) {
  assertOrdinaryObject(value, label);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !arrayContains(expectedFields, key)) {
      throw new Error(`${label} has unexpected field: ${String(key)}`);
    }
  }

  const result = Object.create(null);
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor) {
      throw new Error(`${label} is missing required field: ${field}`);
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new Error(
        `${label}.${field} must be an own data property, not an accessor`,
      );
    }
    result[field] = descriptor.value;
  }
  return result;
}

function isEvidenceType(value) {
  switch (value) {
    case 'enterprise_fact':
    case 'customer_quote':
    case 'behavior_data':
    case 'feishu_knowledge':
    case 'public_source':
    case 'professional_inference':
    case 'validation_hypothesis':
    case 'unknown':
      return true;
    default:
      return false;
  }
}

function isConfidenceLevel(value) {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D';
}

function requirePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function arrayContains(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function assertOrdinaryObject(value, label) {
  assertNotProxy(value, label);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function copyDenseArray(value, label, maximumLength, normalizeItem) {
  assertNotProxy(value, label);
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must use the standard Array prototype`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    !lengthDescriptor
    || !Object.hasOwn(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new Error(`${label}.length must be an own safe integer data property`);
  }
  const length = lengthDescriptor.value;
  if (length > maximumLength) {
    throw new Error(`${label} exceeds size limit of ${maximumLength}`);
  }

  let indexKeyCount = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    const index = typeof key === 'string' ? Number(key) : Number.NaN;
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || String(index) !== key
    ) {
      throw new Error(`${label} has unexpected property: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}[${index}] must be an own data property`);
    }
    indexKeyCount += 1;
  }
  if (indexKeyCount !== length) {
    throw new Error(`${label} must be dense and cannot contain sparse holes`);
  }

  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) {
      throw new Error(`${label} must be dense and cannot contain sparse holes`);
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}[${index}] must be an own data property`);
    }
    result.push(normalizeItem(descriptor.value, index));
  }
  return result;
}

function requiredText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new Error(`${label} exceeds size limit`);
  }
  return normalized;
}

function requireCanonicalIsoTimestamp(value, label) {
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function assertNotProxy(value, label) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
}
