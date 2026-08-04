import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/growth_opportunity_debugger.mjs');

const validOpportunity = () => ({
  claim: '现有许可订阅用户可能适合验证经营诊断研讨会',
  evidenceRefs: ['ev-behavior', 'ev-enterprise'],
  demandSignals: ['qualified-inquiry'],
  purchaseSignals: ['explicit-consultation-request'],
  correlationClaimedAsCausation: false,
  boundaryChange: false,
  experiment: {
    metric: 'qualified inquiry rate per delivered email',
    stopConditions: ['complaint rate rises'],
  },
});

test('机会专属调试器暴露三个纯诊断入口', () => {
  assert.equal(typeof loaded.module?.diagnoseOpportunity, 'function');
  assert.equal(
    typeof loaded.module?.diagnoseAttractivenessSensitivity,
    'function',
  );
  assert.equal(typeof loaded.module?.diagnoseExperiment, 'function');
});

test('诊断无来源市场规模、互动冒充购买和因果夸大', () => {
  if (!loaded.module) return;
  assert.equal(loaded.module.diagnoseOpportunity({
    claim: '市场规模为100亿元',
    evidenceRefs: [],
  }).code, 'unsupported_market_size');
  assert.equal(loaded.module.diagnoseOpportunity({
    demandSignals: ['views'],
    purchaseSignals: [],
  }).code, 'engagement_is_not_purchase_demand');
  assert.equal(loaded.module.diagnoseOpportunity({
    ...validOpportunity(),
    correlationClaimedAsCausation: true,
  }).code, 'causality_overclaim');
  assert.equal(
    loaded.module.diagnoseOpportunity(validOpportunity()).code,
    'ok',
  );
});

test('实验诊断阻断不可测量、无停止条件和组织越界', () => {
  if (!loaded.module) return;
  assert.equal(loaded.module.diagnoseExperiment({
    metric: '',
    stopConditions: ['投诉率上升'],
    boundaryChange: false,
  }).code, 'unmeasurable_metric');
  assert.equal(loaded.module.diagnoseExperiment({
    metric: '有效咨询率',
    stopConditions: [],
    boundaryChange: false,
  }).code, 'missing_stop_condition');
  assert.equal(loaded.module.diagnoseExperiment({
    metric: '有效咨询率',
    stopConditions: ['投诉率上升'],
    boundaryChange: true,
  }).code, 'boundary_change');
});

test('评分敏感性诊断指出优先级对单维度变化过度敏感', () => {
  if (!loaded.module) return;
  const stable = loaded.module.diagnoseAttractivenessSensitivity({
    baseTotal: 77,
    alternativeTotals: [74, 80],
    maximumAllowedDelta: 10,
  });
  assert.equal(stable.code, 'ok');
  const unstable = loaded.module.diagnoseAttractivenessSensitivity({
    baseTotal: 77,
    alternativeTotals: [55, 82],
    maximumAllowedDelta: 10,
  });
  assert.equal(unstable.code, 'score_sensitivity_high');
  assert.equal(unstable.severity, 'warning');
});

test('所有诊断返回精确字段并深度冻结', () => {
  if (!loaded.module) return;
  const result = loaded.module.diagnoseOpportunity(validOpportunity());
  assert.deepEqual(Object.keys(result), [
    'code',
    'severity',
    'field',
    'explanation',
    'recoveryAction',
  ]);
  assert.equal(Object.isFrozen(result), true);
});

test('调试入口读取前拒绝深层Proxy与accessor且不触发trap', () => {
  if (!loaded.module) return;
  let touched = 0;
  const proxy = new Proxy(validOpportunity(), {
    ownKeys() { touched += 1; return []; },
  });
  assert.throws(
    () => loaded.module.diagnoseOpportunity(proxy),
    /Proxy|plain data/u,
  );
  const nested = validOpportunity();
  Object.defineProperty(nested.experiment, 'metric', {
    enumerable: true,
    get() { touched += 1; return 'trap'; },
  });
  assert.throws(
    () => loaded.module.diagnoseOpportunity(nested),
    /accessor|data property|plain data/u,
  );
  const refs = validOpportunity();
  Object.defineProperty(refs.evidenceRefs, 'extra', {
    enumerable: true,
    get() { touched += 1; return 'trap'; },
  });
  assert.throws(
    () => loaded.module.diagnoseOpportunity(refs),
    /extra|accessor|plain data/u,
  );
  assert.equal(touched, 0);
});
