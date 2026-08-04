import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { classifyPrivatePerformanceText } from '../scripts/competitive_benchmark_claim_classifier.mjs';
import { organizationRoot } from './helpers.mjs';

const PERSISTED_CONTEXTS = Object.freeze([
  'scope_fact',
  'hypothesis',
  'inference',
  'unknown',
  'public_fact',
]);

const ROUTE_ATTACKS = Object.freeze({
  inference: [
    'Public content can win customers',
    '公开内容可以赢得客户',
    '公开文章形成垄断',
    '内容机制控制市场',
    '公开资料让客户翻倍',
    '官网目录带来99%客户',
    '清单内容称霸行业',
    '公开课击败对手',
    '机制连接后收入增长',
    '内容可以带来冠军',
    '公开入口必然成交',
    '公众号文章主导赛道',
    '公开资料包使销量翻倍',
    '内容机制收割客户',
    'Public posts double customers',
    'Public mechanism controls the market',
  ],
  public_fact: [
    '竞品A官网公开课程目录并赢得客户',
    'The competitor publishes public posts and doubles customers',
    '公开售价为9.9元并控制市场',
    '竞品A公开课称霸行业',
    '竞品A引导私信后成交翻倍',
    'Public content can win customers',
  ],
  scope_fact: [
    '替代样本A仅作为比较基线，不代表第四家市场主体',
    '替代样本D作为市场冠军',
    '替代样本D仅作为比较基线并赢得客户',
    'Alternative sample A is only a baseline and not a fourth market actor',
    'Alternative sample D dominates the market',
    '替代样本D仅作为比较基线',
  ],
  hypothesis: [
    '企业内部未来实验比较竞品客户增长待验证',
    '本企业未来实验赢得客户待验证',
    'Our company internal future experiment tests market domination',
    '企业内部未来实验测试收入翻倍待验证',
    '未来企业内部实验比较外部市场冠军待验证',
  ],
  unknown: [
    '行业王者客户结果未知',
    'Public content can win customers unknown',
    '客户翻倍暂无数据',
    '市场垄断尚不清楚',
    '冠军表现未披露',
    '公开文章控制市场待验证',
  ],
});

const PUBLIC_FACT_POSITIVES = Object.freeze([
  '竞品A的官网公开课程目录',
  'The competitor publishes three public posts weekly',
  '公开售价为9.9元',
]);

const UNKNOWN_POSITIVES = Object.freeze([
  '客户路径暂无数据',
  '渠道效果尚不清楚',
  '公开资料完整性未披露',
  '内容节奏未公开',
  '品牌认知未经验证',
  '用户反馈尚未验证',
  '公开路径待核验',
  '资料结构待验证',
  '后台步骤无法判断',
  '公开信息不能判断',
]);

const STRUCTURED_QUOTED_POSITIVES = Object.freeze([
  '三家样本的客户路径暂无数据',
  'all samples public path is unavailable',
  'three samples channel effect is unknown',
  'Alternative sample B’s public path is not publicly disclosed',
  '“竞品A”的客户路径暂无数据',
]);

const UNICODE_P = Object.freeze([
  '↑公开内容可以形成公开入口',
  '公开内容可以形成公开入口↗',
  '公开内容+可以形成公开入口',
  '公开内容/可以形成公开入口',
  '公开内容%可以形成公开入口',
  '公开内容（可以形成公开入口',
  '公开内容可以形成公开入口）',
  '公开内容【可以形成公开入口',
  '公开内容可以形成公开入口】',
  '公开内容，可以形成公开入口',
  '公开内容：可以形成公开入口',
  '公开内容、可以形成公开入口',
]);

test('第九轮固定route穿透样本全部失败关闭', () => {
  let count = 0;
  for (const [context, samples] of Object.entries(ROUTE_ATTACKS)) {
    for (const sample of samples) {
      const result = classifyPrivatePerformanceText(sample, { context });
      assert.equal(result.prohibitedAssertion, true, `${context}: ${sample}`);
      count += 1;
    }
  }
  assert.equal(count, 39);
});

test('12个Unicode P残余贯穿五入口共60次全部拒绝', () => {
  let count = 0;
  for (const context of PERSISTED_CONTEXTS) {
    for (const sample of UNICODE_P) {
      assert.equal(
        classifyPrivatePerformanceText(sample, { context }).prohibitedAssertion,
        true,
        `${context}: ${sample}`,
      );
      count += 1;
    }
  }
  assert.equal(count, 60);
});

test('P2未知、复数弯引号结构化主语与public_fact正例允许', () => {
  for (const sample of UNKNOWN_POSITIVES) {
    assert.equal(
      classifyPrivatePerformanceText(sample, { context: 'unknown' })
        .prohibitedAssertion,
      false,
      sample,
    );
  }
  for (const sample of STRUCTURED_QUOTED_POSITIVES) {
    assert.equal(
      classifyPrivatePerformanceText(sample, { context: 'unknown' })
        .prohibitedAssertion,
      false,
      sample,
    );
  }
  for (const sample of PUBLIC_FACT_POSITIVES) {
    assert.equal(
      classifyPrivatePerformanceText(sample, { context: 'public_fact' })
        .prohibitedAssertion,
      false,
      sample,
    );
  }
});

test('512轮确定性边界突变全部拒绝且100个原子正例允许', () => {
  const safe = [
    ['public_fact', '竞品A的官网公开课程目录'],
    ['scope_fact', '替代样本D仅作为比较基线，不代表第四家市场主体'],
    ['inference', '公开内容可能连接公开资料入口，待验证'],
    ['hypothesis', '企业内部未来实验测试原创内容草案，待验证'],
    ['unknown', '样本A的客户路径暂无数据'],
  ];
  const residues = ['冠军', '99', '+', '↑', '（', '客户翻倍', '🚀', '%'];
  let rejected = 0;
  for (let index = 0; index < 512; index += 1) {
    const [context, statement] = safe[index % safe.length];
    const boundary = index % (statement.length + 1);
    const residue = residues[index % residues.length];
    const mutated = `${statement.slice(0, boundary)}${residue}${statement.slice(boundary)}`;
    assert.equal(
      classifyPrivatePerformanceText(mutated, { context }).prohibitedAssertion,
      true,
      `${context}: ${mutated}`,
    );
    rejected += 1;
  }
  assert.equal(rejected, 512);

  let accepted = 0;
  for (let repeat = 0; repeat < 20; repeat += 1) {
    for (const [context, statement] of safe) {
      assert.equal(
        classifyPrivatePerformanceText(statement, { context }).prohibitedAssertion,
        false,
        `${context}: ${statement}`,
      );
      accepted += 1;
    }
  }
  assert.equal(accepted, 100);
});

test('route函数静态禁止wide wildcard与split-filter解析', async () => {
  const source = await readFile(
    path.join(
      organizationRoot,
      'scripts',
      'competitive_benchmark_claim_classifier.mjs',
    ),
    'utf8',
  );
  for (const name of [
    'isSafePublicObservableFact',
    'isSafeScopeFact',
    'isSafeMechanismInference',
    'isSafeInternalNoMetricHypothesis',
    'isSafeNoMetricUnknown',
  ]) {
    const start = source.indexOf(`function ${name}`);
    assert.notEqual(start, -1, name);
    const next = source.indexOf('\nfunction ', start + 10);
    const body = source.slice(start, next === -1 ? source.length : next);
    assert.doesNotMatch(body, /\.\*|\[\\s\\S\]\*/u, name);
  }
  assert.doesNotMatch(source, /\.split\([^)]*\)[\s\S]{0,200}\.filter\(Boolean\)/u);
  assert.doesNotMatch(source, /AUDIT_BOUNDARY/u);
});
