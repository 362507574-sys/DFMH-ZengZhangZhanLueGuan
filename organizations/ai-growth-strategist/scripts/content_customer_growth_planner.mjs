import { createGrowthPlan } from './growth_planner.mjs';

const INTERNAL = Object.freeze({
  maximumAttempts: 1,
  timeoutMs: 1_000,
  requiresApproval: false,
});
const APPROVAL = Object.freeze({
  maximumAttempts: 1,
  timeoutMs: 1_000,
  requiresApproval: true,
});
const BOUNDED_RETRY = Object.freeze({
  maximumAttempts: 2,
  timeoutMs: 15_000,
  requiresApproval: false,
});

export function createContentCustomerGrowthPlan({ runId }) {
  return createGrowthPlan({
    runId,
    capabilityId: 'content-customer-growth',
    steps: [
      step('intake', [], INTERNAL),
      step('upstream-version-check', ['intake'], BOUNDED_RETRY),
      step('brand-product-lock', ['upstream-version-check'], INTERNAL),
      step('lifecycle-plan', ['brand-product-lock'], INTERNAL),
      step('content-strategy', ['lifecycle-plan'], INTERNAL),
      step('short-video-plan', ['content-strategy'], BOUNDED_RETRY),
      step('xiaohongshu-plan', ['content-strategy'], BOUNDED_RETRY),
      step(
        'permission-private-domain-plan',
        ['content-strategy'],
        BOUNDED_RETRY,
      ),
      step('content-candidate-library', [
        'short-video-plan',
        'xiaohongshu-plan',
        'permission-private-domain-plan',
      ], INTERNAL),
      step(
        'brand-evidence-safety-check',
        ['content-candidate-library'],
        INTERNAL,
      ),
      step('approval', ['brand-evidence-safety-check'], APPROVAL),
      step('metric-collection', ['approval'], INTERNAL),
      step('deal-handoff', ['metric-collection'], INTERNAL),
      step('repurchase', ['deal-handoff'], INTERNAL),
      step('debug', ['repurchase'], INTERNAL),
      step('review', ['debug'], INTERNAL),
    ],
  });
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
