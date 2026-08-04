import {
  deepFreeze,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';
import { createGrowthPlan } from './growth_planner.mjs';
import { assertPlainData } from './strict_json.mjs';
import {
  classifyPrivatePerformanceText,
} from './competitive_benchmark_claim_classifier.mjs';

const SOURCE_STEP = Object.freeze({
  maximumAttempts: 2,
  timeoutMs: 15_000,
  requiresApproval: false,
});
const INTERNAL_STEP = Object.freeze({
  maximumAttempts: 1,
  timeoutMs: 1_000,
  requiresApproval: false,
});
const APPROVAL_STEP = Object.freeze({
  maximumAttempts: 1,
  timeoutMs: 1_000,
  requiresApproval: true,
});

export const BROWSER_RESEARCH_POLICY = Object.freeze({
  policyId: 'competitive-benchmark-read-only-research-v1',
  mode: 'read_only_research',
  continuousActionStandard:
    'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md',
  controller: 'scripts/browser_continuous_action_controller.mjs',
  timelineRequired: true,
  loginBypassAllowed: false,
  externalWriteAllowed: false,
});
const BROWSER_EXECUTION_FIELDS = Object.freeze([
  'stepId',
  'policyId',
  'used',
  'action',
  'externalWrite',
  'loginBypass',
  'timelinePath',
  'notes',
  'continuousActionStandard',
  'controller',
]);
const READ_ONLY_ACTIONS = new Set([
  'open_page',
  'read_page',
  'navigate',
  'find',
  'scroll',
  'extract_text',
  'screenshot',
]);

export function createCompetitiveBenchmarkPlan(input) {
  assertPlainData(input, 'competitive benchmark planner input', {
    maxDepth: 4,
    maxNodes: 10,
    maxArrayLength: 2,
  });
  const runId = readRunId(input);
  const plan = createGrowthPlan({
    runId,
    capabilityId: 'competitive-benchmark-analysis',
    steps: [
      step('intake', [], INTERNAL_STEP),
      step('sample-plan', ['intake'], INTERNAL_STEP),
      step('source-collection', ['sample-plan'], SOURCE_STEP),
      step('source-validation', ['source-collection'], SOURCE_STEP),
      step('positioning', ['source-validation'], INTERNAL_STEP),
      step('product-strategy', ['positioning'], INTERNAL_STEP),
      step('content-mechanism', ['product-strategy'], INTERNAL_STEP),
      step('acquisition-channels', ['content-mechanism'], INTERNAL_STEP),
      step(
        'observable-customer-path',
        ['acquisition-channels'],
        INTERNAL_STEP,
      ),
      step(
        'mechanism-transfer',
        ['observable-customer-path'],
        INTERNAL_STEP,
      ),
      step(
        'enterprise-adaptation',
        ['mechanism-transfer'],
        INTERNAL_STEP,
      ),
      step(
        'copy-brand-ip-check',
        ['enterprise-adaptation'],
        INTERNAL_STEP,
      ),
      step('experiments', ['copy-brand-ip-check'], INTERNAL_STEP),
      step('approval', ['experiments'], APPROVAL_STEP),
    ],
  });
  const binding = {
    policyId: BROWSER_RESEARCH_POLICY.policyId,
    controller: BROWSER_RESEARCH_POLICY.controller,
    continuousActionStandard:
      BROWSER_RESEARCH_POLICY.continuousActionStandard,
    timelineRequired: true,
  };
  return deepFreeze({
    ...plan,
    browserPolicyBindings: {
      'source-collection': binding,
      'source-validation': binding,
    },
  });
}

export function validateBrowserResearchExecution(value, trusted) {
  assertPlainData(value, 'browser research execution', {
    maxDepth: 3,
    maxNodes: 20,
    maxArrayLength: 0,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('browser research execution must be an object');
  }
  const identity = validateBrowserTrustedIdentity(trusted);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== BROWSER_EXECUTION_FIELDS.length
    || BROWSER_EXECUTION_FIELDS.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error('browser research execution fields are invalid');
  }
  if (!['source-collection', 'source-validation'].includes(value.stepId)) {
    throw new Error('browser research is limited to source steps');
  }
  if (
    value.policyId !== BROWSER_RESEARCH_POLICY.policyId
    || value.continuousActionStandard
      !== BROWSER_RESEARCH_POLICY.continuousActionStandard
    || value.controller !== BROWSER_RESEARCH_POLICY.controller
  ) {
    throw new Error('browser research policy or controller is invalid');
  }
  if (typeof value.used !== 'boolean') {
    throw new Error('browser research used marker must be boolean');
  }
  if (value.externalWrite !== false || value.loginBypass !== false) {
    throw new Error('browser research cannot bypass login');
  }
  if (typeof value.notes !== 'string' || !value.notes.trim()) {
    throw new Error('browser research notes are required');
  }
  const noteAudit = classifyPrivatePerformanceText(value.notes, {
    context: value.used ? 'inference' : 'unknown',
  });
  if (noteAudit.prohibitedAssertion) {
    throw new Error('browser research notes failed private performance audit');
  }
  if (!value.used) {
    if (value.action !== null || value.timelinePath !== null) {
      throw new Error('unused browser research cannot claim a timeline');
    }
    return deepFreeze({ ...value });
  }
  if (!READ_ONLY_ACTIONS.has(value.action)) {
    throw new Error('browser research must remain read-only without write actions');
  }
  const expectedTimeline = [
    'temp',
    'browser-research',
    identity.enterpriseId,
    identity.businessProjectId,
    identity.taskId,
    identity.runId,
    `${value.stepId}.json`,
  ].join('/');
  if (value.timelinePath !== expectedTimeline) {
    throw new Error('browser research timeline violates task identity boundary');
  }
  return deepFreeze({ ...value });
}

function validateBrowserTrustedIdentity(value) {
  assertPlainData(value, 'browser research trusted context', {
    maxDepth: 3,
    maxNodes: 10,
    maxArrayLength: 0,
  });
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Reflect.ownKeys(value).length !== 1
    || !Object.hasOwn(value, 'expectedIdentity')
  ) {
    throw new Error('browser research requires trusted expected identity');
  }
  const identity = value.expectedIdentity;
  const fields = ['enterpriseId', 'businessProjectId', 'taskId', 'runId'];
  if (
    !identity
    || typeof identity !== 'object'
    || Array.isArray(identity)
    || Reflect.ownKeys(identity).length !== fields.length
    || fields.some((field) => !Object.hasOwn(identity, field))
  ) {
    throw new Error('browser research expected identity is invalid');
  }
  for (const field of fields) {
    requireSafeId(identity[field], `browser research ${field}`);
  }
  return identity;
}

function readRunId(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('competitive benchmark planner input must be an object');
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 1
    || keys[0] !== 'runId'
    || !Object.hasOwn(input, 'runId')
  ) {
    throw new Error(
      `competitive benchmark planner has unexpected field: ${String(
        keys.find((key) => key !== 'runId') ?? 'missing runId',
      )}`,
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, 'runId');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new Error('planner runId must be an own data property, not an accessor');
  }
  return requireSafeId(descriptor.value, 'runId');
}

function step(stepId, dependsOn, policy) {
  return {
    stepId,
    dependsOn,
    maximumAttempts: policy.maximumAttempts,
    timeoutMs: policy.timeoutMs,
    requiresApproval: policy.requiresApproval,
  };
}
