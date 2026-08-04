import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPrivatePerformanceText,
} from '../scripts/competitive_benchmark_claim_classifier.mjs';

const realPublicFacts = [
  'FORCE LABO公开页面列出常设赛道、一日通票、工具借用、本体及配件商品和定期比赛活动。',
  'TAMIYA PLAMODEL FACTORY TOKYO公开页面说明场馆汇集模型、迷你四驱车和动手制作体验，并面向既有爱好者、家庭、朋友和新用户。',
  'Eat Race Party公开页面提供面向家庭、学校和机构的迷你四驱车搭建、定制和赛道竞速活动。',
  'RaceWorks公开页面展示遥控车赛道体验，并在赛道旁设置模型商店。',
];

test('public_fact accepts source-bound public page observations beyond demo fixtures', () => {
  for (const statement of realPublicFacts) {
    assert.equal(
      classifyPrivatePerformanceText(statement, {
        context: 'public_fact',
      }).prohibitedAssertion,
      false,
      statement,
    );
  }
});

test('general public page grammar still rejects private performance and rankings', () => {
  for (const statement of [
    'FORCE LABO公开页面说明收入增长。',
    'RaceWorks公开页面展示市场第一。',
    'Eat Race Party公开页面说明转化率为80%。',
  ]) {
    assert.equal(
      classifyPrivatePerformanceText(statement, {
        context: 'public_fact',
      }).prohibitedAssertion,
      true,
      statement,
    );
  }
});

test('unknown buckets accept complete sample-specific unknown statements', () => {
  for (const statement of [
    'FORCE LABO各类用户的真实占比和到店原因均未知。',
    'RaceWorks从赛道体验到商品购买和再次到访的真实路径均未知。',
    '成都本地同类门店、活动和替代娱乐样本仍未知。',
  ]) {
    assert.equal(
      classifyPrivatePerformanceText(statement, {
        context: 'unknown',
      }).prohibitedAssertion,
      false,
      statement,
    );
  }
});

test('inference accepts bounded mechanism analysis for new real samples', () => {
  for (const statement of [
    '公开的人群覆盖表达有助于解释同一场地的多层使用场景，该机制仍待本企业内部未来实验验证。',
    '具体设施和活动内容有助于把抽象爱好转为可想象的到店场景，该机制仍待本企业内部未来实验验证。',
    '相邻遥控车体验同时公开赛道和模型商店，可作为体验设施与商品承接相邻的替代机制基线。',
  ]) {
    assert.equal(
      classifyPrivatePerformanceText(statement, {
        context: 'inference',
      }).prohibitedAssertion,
      false,
      statement,
    );
  }
});

test('general inference grammar rejects unbounded claims and private outcomes', () => {
  for (const statement of [
    'FORCE LABO客户很多。',
    'RaceWorks有助于收入增长，该机制仍待本企业内部未来实验验证。',
    '竞品市场第一，适合观察。',
  ]) {
    assert.equal(
      classifyPrivatePerformanceText(statement, {
        context: 'inference',
      }).prohibitedAssertion,
      true,
      statement,
    );
  }
});

test('hypothesis accepts bounded internal experiments with new objects', () => {
  for (const statement of [
    '企业内部未来实验测试完整首次体验信息原型是否获得更高的任务理解分，待验证。',
    '企业内部未来实验测试三条分层入口是否减少模拟用户选错产品路径，待验证。',
    '企业内部未来实验测试按体验任务记录商品需求是否得到更少的无来源商品候选，待验证。',
  ]) {
    assert.equal(
      classifyPrivatePerformanceText(statement, {
        context: 'hypothesis',
      }).prohibitedAssertion,
      false,
      statement,
    );
  }
});

test('internal hypothesis grammar rejects competitor-subject and private metrics', () => {
  for (const statement of [
    '企业内部未来实验测试竞品A是否提升表现，待验证。',
    '企业内部未来实验测试FORCE LABO收入是否增长，待验证。',
  ]) {
    assert.equal(
      classifyPrivatePerformanceText(statement, {
        context: 'hypothesis',
      }).prohibitedAssertion,
      true,
      statement,
    );
  }
});
