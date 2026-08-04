import { types as utilTypes } from 'node:util';

import {
  deepFreeze,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';

const EXTERNAL_ACTION_VALUES = Object.freeze([
  'publish_content',
  'paid_media',
  'contact_customer',
  'change_price',
  'change_refund_rule',
  'brand_commitment',
  'deal_commitment',
  'write_external_system',
]);
const DEFINITION_FIELDS = Object.freeze([
  'id',
  'hypothesis',
  'experimentObject',
  'control',
  'sample',
  'metric',
  'secondaryMetrics',
  'riskMetrics',
  'baseline',
  'target',
  'maximumDays',
  'maximumCost',
  'stopConditions',
  'dataCollectionMethod',
  'reviewAt',
  'externalActions',
]);
const NORMALIZED_DEFINITION_FIELDS = Object.freeze([
  ...DEFINITION_FIELDS,
  'requiresApproval',
]);
const EVALUATION_FIELDS = Object.freeze([
  'definition',
  'observedMetric',
  'stopTriggered',
]);
const SAFE_ACTION_ID = /^[a-z0-9][a-z0-9_-]{2,119}$/u;

export const EXTERNAL_ACTIONS = Object.freeze({
  size: EXTERNAL_ACTION_VALUES.length,
  has: isExternalAction,
  values: externalActionValues,
  [Symbol.iterator]: externalActionValues,
});

export function createGrowthExperiment(input) {
  return normalizeDefinition(input, false);
}

export function evaluateGrowthExperiment(input) {
  const fields = exactDataProperties(
    input,
    EVALUATION_FIELDS,
    'growth experiment evaluation',
  );
  const definition = normalizeDefinition(fields.definition, true);
  if (
    fields.observedMetric !== null
    && (
      typeof fields.observedMetric !== 'number'
      || !Number.isFinite(fields.observedMetric)
    )
  ) {
    throw new Error('observedMetric must be a finite number or null');
  }
  if (typeof fields.stopTriggered !== 'boolean') {
    throw new TypeError('stopTriggered must be a boolean');
  }

  if (fields.stopTriggered) {
    return Object.freeze({
      decision: 'stopped',
      reason: 'stop condition triggered',
    });
  }
  if (fields.observedMetric === null) {
    return Object.freeze({
      decision: 'inconclusive',
      reason: 'observed metric is missing',
    });
  }
  const success = definition.target > definition.baseline
    ? fields.observedMetric >= definition.target
    : fields.observedMetric <= definition.target;
  return Object.freeze({
    decision: success ? 'success' : 'failed',
  });
}

function normalizeDefinition(value, normalizedInput) {
  const fields = exactDataProperties(
    value,
    normalizedInput ? NORMALIZED_DEFINITION_FIELDS : DEFINITION_FIELDS,
    normalizedInput
      ? 'growth experiment definition'
      : 'growth experiment',
  );
  const id = requireSafeId(fields.id, 'growth experiment.id');
  const hypothesis = requiredText(
    fields.hypothesis,
    'growth experiment.hypothesis',
    4_000,
  );
  const experimentObject = requiredText(
    fields.experimentObject,
    'growth experiment.experimentObject',
    2_000,
  );
  const control = requiredText(
    fields.control,
    'growth experiment.control',
    2_000,
  );
  const sample = requiredText(
    fields.sample,
    'growth experiment.sample',
    2_000,
  );
  const metric = requiredText(
    fields.metric,
    'growth experiment.metric',
    500,
  );
  const secondaryMetrics = normalizeRequiredTextArray(
    fields.secondaryMetrics,
    'growth experiment secondaryMetrics',
    100,
  );
  const riskMetrics = normalizeRequiredTextArray(
    fields.riskMetrics,
    'growth experiment riskMetrics',
    100,
  );
  const baseline = requireFiniteNumber(
    fields.baseline,
    'growth experiment.baseline',
  );
  const target = requireFiniteNumber(
    fields.target,
    'growth experiment.target',
  );
  if (baseline === target) {
    throw new Error('growth experiment baseline and target must be different');
  }
  if (
    !Number.isInteger(fields.maximumDays)
    || fields.maximumDays < 1
    || fields.maximumDays > 365
  ) {
    throw new Error('growth experiment maximumDays must be an integer from 1 to 365');
  }
  const maximumCost = requiredText(
    fields.maximumCost,
    'growth experiment.maximumCost',
    1_000,
  );
  const stopConditions = copyDenseArray(
    fields.stopConditions,
    'growth experiment stopConditions',
    100,
    (condition, index) => requiredText(
      condition,
      `growth experiment stopConditions[${index}]`,
      1_000,
    ),
  );
  if (stopConditions.length === 0) {
    throw new Error('growth experiment stopConditions must be non-empty');
  }
  if (containsDuplicateStrings(stopConditions)) {
    throw new Error('growth experiment stopConditions must be unique');
  }
  const dataCollectionMethod = requiredText(
    fields.dataCollectionMethod,
    'growth experiment.dataCollectionMethod',
    2_000,
  );
  const reviewAt = requireCanonicalIsoTimestamp(
    fields.reviewAt,
    'growth experiment.reviewAt',
  );
  const externalActions = copyDenseArray(
    fields.externalActions,
    'growth experiment externalActions',
    32,
    (action, index) => {
      const label = `growth experiment externalActions[${index}]`;
      if (typeof action !== 'string' || !SAFE_ACTION_ID.test(action)) {
        throw new Error(`${label} is invalid or unsafe`);
      }
      const normalizedAction = action;
      if (
        !isExternalAction(normalizedAction)
        && !isInternalAction(normalizedAction)
      ) {
        throw new Error(
          `growth experiment externalActions contains unsupported action: ${normalizedAction}`,
        );
      }
      return normalizedAction;
    },
  );
  if (containsDuplicateStrings(externalActions)) {
    throw new Error('growth experiment externalActions must be unique');
  }
  let requiresApproval = false;
  for (let index = 0; index < externalActions.length; index += 1) {
    if (isExternalAction(externalActions[index])) {
      requiresApproval = true;
      break;
    }
  }
  if (
    normalizedInput
    && (
      typeof fields.requiresApproval !== 'boolean'
      || fields.requiresApproval !== requiresApproval
    )
  ) {
    throw new Error(
      'growth experiment definition requiresApproval does not match its actions',
    );
  }

  return deepFreeze({
    id,
    hypothesis,
    experimentObject,
    control,
    sample,
    metric,
    secondaryMetrics,
    riskMetrics,
    baseline,
    target,
    maximumDays: fields.maximumDays,
    maximumCost,
    stopConditions,
    dataCollectionMethod,
    reviewAt,
    externalActions,
    requiresApproval,
  });
}

function normalizeRequiredTextArray(value, label, maximumLength) {
  const items = copyDenseArray(
    value,
    label,
    maximumLength,
    (item, index) => requiredText(item, `${label}[${index}]`, 1_000),
  );
  if (items.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  if (containsDuplicateStrings(items)) {
    throw new Error(`${label} must be unique`);
  }
  return items;
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

function* externalActionValues() {
  for (let index = 0; index < EXTERNAL_ACTION_VALUES.length; index += 1) {
    yield EXTERNAL_ACTION_VALUES[index];
  }
}

function isExternalAction(value) {
  switch (value) {
    case 'publish_content':
    case 'paid_media':
    case 'contact_customer':
    case 'change_price':
    case 'change_refund_rule':
    case 'brand_commitment':
    case 'deal_commitment':
    case 'write_external_system':
      return true;
    default:
      return false;
  }
}

function isInternalAction(value) {
  switch (value) {
    case 'analyze_evidence':
    case 'analyze_internal_data':
    case 'draft_internal_content':
    case 'internal_analysis':
    case 'measure_internal_metric':
    case 'review_internal_result':
      return true;
    default:
      return false;
  }
}

function containsDuplicateStrings(values) {
  const seen = Object.create(null);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Object.hasOwn(seen, value)) return true;
    seen[value] = true;
  }
  return false;
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

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
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
