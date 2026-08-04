import { types as utilTypes } from 'node:util';

import {
  deepFreeze,
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';

const RUN_FIELDS = new Set([
  'schemaVersion',
  'enterpriseId',
  'businessProjectId',
  'taskId',
  'runId',
  'capabilityId',
  'state',
  'sequence',
  'createdAt',
  'updatedAt',
]);
const STEP_FIELDS = new Set([
  'stepId',
  'dependsOn',
  'maximumAttempts',
  'timeoutMs',
  'requiresApproval',
]);
const PLAN_FIELDS = new Set([
  'schemaVersion',
  'runId',
  'capabilityId',
  'steps',
  'executionOrder',
]);
const IDENTITY_FIELDS = new Set([
  'enterpriseId',
  'businessProjectId',
  'runId',
]);

export const RUN_STATES = Object.freeze({
  normal: Object.freeze([
    'intake',
    'planning',
    'ready',
    'running_internal',
    'awaiting_approval',
    'running_approved',
    'reviewing',
    'completed',
  ]),
  exceptional: Object.freeze([
    'retrying',
    'missing_input',
    'evidence_conflict',
    'boundary_blocked',
    'cost_stopped',
    'paused',
    'failed',
  ]),
});

const ALL_RUN_STATES = new Set([
  ...RUN_STATES.normal,
  ...RUN_STATES.exceptional,
]);
const TRANSITIONS = new Map([
  ['intake', new Set(['planning', 'missing_input', 'failed'])],
  [
    'planning',
    new Set(['ready', 'missing_input', 'evidence_conflict', 'failed']),
  ],
  ['ready', new Set(['running_internal', 'paused'])],
  [
    'running_internal',
    new Set(['awaiting_approval', 'reviewing', 'retrying', 'boundary_blocked']),
  ],
  [
    'awaiting_approval',
    new Set(['running_approved', 'paused', 'boundary_blocked']),
  ],
  [
    'running_approved',
    new Set(['reviewing', 'retrying', 'cost_stopped']),
  ],
  ['reviewing', new Set(['completed', 'planning', 'failed'])],
  ['retrying', new Set(['running_internal', 'running_approved', 'failed'])],
]);

export function canTransition(from, to) {
  return TRANSITIONS.get(from)?.has(to) === true;
}

export function validateGrowthRun(value, expectedIdentity) {
  assertPlainObject(value, 'growth run');
  assertExactFields(value, RUN_FIELDS, 'growth run');
  if (value.schemaVersion !== 1) {
    throw new Error('growth run schemaVersion must be 1');
  }

  const enterpriseId = requireEnterpriseId(value.enterpriseId);
  const businessProjectId = requireBusinessProjectId(value.businessProjectId);
  const taskId = requireSafeId(value.taskId, 'taskId');
  const runId = requireSafeId(value.runId, 'runId');
  const capabilityId = requireSafeId(value.capabilityId, 'capabilityId');
  const state = value.state;
  const sequence = value.sequence;
  if (!ALL_RUN_STATES.has(state)) {
    throw new Error('growth run state is invalid');
  }
  requirePositiveSafeInteger(sequence, 'sequence');
  const createdAt = requireIsoTimestamp(value.createdAt, 'createdAt');
  const updatedAt = requireIsoTimestamp(value.updatedAt, 'updatedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error('updatedAt cannot be earlier than createdAt');
  }
  const identity = {
    enterpriseId,
    businessProjectId,
    runId,
  };

  if (expectedIdentity !== undefined) {
    assertPlainObject(expectedIdentity, 'expected identity');
    assertAllowedFields(expectedIdentity, IDENTITY_FIELDS, 'expected identity');
    for (const field of IDENTITY_FIELDS) {
      if (!Object.hasOwn(expectedIdentity, field)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(expectedIdentity, field);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(
          `expected identity.${field} must be an own data property, not an accessor`,
        );
      }
      if (descriptor.value !== identity[field]) {
        throw new Error(`growth run identity mismatch: ${field}`);
      }
    }
  }

  return deepFreeze({
    schemaVersion: 1,
    enterpriseId,
    businessProjectId,
    taskId,
    runId,
    capabilityId,
    state,
    sequence,
    createdAt,
    updatedAt,
  });
}

export function validateStep(value) {
  assertPlainObject(value, 'growth step');
  assertExactFields(value, STEP_FIELDS, 'growth step');

  const stepId = requireSafeId(value.stepId, 'stepId');
  const dependsOn = copyDenseArray(
    value.dependsOn,
    'dependsOn',
    (dependency) => requireSafeId(dependency, 'dependsOn'),
  );
  if (new Set(dependsOn).size !== dependsOn.length) {
    throw new Error('dependsOn must not contain duplicates');
  }
  if (dependsOn.includes(stepId)) {
    throw new Error('dependsOn cannot contain its own stepId');
  }
  const maximumAttempts = value.maximumAttempts;
  const timeoutMs = value.timeoutMs;
  const requiresApproval = value.requiresApproval;
  requireIntegerInRange(maximumAttempts, 1, 3, 'maximumAttempts');
  requireIntegerInRange(timeoutMs, 1, 900_000, 'timeoutMs');
  if (typeof requiresApproval !== 'boolean') {
    throw new TypeError('requiresApproval must be a boolean');
  }

  return deepFreeze({
    stepId,
    dependsOn,
    maximumAttempts,
    timeoutMs,
    requiresApproval,
  });
}

export function validateGrowthPlan(value) {
  assertPlainObject(value, 'growth plan');
  assertExactFields(value, PLAN_FIELDS, 'growth plan');
  if (value.schemaVersion !== 1) {
    throw new Error('growth plan schemaVersion must be 1');
  }

  const runId = requireSafeId(value.runId, 'runId');
  const capabilityId = requireSafeId(value.capabilityId, 'capabilityId');
  const steps = copyDenseArray(
    value.steps,
    'growth plan steps',
    (item) => validateStep(item),
  );
  if (steps.length === 0) {
    throw new Error('growth plan steps must be a non-empty array');
  }
  const stepIds = [];
  for (let index = 0; index < steps.length; index += 1) {
    stepIds.push(steps[index].stepId);
  }
  if (new Set(stepIds).size !== stepIds.length) {
    throw new Error('growth plan stepId values must be unique');
  }
  const stepIdSet = new Set(stepIds);

  const executionOrder = copyDenseArray(
    value.executionOrder,
    'executionOrder',
    (item) => requireSafeId(item, 'executionOrder'),
  );
  if (new Set(executionOrder).size !== executionOrder.length) {
    throw new Error('executionOrder must not contain duplicates');
  }
  if (executionOrder.length !== stepIds.length) {
    throw new Error('executionOrder must exactly match all growth plan steps');
  }
  for (let index = 0; index < executionOrder.length; index += 1) {
    if (!stepIdSet.has(executionOrder[index])) {
      throw new Error('executionOrder must exactly match all growth plan steps');
    }
  }
  const orderIndex = new Map(
    executionOrder.map((stepId, index) => [stepId, index]),
  );
  for (const item of steps) {
    for (const dependency of item.dependsOn) {
      if (!stepIdSet.has(dependency)) {
        throw new Error(`growth plan dependency is unknown: ${dependency}`);
      }
      if (orderIndex.get(dependency) >= orderIndex.get(item.stepId)) {
        throw new Error(
          `growth plan dependency must appear before its step: ${dependency}`,
        );
      }
    }
  }

  return deepFreeze({
    schemaVersion: 1,
    runId,
    capabilityId,
    steps,
    executionOrder,
  });
}

function assertPlainObject(value, label) {
  assertNotProxy(value, label);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function assertExactFields(value, expected, label) {
  assertAllowedFields(value, expected, label);
  for (const field of expected) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing required field: ${field}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}.${field} must be an own data property, not an accessor`);
    }
  }
}

function assertAllowedFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`${label} has unexpected field: ${field}`);
    }
  }
}

function requirePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireIntegerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function copyDenseArray(value, label, validateItem) {
  assertNotProxy(value, label);
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must use the standard Array prototype`);
  }

  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be dense and cannot contain sparse holes`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}[${index}] must be an own data property`);
    }
    assertNotProxy(descriptor.value, `${label}[${index}]`);
    result.push(validateItem(descriptor.value, index));
  }
  return result;
}

function assertNotProxy(value, label) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
}
