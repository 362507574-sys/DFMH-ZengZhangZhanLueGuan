import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/growth_opportunity_contract.mjs');

test('增长机会契约暴露候选校验入口', () => {
  assert.equal(
    typeof loaded.module?.validateGrowthOpportunityCandidate,
    'function',
    loaded.error?.message ?? 'validateGrowthOpportunityCandidate missing',
  );
});

test('完整候选通过并深度冻结', () => {
  if (!loaded.module) return;
  const result = loaded.module.validateGrowthOpportunityCandidate(validCandidate());
  assert.equal(result.capabilityId, 'growth-opportunity-analysis');
  assert.equal(result.opportunities[0].score.total, 24);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.opportunities[0]), true);
});

test('每个机会必须有两条证据且至少一条非推断', () => {
  if (!loaded.module) return;
  const missing = validCandidate();
  missing.opportunities[0].evidenceRefs = ['ev-inference'];
  assert.throws(
    () => loaded.module.validateGrowthOpportunityCandidate(missing),
    /two|两条|evidence/u,
  );
  const inferredOnly = validCandidate();
  inferredOnly.opportunities[0].evidenceRefs = ['ev-inference', 'ev-hypothesis'];
  assert.throws(
    () => loaded.module.validateGrowthOpportunityCandidate(inferredOnly),
    /fact|事实|evidence/u,
  );
});

test('拒绝无来源外部事实、错误评分和缺停止条件', () => {
  if (!loaded.module) return;
  const noSource = validCandidate();
  noSource.evidence[0].sourceReference = '';
  assert.throws(
    () => loaded.module.validateGrowthOpportunityCandidate(noSource),
    /source|来源/u,
  );
  const wrongScore = validCandidate();
  wrongScore.opportunities[0].score.total = 30;
  assert.throws(
    () => loaded.module.validateGrowthOpportunityCandidate(wrongScore),
    /score|评分|total/u,
  );
  const noStop = validCandidate();
  noStop.opportunities[0].validationExperiment.stopConditions = [];
  assert.throws(
    () => loaded.module.validateGrowthOpportunityCandidate(noStop),
    /stop|停止/u,
  );
});

test('拒绝保证增长和越权修改战略、品牌、价格或成交规则', () => {
  if (!loaded.module) return;
  const guarantee = validCandidate();
  guarantee.opportunities[0].growthMechanism = '保证增长并在30天内翻倍';
  assert.throws(
    () => loaded.module.validateGrowthOpportunityCandidate(guarantee),
    /guarantee|保证|承诺/u,
  );
  for (const field of [
    'changesEnterpriseStrategy',
    'changesBrandPositioning',
    'changesPricePolicy',
    'changesDealRules',
  ]) {
    const candidate = validCandidate();
    candidate.boundaryChecks[field] = true;
    assert.throws(
      () => loaded.module.validateGrowthOpportunityCandidate(candidate),
      /boundary|边界|change|修改/u,
    );
  }
});

test('优先级必须覆盖全部机会且不能重复', () => {
  if (!loaded.module) return;
  const candidate = validCandidate();
  candidate.opportunities.push({
    ...structuredClone(candidate.opportunities[0]),
    id: 'opp-002',
    title: '小红书低成本验证',
  });
  candidate.priorityOrder = ['opp-001', 'opp-001'];
  assert.throws(
    () => loaded.module.validateGrowthOpportunityCandidate(candidate),
    /priority|优先级/u,
  );
});

export function validCandidate() {
  return {
    schemaVersion: 1,
    capabilityId: 'growth-opportunity-analysis',
    enterpriseId: 'demo-enterprise',
    taskId: '20260728-001-growth-test',
    status: 'candidate',
    knowledgeContext: {
      status: 'matched',
      evidencePath: 'tasks/demo-enterprise/20260728-001-growth-test/evidence/knowledge_context.json',
    },
    scope: {
      businessGoal: '提高有效咨询量并建立可追踪增长链路',
      productOrService: '中小企业经营培训',
      region: '中国大陆',
      timeRange: '2026-Q3',
      constraints: [
        '不虚构行业规模',
        '不自动联系客户',
      ],
    },
    evidence: [
      {
        id: 'ev-behavior',
        type: 'behavior_data',
        claim: '经营复盘主题平均阅读率为12%，其他主题为6%。',
        sourceReference: 'internal-report-2026-q2',
        observedAt: '2026-07-20T00:00:00.000Z',
        appliesTo: '公众号近三个月内容',
      },
      {
        id: 'ev-enterprise',
        type: 'enterprise_fact',
        claim: '两场直播报名400人、到场180人、咨询35人。',
        sourceReference: 'live-event-summary-2026-q2',
        observedAt: '2026-07-20T00:00:00.000Z',
        appliesTo: '两场免费直播',
      },
      {
        id: 'ev-inference',
        type: 'inference',
        claim: '经营复盘内容与直播可能构成优先增长链路。',
        sourceReference: 'ev-behavior+ev-enterprise',
        observedAt: '2026-07-28T00:00:00.000Z',
        appliesTo: '下季度增长假设',
      },
      {
        id: 'ev-hypothesis',
        type: 'hypothesis',
        claim: '优化提醒可能提高直播到场率。',
        sourceReference: 'experiment-hypothesis-001',
        observedAt: '2026-07-28T00:00:00.000Z',
        appliesTo: '首轮验证',
      },
    ],
    opportunities: [
      {
        id: 'opp-001',
        title: '经营复盘内容与直播联动',
        targetSegment: '已关注经营复盘内容的中小企业老板',
        customerNeed: '把经营问题转为可执行的季度动作',
        evidenceRefs: ['ev-behavior', 'ev-enterprise', 'ev-inference'],
        growthMechanism: '用高需求内容引导用户自愿报名主题直播并提交咨询',
        growthPositioning: {
          prioritySegment: '经营复盘内容高互动人群',
          scenario: '季度经营复盘',
          channel: '公众号与许可式私域',
          notBrandRepositioning: true,
        },
        score: {
          demand: 5,
          enterpriseFit: 5,
          reachability: 4,
          competition: 2,
          effort: 3,
          risk: 3,
          total: 24,
        },
        validationExperiment: {
          hypothesis: '统一主题与提醒能提高到场并保持咨询质量',
          method: '连续两场使用统一内容入口与分层提醒',
          metric: '报名到场率与有效咨询率',
          target: '到场率高于现有45%，咨询率不低于现有基线',
          maximumDays: 45,
          maximumCost: '不新增付费投放',
          stopConditions: [
            '两场到场率均不高于基线',
            '投诉或拒绝联系率异常上升',
          ],
        },
        risks: [
          '直播样本量较小',
        ],
        unknowns: [
          '咨询后的成交率和客单价未知',
        ],
      },
    ],
    priorityOrder: ['opp-001'],
    boundaryChecks: {
      changesEnterpriseStrategy: false,
      changesBrandPositioning: false,
      changesPricePolicy: false,
      changesDealRules: false,
    },
    collaborationRequests: [
      {
        targetOrganization: 'ai-deal-officer',
        reason: '复核有效咨询的交接条件，不改写增长机会排序。',
      },
    ],
    review: {
      baselineMetrics: [
        '经营复盘主题阅读率12%',
        '直播报名到场率45%',
      ],
      reviewAt: '2026-09-30T00:00:00.000Z',
      decisionRules: [
        '实验达到目标才考虑扩大',
        '证据不足则保持待验证',
      ],
    },
  };
}
