import { types as utilTypes } from 'node:util';

import {
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';
import {
  EXTERNAL_ACTIONS,
} from './growth_experiment_manager.mjs';
import {
  isTrustedGrowthRunStore,
} from './growth_run_store.mjs';

export { EXTERNAL_ACTIONS };

const GATE_OPTION_FIELDS = Object.freeze(['runStore']);
const AUTHORIZATION_REQUEST_FIELDS = Object.freeze([
  'enterpriseId',
  'businessProjectId',
  'runId',
  'action',
  'approvalId',
]);
const TRUSTED_GROWTH_APPROVAL_GATES = new WeakSet();
const REFLECT_APPLY = Reflect.apply;
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_HAS = WeakSet.prototype.has;

export function createGrowthApprovalGate(options) {
  const fields = exactDataProperties(
    options,
    GATE_OPTION_FIELDS,
    'growth approval gate options',
  );
  if (!isTrustedGrowthRunStore(fields.runStore)) {
    throw new TypeError(
      'growth approval gate requires a trusted branded run store',
    );
  }
  const consumeDescriptor = Object.getOwnPropertyDescriptor(
    fields.runStore,
    'consumeExternalApproval',
  );
  if (
    !consumeDescriptor
    || !Object.hasOwn(consumeDescriptor, 'value')
    || typeof consumeDescriptor.value !== 'function'
  ) {
    throw new TypeError(
      'trusted growth run store consume capability is unavailable',
    );
  }
  const consumeExternalApproval = consumeDescriptor.value;

  const authorizeExternalAction = async (input) => {
    const request = normalizeAuthorizationRequest(input);
    return consumeExternalApproval({
      enterpriseId: request.enterpriseId,
      businessProjectId: request.businessProjectId,
      runId: request.runId,
    }, {
      action: request.action,
      approvalId: request.approvalId,
    });
  };

  const gate = Object.freeze({ authorizeExternalAction });
  REFLECT_APPLY(
    WEAK_SET_ADD,
    TRUSTED_GROWTH_APPROVAL_GATES,
    [gate],
  );
  return gate;
}

export async function assertExternalActionAllowed(gate, input) {
  if (!isTrustedGrowthApprovalGate(gate)) {
    throw new TypeError(
      'assertExternalActionAllowed requires a trusted approval gate',
    );
  }
  return gate.authorizeExternalAction(input);
}

function isTrustedGrowthApprovalGate(value) {
  if (!value || typeof value !== 'object') return false;
  return REFLECT_APPLY(
    WEAK_SET_HAS,
    TRUSTED_GROWTH_APPROVAL_GATES,
    [value],
  );
}

function normalizeAuthorizationRequest(value) {
  const fields = exactDataProperties(
    value,
    AUTHORIZATION_REQUEST_FIELDS,
    'growth external authorization request',
  );
  return Object.freeze({
    enterpriseId: requireEnterpriseId(fields.enterpriseId),
    businessProjectId: requireBusinessProjectId(
      fields.businessProjectId,
    ),
    runId: requireSafeId(fields.runId, 'runId'),
    action: requireExternalAction(fields.action),
    approvalId: requireSafeId(fields.approvalId, 'approvalId'),
  });
}

function requireExternalAction(value) {
  if (typeof value !== 'string' || EXTERNAL_ACTIONS.has(value) !== true) {
    throw new Error('action is not a supported external action');
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

function assertOrdinaryObject(value, label) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function arrayContains(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}
