import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/competitive_benchmark_claim_classifier.mjs',
);

function classify(text, context = 'inference') {
  assert.equal(
    typeof loaded.module?.classifyPrivatePerformanceText,
    'function',
    loaded.error?.message ?? 'private performance classifier missing',
  );
  return loaded.module?.classifyPrivatePerformanceText(text, { context });
}

test('统一分类器覆盖中英文私有经营指标及数字断言', () => {
  for (const phrase of [
    '转化率达到30%',
    '月流水超过100万元',
    'GMV 200万',
    'ROAS 4.2',
    'conversion rate is 35 percent',
    'monthly revenue reached 2 million',
  ]) {
    const result = classify(phrase);
    if (!result) return;
    assert.equal(result.metricDetected, true, phrase);
    assert.equal(result.explicitUnknown, false, phrase);
    assert.equal(result.prohibitedAssertion, true, phrase);
  }
});

test('无数字的确定性业绩强断言同样被分类为禁止', () => {
  const result = classify('收入领先，利润很好，成交最强，复购优秀');
  if (!result) return;
  assert.equal(result.metricDetected, true);
  assert.equal(result.explicitUnknown, false);
  assert.equal(result.prohibitedAssertion, true);
  for (const metric of ['revenue', 'profit', 'deal', 'repurchase']) {
    assert.ok(result.metrics.includes(metric), metric);
  }
});

test('只有显式未知、无公开证据、无法判断或待验证才可进入unknowns', () => {
  for (const phrase of [
    '收入未知。',
    '利润无公开证据。',
    'GMV无法判断。',
    'ROAS待验证。',
  ]) {
    const result = classify(phrase, 'unknown');
    if (!result) return;
    assert.equal(result.metricDetected, true, phrase);
    assert.equal(result.explicitUnknown, true, phrase);
    assert.equal(result.prohibitedAssertion, false, phrase);
  }
  const disguised = classify('收入领先。', 'unknown');
  if (!disguised) return;
  assert.equal(disguised.prohibitedAssertion, true);
});

test('未知或否定只能豁免所在子句不能掩护转折后的确定断言', () => {
  for (const phrase of [
    '收入未知，但是竞品收入领先。',
    'GMV不代表利润，然而该竞品GMV第一。',
    'No public evidence for profit; actually its profit is strongest.',
  ]) {
    const result = classify(phrase, 'unknown');
    if (!result) return;
    assert.equal(result.metricDetected, true, phrase);
    assert.equal(result.prohibitedAssertion, true, phrase);
  }
});

test('逗号顿号冒号和连接词切开指标本地陈述', () => {
  for (const phrase of [
    '竞品收入未知，竞品利润最高。',
    '收入未知，竞品收入领先。',
    '收入不代表全部情况，可是竞品利润领先。',
    '若收入下降，竞品GMV第一。',
    'Revenue is unknown, yet competitor profit is strongest.',
    'Although revenue is unknown: competitor GMV is first.',
  ]) {
    const result = classify(phrase, 'unknown');
    if (!result) return;
    assert.equal(result.metricDetected, true, phrase);
    assert.equal(result.prohibitedAssertion, true, phrase);
  }

  for (const phrase of [
    '收入未知，利润未知。',
    'Revenue is unknown; profit is unknown.',
  ]) {
    const result = classify(phrase, 'unknown');
    if (!result) return;
    assert.equal(result.metricDetected, true, phrase);
    assert.equal(result.prohibitedAssertion, false, phrase);
  }
});
