import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/competitive_benchmark_planner.mjs',
);

test('竞争对标规划严格使用批准的14步依赖顺序', () => {
  assert.equal(
    typeof loaded.module?.createCompetitiveBenchmarkPlan,
    'function',
    loaded.error?.message ?? 'competitive benchmark planner missing',
  );
  if (!loaded.module) return;
  const plan = loaded.module.createCompetitiveBenchmarkPlan({
    runId: 'run-benchmark',
  });
  assert.deepEqual(plan.executionOrder, [
    'intake',
    'sample-plan',
    'source-collection',
    'source-validation',
    'positioning',
    'product-strategy',
    'content-mechanism',
    'acquisition-channels',
    'observable-customer-path',
    'mechanism-transfer',
    'enterprise-adaptation',
    'copy-brand-ip-check',
    'experiments',
    'approval',
  ]);
  assert.equal(plan.capabilityId, 'competitive-benchmark-analysis');
  assert.equal(Object.isFrozen(plan), true);
});

test('来源采集与校验各2次15秒，其他分析只执行1次', () => {
  if (!loaded.module) return;
  const plan = loaded.module.createCompetitiveBenchmarkPlan({
    runId: 'run-benchmark',
  });
  const byId = new Map(plan.steps.map((step) => [step.stepId, step]));
  for (const id of ['source-collection', 'source-validation']) {
    assert.equal(byId.get(id).maximumAttempts, 2);
    assert.equal(byId.get(id).timeoutMs, 15_000);
    assert.equal(byId.get(id).requiresApproval, false);
  }
  for (const step of plan.steps) {
    if (['source-collection', 'source-validation'].includes(step.stepId)) {
      continue;
    }
    assert.equal(step.maximumAttempts, 1, step.stepId);
  }
  assert.equal(byId.get('approval').requiresApproval, true);
});

test('浏览研究是只读动作且登录绕过不是fallback', () => {
  assert.deepEqual(loaded.module?.BROWSER_RESEARCH_POLICY, {
    policyId: 'competitive-benchmark-read-only-research-v1',
    mode: 'read_only_research',
    continuousActionStandard:
      'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md',
    controller: 'scripts/browser_continuous_action_controller.mjs',
    timelineRequired: true,
    loginBypassAllowed: false,
    externalWriteAllowed: false,
  });
  assert.equal(
    Object.isFrozen(loaded.module?.BROWSER_RESEARCH_POLICY),
    true,
  );
});

test('规划输入严格拒绝额外字段、Proxy与accessor', () => {
  if (!loaded.module) return;
  assert.throws(
    () => loaded.module.createCompetitiveBenchmarkPlan({
      runId: 'run-benchmark',
      skipApproval: true,
    }),
    /unexpected field/u,
  );
  assert.throws(
    () => loaded.module.createCompetitiveBenchmarkPlan(
      new Proxy({ runId: 'run-benchmark' }, {}),
    ),
    /Proxy|plain data/u,
  );
  const accessor = {};
  Object.defineProperty(accessor, 'runId', {
    enumerable: true,
    get: () => 'run-benchmark',
  });
  assert.throws(
    () => loaded.module.createCompetitiveBenchmarkPlan(accessor),
    /accessor|data property|plain data/u,
  );
});

test('14步计划把来源采集与校验显式绑定到可执行浏览策略', () => {
  if (!loaded.module) return;
  const plan = loaded.module.createCompetitiveBenchmarkPlan({
    runId: 'run-benchmark',
  });
  assert.deepEqual(
    Object.keys(plan.browserPolicyBindings).sort(),
    ['source-collection', 'source-validation'],
  );
  for (const stepId of ['source-collection', 'source-validation']) {
    assert.equal(
      plan.browserPolicyBindings[stepId].policyId,
      'competitive-benchmark-read-only-research-v1',
    );
    assert.equal(
      plan.browserPolicyBindings[stepId].controller,
      'scripts/browser_continuous_action_controller.mjs',
    );
    assert.equal(
      plan.browserPolicyBindings[stepId].timelineRequired,
      true,
    );
  }
});

test('生产调用前浏览validator拒绝写入、登录绕过、错controller与缺timeline', () => {
  assert.equal(
    typeof loaded.module?.validateBrowserResearchExecution,
    'function',
    'browser execution validator missing',
  );
  if (!loaded.module?.validateBrowserResearchExecution) return;
  const trusted = {
    expectedIdentity: {
      enterpriseId: 'ent-benchmark',
      businessProjectId: '20260730-001-benchmark',
      taskId: 'task-benchmark',
      runId: 'run-benchmark',
    },
  };
  const valid = {
    stepId: 'source-collection',
    policyId: 'competitive-benchmark-read-only-research-v1',
    used: true,
    action: 'read_page',
    externalWrite: false,
    loginBypass: false,
    timelinePath:
      'temp/browser-research/ent-benchmark/20260730-001-benchmark/task-benchmark/run-benchmark/source-collection.json',
    notes: '只读采集公开页面。',
    continuousActionStandard:
      'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md',
    controller: 'scripts/browser_continuous_action_controller.mjs',
  };
  assert.equal(
    loaded.module.validateBrowserResearchExecution(valid, trusted).stepId,
    'source-collection',
  );
  for (const change of [
    (value) => { value.action = 'publish_content'; },
    (value) => { value.externalWrite = true; },
    (value) => { value.loginBypass = true; },
    (value) => { value.controller = 'scripts/forged.mjs'; },
    (value) => { value.timelinePath = ''; },
    (value) => { value.stepId = 'positioning'; },
    (value) => { value.notes = '竞品利润最强。'; },
  ]) {
    const input = structuredClone(valid);
    change(input);
    assert.throws(
      () => loaded.module.validateBrowserResearchExecution(input, trusted),
      /read.only|write|login|controller|timeline|source|notes|private/u,
    );
  }
});

test('浏览timeline绑定外部任务身份且未使用时不得伪造timeline', () => {
  if (!loaded.module?.validateBrowserResearchExecution) return;
  const trusted = {
    expectedIdentity: {
      enterpriseId: 'ent-benchmark',
      businessProjectId: '20260730-001-benchmark',
      taskId: 'task-benchmark',
      runId: 'run-benchmark',
    },
  };
  const timelinePath =
    'temp/browser-research/ent-benchmark/20260730-001-benchmark/task-benchmark/run-benchmark/source-collection.json';
  const used = {
    stepId: 'source-collection',
    policyId: 'competitive-benchmark-read-only-research-v1',
    used: true,
    action: 'read_page',
    externalWrite: false,
    loginBypass: false,
    timelinePath,
    notes: '只读采集公开页面。',
    continuousActionStandard:
      'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md',
    controller: 'scripts/browser_continuous_action_controller.mjs',
  };
  assert.equal(
    loaded.module.validateBrowserResearchExecution(used, trusted).timelinePath,
    timelinePath,
  );
  const otherTask = structuredClone(used);
  otherTask.timelinePath = timelinePath.replace(
    'task-benchmark',
    'task-other',
  );
  assert.throws(
    () => loaded.module.validateBrowserResearchExecution(otherTask, trusted),
    /timeline.*identity|task.*boundary/u,
  );
  const unused = structuredClone(used);
  unused.used = false;
  unused.action = null;
  unused.timelinePath = null;
  unused.notes = '本步骤未使用浏览器，不生成timeline。';
  assert.equal(
    loaded.module.validateBrowserResearchExecution(unused, trusted).used,
    false,
  );
  const fakeUnused = structuredClone(unused);
  fakeUnused.timelinePath = timelinePath;
  assert.throws(
    () => loaded.module.validateBrowserResearchExecution(fakeUnused, trusted),
    /unused.*timeline|未使用.*timeline/u,
  );
});

test('浏览notes中的局部未知不能掩护后续确定经营断言', () => {
  if (!loaded.module?.validateBrowserResearchExecution) return;
  const trusted = {
    expectedIdentity: {
      enterpriseId: 'ent-benchmark',
      businessProjectId: '20260730-001-benchmark',
      taskId: 'task-benchmark',
      runId: 'run-benchmark',
    },
  };
  const base = {
    stepId: 'source-validation',
    policyId: 'competitive-benchmark-read-only-research-v1',
    used: true,
    action: 'read_page',
    externalWrite: false,
    loginBypass: false,
    timelinePath:
      'temp/browser-research/ent-benchmark/20260730-001-benchmark/task-benchmark/run-benchmark/source-validation.json',
    notes: '只读核验公开页面。',
    continuousActionStandard:
      'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md',
    controller: 'scripts/browser_continuous_action_controller.mjs',
  };
  for (const notes of [
    '竞品收入未知，竞品利润最高。',
    '收入未知，竞品收入领先。',
    '收入不代表全部情况，可是竞品利润领先。',
    '若收入下降，竞品GMV第一。',
  ]) {
    const input = structuredClone(base);
    input.notes = notes;
    assert.throws(
      () => loaded.module.validateBrowserResearchExecution(input, trusted),
      /notes|private performance/u,
      notes,
    );
  }
});
