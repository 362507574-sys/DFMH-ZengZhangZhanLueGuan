import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/content_customer_growth_contract.mjs');

test('内容与客户增长契约暴露候选校验入口', () => {
  assert.equal(
    typeof loaded.module?.validateContentCustomerGrowthCandidate,
    'function',
    loaded.error?.message ?? 'validateContentCustomerGrowthCandidate missing',
  );
});

test('完整候选通过并深度冻结', () => {
  if (!loaded.module) return;
  const result = loaded.module.validateContentCustomerGrowthCandidate(validCandidate());
  assert.equal(result.dealHandoff.requiredFields.length, 14);
  assert.equal(Object.isFrozen(result.contentPlan[0]), true);
});

test('内容必须绑定有效品牌版本和事实证据', () => {
  if (!loaded.module) return;
  const noVersion = validCandidate();
  noVersion.contentPlan[0].brandBriefVersion = 'brand-brief-v0';
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthCandidate(noVersion),
    /brand|品牌|version|版本/u,
  );
  const inferredOnly = validCandidate();
  inferredOnly.contentPlan[0].evidenceRefs = ['ev-inference'];
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthCandidate(inferredOnly),
    /fact|事实|evidence|证据/u,
  );
});

test('拒绝无同意、无退出、自动外联和无限触达', () => {
  if (!loaded.module) return;
  for (const [field, invalid] of [
    ['required', false],
    ['refusalStopsContact', false],
    ['noAutomatedOutreach', false],
  ]) {
    const candidate = validCandidate();
    candidate.consentPolicy[field] = invalid;
    assert.throws(
      () => loaded.module.validateContentCustomerGrowthCandidate(candidate),
      /consent|同意|contact|联系|outreach|外联/u,
    );
  }
  const noOptOut = validCandidate();
  noOptOut.consentPolicy.optOutMechanism = '';
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthCandidate(noOptOut),
    /opt|退出|required/u,
  );
  const unlimited = validCandidate();
  unlimited.contentPlan[0].frequencyLimit = '';
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthCandidate(unlimited),
    /frequency|触达|required/u,
  );
});

test('成交交接必须包含完整版本化字段且不能泄露原始个人信息', () => {
  if (!loaded.module) return;
  const missing = validCandidate();
  missing.dealHandoff.requiredFields.pop();
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthCandidate(missing),
    /handoff|交接|required field|必填/u,
  );
  const rawPii = validCandidate();
  rawPii.dealHandoff.customerReferenceRule = 'include raw phone and email';
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthCandidate(rawPii),
    /PII|phone|email|个人|隐私/u,
  );
});

test('拒绝虚假稀缺、隐藏费用、胁迫和脆弱群体定向', () => {
  if (!loaded.module) return;
  for (const field of Object.keys(validCandidate().safetyChecks)) {
    const candidate = validCandidate();
    candidate.safetyChecks[field] = true;
    assert.throws(
      () => loaded.module.validateContentCustomerGrowthCandidate(candidate),
      /safety|安全|forbidden|禁止|risk|风险/u,
    );
  }
});

export function validCandidate() {
  return {
    schemaVersion: 1,
    capabilityId: 'content-customer-growth',
    enterpriseId: 'demo-enterprise',
    taskId: '20260728-003-content-growth-test',
    status: 'candidate',
    knowledgeContext: {
      status: 'matched',
      evidencePath: 'tasks/demo/evidence/knowledge_context.json',
    },
    scope: {
      growthOpportunityRef: 'opp-001',
      objective: 'grow voluntary webinar signup and nurture',
      channels: ['newsletter', 'public-content'],
      timeRange: '2026-Q3',
      constraints: ['no automated outreach', 'no paid media'],
    },
    evidence: [
      {
        id: 'ev-behavior',
        type: 'behavior_data',
        claim: 'diagnostic content click rate is above the current baseline',
        sourceReference: 'internal-content-report-q2',
        observedAt: '2026-07-28T00:00:00.000Z',
        appliesTo: 'existing consented newsletter audience',
      },
      {
        id: 'ev-inference',
        type: 'inference',
        claim: 'diagnostic education may improve voluntary webinar signup',
        sourceReference: 'ev-behavior',
        observedAt: '2026-07-28T00:00:00.000Z',
        appliesTo: 'bounded content experiment',
      },
    ],
    brandBrief: {
      version: 'brand-brief-v1',
      effectiveAt: '2026-07-28T00:00:00.000Z',
      valueProposition: 'help owners turn operating problems into actions',
      allowedClaims: ['explain observable methods and limits'],
      forbiddenClaims: ['guaranteed growth', 'guaranteed conversion'],
      reviewTriggers: ['new promise', 'new story', 'new visual identity', 'major campaign'],
    },
    contentPlan: [
      {
        id: 'content-001',
        channel: 'newsletter',
        audienceStage: 'aware',
        objective: 'voluntary webinar signup',
        evidenceRefs: ['ev-behavior', 'ev-inference'],
        format: 'diagnostic article',
        topic: 'three operating bottlenecks',
        callToAction: 'voluntary webinar signup',
        brandBriefVersion: 'brand-brief-v1',
        frequencyLimit: 'maximum two sends in fourteen days',
      },
    ],
    customerLifecycle: [
      {
        stage: 'aware',
        entrySignal: 'consented subscriber reads public content',
        allowedActions: ['show educational content'],
        exitSignal: 'voluntary signup or opt-out',
      },
      {
        stage: 'nurture',
        entrySignal: 'voluntary webinar signup',
        allowedActions: ['send consented event reminders'],
        exitSignal: 'qualified inquiry, inactivity, or opt-out',
      },
    ],
    consentPolicy: {
      required: true,
      purpose: 'deliver requested educational content and event reminders',
      retentionDays: 90,
      optOutMechanism: 'one-click unsubscribe and manual refusal record',
      refusalStopsContact: true,
      noAutomatedOutreach: true,
    },
    dealHandoff: {
      version: 'deal-handoff-v1',
      triggers: ['explicit request for consultation or quote'],
      nonTriggers: ['content view', 'click', 'passive attendance'],
      customerReferenceRule: 'use internal customer reference only; exclude raw PII',
      requiredFields: [
        'enterpriseId', 'taskId', 'handoffVersion', 'consentStatus',
        'consentPurpose', 'retentionUntil', 'optOutStatus', 'source',
        'touchpoints', 'customerReference', 'segmentNeedStage',
        'evidenceReferences', 'knownUnknowns', 'promisesLimitsRisksNextActions',
      ],
      feedbackFields: ['acceptedAt', 'rejectionReason', 'dealStage', 'outcome'],
    },
    repurchase: {
      eligibilitySignals: ['completed service and explicit interest'],
      exclusions: ['active complaint', 'opt-out', 'unresolved refund'],
      contentActions: ['send requested value review content'],
      dealHandoffTrigger: 'explicit renewal or repurchase inquiry',
    },
    experiments: [
      {
        id: 'experiment-001',
        hypothesis: 'evidence-led content may improve voluntary signup',
        method: 'test two original content topics with equal delivery conditions',
        metric: 'signup rate per delivered message',
        target: 'relative improvement of at least twenty percent',
        maximumDays: 30,
        maximumCost: 'no paid media',
        stopConditions: ['complaints rise', 'opt-out rate exceeds control'],
      },
    ],
    safetyChecks: {
      fakeScarcity: false,
      hiddenFees: false,
      coercion: false,
      vulnerableGroupTargeting: false,
      fabricatedProof: false,
    },
    boundaryChecks: {
      changesEnterpriseStrategy: false,
      changesBrandPositioning: false,
      changesPricePolicy: false,
      changesDealRules: false,
    },
    collaborationRequests: [
      {
        targetOrganization: 'ai-brand-officer',
        reason: 'review only when a brand review trigger is activated',
      },
      {
        targetOrganization: 'ai-deal-officer',
        reason: 'own explicit inquiry and return versioned outcome feedback',
      },
    ],
    review: {
      baselineMetrics: ['current signup and opt-out rates'],
      reviewAt: '2026-09-30T00:00:00.000Z',
      decisionRules: ['expand only after success', 'stop on safety or consent failure'],
    },
  };
}
