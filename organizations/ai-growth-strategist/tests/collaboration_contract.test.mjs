import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/collaboration_contract.mjs');

test('协作契约暴露请求与结果校验入口', () => {
  assert.equal(
    typeof loaded.module?.createCollaborationRequest,
    'function',
    loaded.error?.message ?? 'createCollaborationRequest missing',
  );
  assert.equal(typeof loaded.module?.validateCollaborationResult, 'function');
});

test('品牌、成交和组织协作保持增长战略官唯一主责', () => {
  if (!loaded.module) return;
  for (const [targetOrganization, requestedCapability] of [
    ['ai-brand-officer', 'brand-consistency-review'],
    ['ai-deal-officer', 'lead-handoff-review'],
    ['ai-organization-officer', 'growth-team-process'],
  ]) {
    const request = loaded.module.createCollaborationRequest(
      validRequest({ targetOrganization, requestedCapability }),
    );
    assert.equal(request.primaryOrganization, 'ai-growth-strategist');
    assert.equal(request.requestingOrganization, 'ai-growth-strategist');
    assert.equal(request.targetOrganization, targetOrganization);
    assert.equal(Object.isFrozen(request), true);
  }
});

test('协作拒绝自调用、越权主责、二次转派和无边界范围', () => {
  if (!loaded.module) return;
  assert.throws(
    () => loaded.module.createCollaborationRequest(validRequest({
      targetOrganization: 'ai-growth-strategist',
    })),
    /self|自调用/u,
  );
  assert.throws(
    () => loaded.module.createCollaborationRequest({
      ...validRequest(),
      primaryOrganization: 'ai-brand-officer',
    }),
    /primary|主责/u,
  );
  assert.throws(
    () => loaded.module.createCollaborationRequest({
      ...validRequest(),
      recursionDepth: 2,
    }),
    /depth|递归|转派/u,
  );
  assert.throws(
    () => loaded.module.createCollaborationRequest({
      ...validRequest(),
      scope: '全部处理并接管任务',
    }),
    /scope|范围/u,
  );
});

test('协作结果必须绑定同一企业、任务、请求和能力', () => {
  if (!loaded.module) return;
  const request = validRequest();
  const result = loaded.module.validateCollaborationResult({
    request,
    result: {
      schemaVersion: 1,
      contractVersion: 1,
      parentTaskId: request.parentTaskId,
      requestId: request.requestId,
      enterpriseId: request.enterpriseId,
      primaryOrganization: request.primaryOrganization,
      respondingOrganization: request.targetOrganization,
      requestedCapability: request.requestedCapability,
      status: 'completed',
      artifacts: [],
      evidence: [{ type: 'review', reference: 'review-001' }],
      assumptions: [],
      risks: [],
      unresolvedItems: [],
    },
  });
  assert.equal(result.status, 'completed');
  assert.throws(
    () => loaded.module.validateCollaborationResult({
      request,
      result: { ...result, enterpriseId: 'other-enterprise' },
    }),
    /enterprise|企业/u,
  );
});

function validRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    contractVersion: 1,
    parentTaskId: '20260728-001-growth-test',
    requestId: 'brand-review-001',
    enterpriseId: 'demo-enterprise',
    primaryOrganization: 'ai-growth-strategist',
    requestingOrganization: 'ai-growth-strategist',
    targetOrganization: 'ai-brand-officer',
    requestedCapability: 'brand-consistency-review',
    scope: '审核增长内容候选是否符合已确认品牌简报，不改写增长任务。',
    expectedOutcome: '返回一致性问题、证据、风险和未解决项。',
    evidenceRequirements: [
      '品牌简报版本',
      '候选内容引用',
      '审核结论证据',
    ],
    accessEnvelope: {
      enterpriseId: 'demo-enterprise',
      allowedScopes: ['growth.read'],
      deniedScopes: ['brand.formal.write'],
    },
    constraints: {
      maxDelegationDepth: 1,
      externalWriteAllowed: false,
    },
    recursionDepth: 1,
    status: 'requested',
    ...overrides,
  };
}
