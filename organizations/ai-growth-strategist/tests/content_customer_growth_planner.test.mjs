import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/content_customer_growth_planner.mjs',
);

test('内容客户增长规划器覆盖三渠道、六阶段、调试和审批', () => {
  assert.equal(
    typeof loaded.module?.createContentCustomerGrowthPlan,
    'function',
    loaded.error?.message ?? 'createContentCustomerGrowthPlan missing',
  );
  if (!loaded.module) return;
  const plan = loaded.module.createContentCustomerGrowthPlan({
    runId: 'run-content-v2',
  });
  assert.equal(plan.capabilityId, 'content-customer-growth');
  assert.deepEqual(plan.executionOrder, [
    'intake',
    'upstream-version-check',
    'brand-product-lock',
    'lifecycle-plan',
    'content-strategy',
    'short-video-plan',
    'xiaohongshu-plan',
    'permission-private-domain-plan',
    'content-candidate-library',
    'brand-evidence-safety-check',
    'approval',
    'metric-collection',
    'deal-handoff',
    'repurchase',
    'debug',
    'review',
  ]);
  const byId = new Map(plan.steps.map((item) => [item.stepId, item]));
  assert.deepEqual(byId.get('content-candidate-library').dependsOn, [
    'short-video-plan',
    'xiaohongshu-plan',
    'permission-private-domain-plan',
  ]);
  assert.equal(byId.get('approval').requiresApproval, true);
  assert.deepEqual(byId.get('metric-collection').dependsOn, ['approval']);
});
