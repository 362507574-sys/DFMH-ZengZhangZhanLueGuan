import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/competitive_benchmark_contract.mjs');

test('竞争对标拆解契约暴露候选校验入口', () => {
  assert.equal(
    typeof loaded.module?.validateCompetitiveBenchmarkCandidate,
    'function',
    loaded.error?.message ?? 'validateCompetitiveBenchmarkCandidate missing',
  );
});

test('完整候选通过并深度冻结', () => {
  if (!loaded.module) return;
  const result = loaded.module.validateCompetitiveBenchmarkCandidate(validCandidate());
  assert.equal(result.benchmarks.length, 4);
  assert.equal(Object.isFrozen(result.insights[0]), true);
});

test('对标样本必须包含三个直接竞品和一个替代方案', () => {
  if (!loaded.module) return;
  const candidate = validCandidate();
  candidate.benchmarks.pop();
  assert.throws(
    () => loaded.module.validateCompetitiveBenchmarkCandidate(candidate),
    /benchmark|sample|样本|对标/u,
  );
});

test('公共观察必须有来源且不能把推断冒充事实', () => {
  if (!loaded.module) return;
  const missingSource = validCandidate();
  missingSource.evidence[0].sourceReference = '';
  assert.throws(
    () => loaded.module.validateCompetitiveBenchmarkCandidate(missingSource),
    /source|来源/u,
  );
  const inferredOnly = validCandidate();
  inferredOnly.benchmarks[0].evidenceRefs = ['ev-inference'];
  assert.throws(
    () => loaded.module.validateCompetitiveBenchmarkCandidate(inferredOnly),
    /fact|事实|evidence/u,
  );
});

test('拒绝照抄、品牌混淆、侵权和越权改写价格或定位', () => {
  if (!loaded.module) return;
  for (const field of [
    'copiesName',
    'copiesSlogan',
    'copiesCoreCopy',
    'copiesVisualIdentity',
    'copiesCases',
  ]) {
    const candidate = validCandidate();
    candidate.insights[0].antiCopyChecks[field] = true;
    assert.throws(
      () => loaded.module.validateCompetitiveBenchmarkCandidate(candidate),
      /copy|照抄|brand|品牌|risk|风险/u,
    );
  }
  const price = validCandidate();
  price.boundaryChecks.changesPricePolicy = true;
  assert.throws(
    () => loaded.module.validateCompetitiveBenchmarkCandidate(price),
    /boundary|边界|change|修改/u,
  );
});

export function validCandidate() {
  return {
    schemaVersion: 1,
    capabilityId: 'competitive-benchmark-analysis',
    enterpriseId: 'demo-enterprise',
    taskId: '20260728-002-benchmark-test',
    status: 'candidate',
    knowledgeContext: {
      status: 'matched',
      evidencePath: 'tasks/demo/evidence/knowledge_context.json',
    },
    scope: {
      growthOpportunityRef: 'opp-001',
      objective: 'identify transferable acquisition mechanisms',
      productOrService: 'business training',
      region: 'China',
      timeRange: '2026-Q3',
      brandBriefVersion: 'brand-brief-v1',
      constraints: ['do not copy competitor assets'],
    },
    evidence: [
      evidence('ev-a', 'public_source', 'Competitor A uses diagnostic content', 'https://example.com/a'),
      evidence('ev-b', 'public_source', 'Competitor B uses webinar signup', 'https://example.com/b'),
      evidence('ev-c', 'public_source', 'Competitor C uses case-led education', 'https://example.com/c'),
      evidence('ev-alt', 'public_source', 'Alternative D uses cohort previews', 'https://example.com/d'),
      evidence('ev-inference', 'inference', 'A bounded diagnostic webinar may transfer', 'ev-a+ev-b'),
    ],
    benchmarks: [
      benchmark('bench-a', 'direct', ['ev-a']),
      benchmark('bench-b', 'direct', ['ev-b']),
      benchmark('bench-c', 'direct', ['ev-c']),
      benchmark('bench-alt', 'alternative', ['ev-alt']),
    ],
    insights: [
      {
        id: 'insight-001',
        evidenceRefs: ['ev-a', 'ev-b', 'ev-inference'],
        transferableMechanism: 'diagnostic content to voluntary webinar signup',
        ownBrandAdaptation: 'use the approved brand promise and original examples',
        whyFit: 'the enterprise already has content and webinar capability',
        doNotCopy: ['names', 'slogans', 'visual identity', 'cases'],
        antiCopyChecks: {
          copiesName: false,
          copiesSlogan: false,
          copiesCoreCopy: false,
          copiesVisualIdentity: false,
          copiesCases: false,
          brandConfusionRisk: 'none',
          intellectualPropertyRisk: 'none',
        },
        unknowns: ['competitor conversion and economics are unknown'],
      },
    ],
    experiments: [
      {
        id: 'experiment-001',
        insightRef: 'insight-001',
        hypothesis: 'original diagnostic content can raise webinar signup',
        method: 'test two original content routes with one approved CTA',
        metric: 'signup rate by delivered message',
        target: 'at least 20 percent relative improvement',
        maximumDays: 30,
        maximumCost: 'no paid media',
        stopConditions: ['complaints rise', 'brand review rejects the expression'],
      },
    ],
    boundaryChecks: {
      changesEnterpriseStrategy: false,
      changesBrandPositioning: false,
      changesPricePolicy: false,
      changesDealRules: false,
    },
    collaborationRequests: [
      {
        targetOrganization: 'ai-brand-officer',
        reason: 'review brand confusion and protected expression risk',
      },
    ],
    review: {
      baselineMetrics: ['current webinar signup rate'],
      reviewAt: '2026-09-30T00:00:00.000Z',
      decisionRules: ['expand only after success', 'stop after failed validation'],
    },
  };
}

function evidence(id, type, claim, sourceReference) {
  return {
    id,
    type,
    claim,
    sourceReference,
    observedAt: '2026-07-28T00:00:00.000Z',
    appliesTo: 'publicly observable benchmark sample',
  };
}

function benchmark(id, kind, evidenceRefs) {
  return {
    id,
    name: id,
    kind,
    evidenceRefs,
    observedPositioning: 'observable public expression only',
    productStrategy: 'public offer structure only',
    contentMechanism: 'educational content',
    acquisitionChannels: ['public content'],
    observableCustomerPath: 'content to voluntary signup; later conversion is unknown',
    unknowns: ['revenue', 'conversion', 'private operating data'],
  };
}
