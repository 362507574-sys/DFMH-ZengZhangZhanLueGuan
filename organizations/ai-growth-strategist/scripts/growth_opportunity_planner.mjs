import { requireSafeId } from '../../../scripts/control-center/project_contract.mjs';
import { createGrowthPlan } from './growth_planner.mjs';
import { assertPlainData } from './strict_json.mjs';

const INPUT_FIELDS = new Set(['runId']);
const RESEARCH_STEP = Object.freeze({
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

export function createGrowthOpportunityPlan(input) {
  assertPlainData(input, 'growth opportunity planner input', {
    maxArrayLength: 10,
    maxNodes: 20,
  });
  const runId = readInput(input);
  return createGrowthPlan({
    runId,
    capabilityId: 'growth-opportunity-analysis',
    steps: [
      step('intake', [], INTERNAL_STEP),
      step('input-audit', ['intake'], INTERNAL_STEP),
      step('research-plan', ['input-audit'], RESEARCH_STEP),
      step('market-trends', ['research-plan'], RESEARCH_STEP),
      step('user-demand', ['research-plan'], RESEARCH_STEP),
      step('industry-opportunity', ['research-plan'], RESEARCH_STEP),
      step('enterprise-growth-space', ['research-plan'], RESEARCH_STEP),
      step('opportunity-pool', [
        'market-trends',
        'user-demand',
        'industry-opportunity',
        'enterprise-growth-space',
      ], INTERNAL_STEP),
      step('priority-map', ['opportunity-pool'], INTERNAL_STEP),
      step('experiments', ['priority-map'], INTERNAL_STEP),
      step('debug', ['experiments'], INTERNAL_STEP),
      step('approval', ['debug'], APPROVAL_STEP),
    ],
  });
}

function readInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('growth opportunity planner input must be an object');
  }
  const keys = Reflect.ownKeys(input);
  for (const key of keys) {
    if (typeof key !== 'string' || !INPUT_FIELDS.has(key)) {
      throw new Error(`growth opportunity planner has unexpected field: ${String(key)}`);
    }
  }
  if (!Object.hasOwn(input, 'runId')) {
    throw new Error('growth opportunity planner runId is required');
  }
  return requireSafeId(input.runId, 'runId');
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
