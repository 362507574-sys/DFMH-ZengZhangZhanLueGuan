import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/growth_opportunity_planner.mjs');

test('机会规划器暴露确定性入口', () => {
  assert.equal(
    typeof loaded.module?.createGrowthOpportunityPlan,
    'function',
    loaded.error?.message ?? 'createGrowthOpportunityPlan missing',
  );
});

test('机会规划器建立固定十二步可恢复链路', () => {
  if (!loaded.module) return;
  const plan = loaded.module.createGrowthOpportunityPlan({
    runId: 'run-opportunity-001',
  });
  assert.deepEqual(plan.executionOrder, [
    'intake',
    'input-audit',
    'research-plan',
    'market-trends',
    'user-demand',
    'industry-opportunity',
    'enterprise-growth-space',
    'opportunity-pool',
    'priority-map',
    'experiments',
    'debug',
    'approval',
  ]);
  assert.equal(plan.capabilityId, 'growth-opportunity-analysis');
});

test('四条分析支线共同依赖研究计划，机会池等待四支线', () => {
  if (!loaded.module) return;
  const plan = loaded.module.createGrowthOpportunityPlan({
    runId: 'run-opportunity-001',
  });
  const steps = new Map(plan.steps.map((item) => [item.stepId, item]));
  for (const id of [
    'market-trends',
    'user-demand',
    'industry-opportunity',
    'enterprise-growth-space',
  ]) {
    assert.deepEqual(steps.get(id).dependsOn, ['research-plan']);
    assert.equal(steps.get(id).maximumAttempts, 2);
    assert.equal(steps.get(id).timeoutMs, 15000);
    assert.equal(steps.get(id).requiresApproval, false);
  }
  assert.deepEqual(steps.get('opportunity-pool').dependsOn, [
    'market-trends',
    'user-demand',
    'industry-opportunity',
    'enterprise-growth-space',
  ]);
});

test('外部实验动作只在最终审批步骤开放', () => {
  if (!loaded.module) return;
  const plan = loaded.module.createGrowthOpportunityPlan({
    runId: 'run-opportunity-001',
  });
  const approvalSteps = plan.steps.filter((item) => item.requiresApproval);
  assert.deepEqual(
    approvalSteps.map((item) => item.stepId),
    ['approval'],
  );
  assert.equal(approvalSteps[0].maximumAttempts, 1);
  assert.equal(approvalSteps[0].timeoutMs, 1000);
});

test('规划器拒绝多余输入和不安全 runId', () => {
  if (!loaded.module) return;
  assert.throws(
    () => loaded.module.createGrowthOpportunityPlan({
      runId: '../other',
    }),
    /runId|invalid|unsafe/u,
  );
  assert.throws(
    () => loaded.module.createGrowthOpportunityPlan({
      runId: 'run-opportunity-001',
      extra: true,
    }),
    /unexpected|extra/u,
  );
});

test('规划器读取前拒绝Proxy与accessor且不触发trap', () => {
  if (!loaded.module) return;
  let touched = 0;
  const proxy = new Proxy({ runId: 'run-opportunity-001' }, {
    ownKeys() { touched += 1; return []; },
  });
  assert.throws(
    () => loaded.module.createGrowthOpportunityPlan(proxy),
    /Proxy|plain data/u,
  );
  const accessor = {};
  Object.defineProperty(accessor, 'runId', {
    enumerable: true,
    get() { touched += 1; return 'run-opportunity-001'; },
  });
  assert.throws(
    () => loaded.module.createGrowthOpportunityPlan(accessor),
    /accessor|data property|plain data/u,
  );
  assert.equal(touched, 0);
});
