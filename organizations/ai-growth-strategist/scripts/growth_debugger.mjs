import { types as utilTypes } from 'node:util';

import {
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';

const CLASSIFICATION_FIELDS = Object.freeze(['code']);
const DECISION_FIELDS = Object.freeze([
  'code',
  'message',
  'rootCauseId',
  'rootCauseOccurrences',
  'timeline',
]);
const TIMELINE_EVENT_FIELDS = Object.freeze([
  'sequence',
  'from',
  'to',
  'at',
]);
const MAXIMUM_TIMELINE_EVENTS = 10_000;

export const FAILURE_POLICIES = Object.freeze({
  input_missing: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
  evidence_invalid: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
  evidence_conflict: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
  planning_dependency_failed: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
  tool_timeout: Object.freeze({
    retryable: true,
    maximumAttempts: 2,
  }),
  tool_schema_changed: Object.freeze({
    retryable: true,
    maximumAttempts: 2,
  }),
  contract_failed: Object.freeze({
    retryable: true,
    maximumAttempts: 3,
  }),
  boundary_violation: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
  metric_anomaly: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
  experiment_contaminated: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
  cost_limit_reached: Object.freeze({
    retryable: false,
    maximumAttempts: 0,
  }),
});

export function classifyGrowthFailure(input) {
  const fields = exactDataProperties(
    input,
    CLASSIFICATION_FIELDS,
    'growth failure classification',
  );
  const category = categoryForCode(fields.code);
  const policy = FAILURE_POLICIES[category];
  return Object.freeze({
    category,
    retryable: policy.retryable,
    maximumAttempts: policy.maximumAttempts,
  });
}

export function createGrowthFailureDecision(input) {
  const fields = exactDataProperties(
    input,
    DECISION_FIELDS,
    'growth failure decision',
  );
  const classification = classifyGrowthFailure({ code: fields.code });
  const message = requireMessage(fields.message);
  const rootCauseId = requireSafeId(
    fields.rootCauseId,
    'rootCauseId',
  );
  const rootCauseOccurrences = requirePositiveSafeInteger(
    fields.rootCauseOccurrences,
    'rootCauseOccurrences',
  );
  const timeline = copyTimeline(fields.timeline);
  const nextState = chooseNextState(
    classification,
    rootCauseOccurrences,
  );

  return Object.freeze({
    schemaVersion: 1,
    category: classification.category,
    retryable: classification.retryable,
    maximumAttempts: classification.maximumAttempts,
    nextState,
    lastError: Object.freeze({
      code: fields.code,
      message,
      rootCauseId,
      rootCauseOccurrences,
    }),
    timeline: Object.freeze(timeline),
  });
}

function categoryForCode(code) {
  if (typeof code !== 'string') {
    throw new Error('growth failure code is unsupported');
  }
  switch (code) {
    case 'input_missing':
    case 'INPUT_MISSING':
      return 'input_missing';
    case 'evidence_invalid':
    case 'EVIDENCE_INVALID':
      return 'evidence_invalid';
    case 'evidence_conflict':
    case 'EVIDENCE_CONFLICT':
      return 'evidence_conflict';
    case 'planning_dependency_failed':
    case 'PLANNING_DEPENDENCY_FAILED':
      return 'planning_dependency_failed';
    case 'tool_timeout':
    case 'TOOL_TIMEOUT':
    case 'ETIMEDOUT':
    case 'TIMEOUT':
      return 'tool_timeout';
    case 'tool_schema_changed':
    case 'TOOL_SCHEMA_CHANGED':
      return 'tool_schema_changed';
    case 'contract_failed':
    case 'CONTRACT_FAILED':
      return 'contract_failed';
    case 'boundary_violation':
    case 'BOUNDARY_VIOLATION':
      return 'boundary_violation';
    case 'metric_anomaly':
    case 'METRIC_ANOMALY':
      return 'metric_anomaly';
    case 'experiment_contaminated':
    case 'EXPERIMENT_CONTAMINATED':
      return 'experiment_contaminated';
    case 'cost_limit_reached':
    case 'COST_LIMIT_REACHED':
      return 'cost_limit_reached';
    default:
      throw new Error('growth failure code is unsupported');
  }
}

function chooseNextState(classification, rootCauseOccurrences) {
  if (rootCauseOccurrences >= 3) return 'failed';
  if (
    classification.retryable
    && rootCauseOccurrences <= classification.maximumAttempts
  ) {
    return 'retrying';
  }
  switch (classification.category) {
    case 'input_missing':
      return 'missing_input';
    case 'evidence_invalid':
    case 'evidence_conflict':
      return 'evidence_conflict';
    case 'boundary_violation':
      return 'boundary_blocked';
    case 'cost_limit_reached':
      return 'cost_stopped';
    case 'metric_anomaly':
    case 'experiment_contaminated':
      return 'paused';
    case 'planning_dependency_failed':
      return 'failed';
    default:
      return 'failed';
  }
}

function copyTimeline(value) {
  const length = requireDenseStandardArray(
    value,
    'growth failure timeline',
    MAXIMUM_TIMELINE_EVENTS,
  );
  if (length === 0) {
    throw new Error('growth failure timeline must be non-empty');
  }

  const result = new Array(length);
  let previousEvent = null;
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(
        `growth failure timeline[${index}] must be an own data property`,
      );
    }
    const event = normalizeTimelineEvent(
      descriptor.value,
      index,
      previousEvent,
    );
    result[index] = event;
    previousEvent = event;
  }
  return result;
}

function normalizeTimelineEvent(value, index, previousEvent) {
  const fields = exactDataProperties(
    value,
    TIMELINE_EVENT_FIELDS,
    `growth failure timeline event ${index + 1}`,
  );
  const expectedSequence = index + 1;
  if (
    !Number.isSafeInteger(fields.sequence)
    || fields.sequence !== expectedSequence
  ) {
    throw new Error(
      `growth failure timeline sequence must be continuous from 1: expected ${expectedSequence}`,
    );
  }
  if (fields.from !== null && !isRunState(fields.from)) {
    throw new Error('growth failure timeline from state is invalid');
  }
  if (!isRunState(fields.to)) {
    throw new Error('growth failure timeline to state is invalid');
  }
  const at = requireCanonicalIsoTimestamp(
    fields.at,
    'growth failure timeline at',
  );

  if (index === 0) {
    if (fields.from !== null || fields.to !== 'intake') {
      throw new Error(
        'growth failure timeline first event must be null -> intake',
      );
    }
  } else {
    if (fields.from === null || fields.from !== previousEvent.to) {
      throw new Error(
        'growth failure timeline event from state breaks the chain',
      );
    }
    if (!isRunTransition(fields.from, fields.to)) {
      throw new Error(
        `growth failure timeline transition is invalid: ${fields.from} -> ${fields.to}`,
      );
    }
    if (Date.parse(at) < Date.parse(previousEvent.at)) {
      throw new Error(
        'growth failure timeline event time must be non-decreasing',
      );
    }
  }

  return Object.freeze({
    sequence: fields.sequence,
    from: fields.from,
    to: fields.to,
    at,
  });
}

function isRunState(value) {
  switch (value) {
    case 'intake':
    case 'planning':
    case 'ready':
    case 'running_internal':
    case 'awaiting_approval':
    case 'running_approved':
    case 'reviewing':
    case 'completed':
    case 'retrying':
    case 'missing_input':
    case 'evidence_conflict':
    case 'boundary_blocked':
    case 'cost_stopped':
    case 'paused':
    case 'failed':
      return true;
    default:
      return false;
  }
}

function isRunTransition(from, to) {
  switch (from) {
    case 'intake':
      return to === 'planning' || to === 'missing_input' || to === 'failed';
    case 'planning':
      return (
        to === 'ready'
        || to === 'missing_input'
        || to === 'evidence_conflict'
        || to === 'failed'
      );
    case 'ready':
      return to === 'running_internal' || to === 'paused';
    case 'running_internal':
      return (
        to === 'awaiting_approval'
        || to === 'reviewing'
        || to === 'retrying'
        || to === 'boundary_blocked'
      );
    case 'awaiting_approval':
      return (
        to === 'running_approved'
        || to === 'paused'
        || to === 'boundary_blocked'
      );
    case 'running_approved':
      return (
        to === 'reviewing'
        || to === 'retrying'
        || to === 'cost_stopped'
      );
    case 'reviewing':
      return to === 'completed' || to === 'planning' || to === 'failed';
    case 'retrying':
      return (
        to === 'running_internal'
        || to === 'running_approved'
        || to === 'failed'
      );
    default:
      return false;
  }
}

function requireMessage(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('growth failure message is required');
  }
  if (value.length > 4_000) {
    throw new Error('growth failure message exceeds size limit of 4000');
  }
  return value;
}

function requirePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
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

function exactDataProperties(value, expectedFields, label) {
  assertOrdinaryObject(value, label);
  const ownKeys = Reflect.ownKeys(value);
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== 'string' || !arrayContains(expectedFields, key)) {
      throw new Error(`${label} has unexpected field: ${String(key)}`);
    }
  }

  const result = Object.create(null);
  for (let index = 0; index < expectedFields.length; index += 1) {
    const field = expectedFields[index];
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

function requireDenseStandardArray(value, label, maximumLength) {
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
  const ownKeys = Reflect.ownKeys(value);
  for (let position = 0; position < ownKeys.length; position += 1) {
    const key = ownKeys[position];
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
  return length;
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

function assertNotProxy(value, label) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
}

function arrayContains(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}
