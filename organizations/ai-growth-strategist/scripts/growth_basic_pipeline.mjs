import {
  deepFreeze,
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';
import { EXTERNAL_ACTIONS } from './growth_experiment_manager.mjs';

const FULL_PIPELINE = Object.freeze([
  'growth-opportunity-analysis',
  'competitive-benchmark-analysis',
  'content-customer-growth',
]);
const STAGES = Object.freeze({
  'growth-opportunity-analysis': Object.freeze({
    skillId: 'growth-opportunity-analysis',
    requiredInputs: Object.freeze([
      'enterprise-goal',
      'available-evidence',
      'known-constraints',
    ]),
    outputArtifact: 'growth-opportunity-brief',
  }),
  'competitive-benchmark-analysis': Object.freeze({
    skillId: 'competitive-benchmark-analysis',
    requiredInputs: Object.freeze([
      'growth-opportunity-brief',
      'public-competitor-evidence',
    ]),
    outputArtifact: 'benchmark-mechanism-map',
  }),
  'content-customer-growth': Object.freeze({
    skillId: 'content-customer-growth',
    requiredInputs: Object.freeze([
      'growth-opportunity-brief',
      'benchmark-mechanism-map',
      'brand-brief',
      'deal-handoff-contract',
    ]),
    outputArtifact: 'content-customer-growth-plan',
  }),
});

export function selectGrowthPipeline(text) {
  const request = requiredRequest(text);
  const opportunityRequested = /(?:增长机会|市场趋势|用户需求|行业机会|增长空间)/u.test(request);
  const benchmarkRequested = /(?:竞品|对标|替代方案)/u.test(request);
  const contentRequested = /(?:内容与客户增长|内容增长|短视频|小红书|私域|客户培育|复购)/u.test(request);
  if (/(?:完整获客|完整增长|端到端增长|全链路获客)/u.test(request)) {
    return FULL_PIPELINE;
  }
  if (opportunityRequested && benchmarkRequested && contentRequested) {
    return FULL_PIPELINE;
  }
  if (opportunityRequested && benchmarkRequested) {
    return Object.freeze(FULL_PIPELINE.slice(0, 2));
  }
  if (benchmarkRequested && contentRequested) {
    return Object.freeze(FULL_PIPELINE.slice(1));
  }
  if (benchmarkRequested) {
    return Object.freeze(['competitive-benchmark-analysis']);
  }
  if (contentRequested) {
    return Object.freeze(['content-customer-growth']);
  }
  return Object.freeze(['growth-opportunity-analysis']);
}

export function createBasicGrowthPipeline({
  request,
  enterpriseId,
  businessProjectId,
  taskId,
} = {}) {
  const normalizedRequest = requiredRequest(request);
  const identity = {
    enterpriseId: requireEnterpriseId(enterpriseId),
    businessProjectId: requireBusinessProjectId(businessProjectId),
    taskId: requireSafeId(taskId, 'taskId'),
  };
  const selected = selectGrowthPipeline(normalizedRequest);
  const stages = selected.map((skillId) => ({
    ...STAGES[skillId],
    requiredInputs: [...STAGES[skillId].requiredInputs],
  }));
  const externalActions = [...EXTERNAL_ACTIONS].map((action) => ({
    action,
    gate: 'awaiting_approval',
    approvalId: null,
  }));
  return deepFreeze({
    schemaVersion: 1,
    mode: 'three-layer-baseline',
    request: normalizedRequest,
    identity,
    stages,
    safety: {
      projectIdentityLocked: true,
      evidenceRequired: true,
      organizationBoundariesLocked: true,
      automaticCustomerContact: false,
      externalActions,
    },
    acceptance: {
      normalScenarioRequired: true,
      keyRejectionsRequired: true,
      v1CompatibilityRequired: true,
      projectSelfCheckRequired: true,
      advancedIndependentProofDeferred: true,
    },
    status: 'designing',
    acceptsFormalTasks: false,
  });
}

function requiredRequest(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('growth request text is required');
  }
  const result = value.trim();
  if (result.length > 20_000) {
    throw new Error('growth request text exceeds size limit');
  }
  return result;
}
