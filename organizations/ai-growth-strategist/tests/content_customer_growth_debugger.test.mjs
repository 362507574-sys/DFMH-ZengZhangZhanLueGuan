import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/content_customer_growth_debugger.mjs',
);

test('内容客户增长调试器能诊断渠道与生命周期错位', () => {
  assert.equal(
    typeof loaded.module?.diagnoseContentLifecycle,
    'function',
    loaded.error?.message ?? 'diagnoseContentLifecycle missing',
  );
  if (!loaded.module) return;
  const result = loaded.module.diagnoseContentLifecycle({
    channel: 'permission-private-domain',
    lifecycleStage: 'anonymous-awareness',
    hasConsent: false,
    action: 'contact_customer',
  });
  assert.equal(result.code, 'consent_channel_stage_mismatch');
  assert.equal(result.severity, 'blocking');
});

test('调试器覆盖内容、同意、成交交接和复购阻断', () => {
  const {
    diagnoseContent,
    diagnoseConsent,
    diagnoseHandoff,
    diagnoseLifecycle,
    diagnoseRepurchase,
  } = loaded.module;
  assert.equal(
    diagnoseContent({ brandVersionMatches: false }).code,
    'stale_brand_version',
  );
  assert.equal(
    diagnoseContent({
      brandVersionMatches: true,
      channel: 'xiaohongshu',
      copiedFrom: 'short-video',
    }).code,
    'mechanical_cross_post',
  );
  assert.equal(
    diagnoseLifecycle({ signal: 'view', nextStage: 'explicit-inquiry' }).code,
    'passive_signal_is_not_inquiry',
  );
  assert.equal(
    diagnoseConsent({
      purpose: '许可内容培育',
      retentionDays: 30,
      optOutMechanism: '',
      automatedOutreach: false,
      contactAfterRefusal: false,
    }).code,
    'missing_opt_out',
  );
  assert.equal(
    diagnoseHandoff({ requiredFieldCount: 13 }).code,
    'incomplete_handoff',
  );
  assert.equal(
    diagnoseRepurchase({ activeComplaint: true, eligible: true }).code,
    'invalid_repurchase_eligibility',
  );
});

test('调试器拒绝高压销售、安全风险和未审批外部动作', () => {
  const {
    diagnoseContent,
    diagnoseConsent,
    diagnoseExternalAction,
  } = loaded.module;
  for (const [field, code] of [
    ['fakeScarcity', 'fake_scarcity'],
    ['hiddenFees', 'hidden_fees'],
    ['coercion', 'coercion'],
    ['fabricatedProof', 'fabricated_proof'],
  ]) {
    assert.equal(
      diagnoseContent({
        brandVersionMatches: true,
        [field]: true,
      }).code,
      code,
    );
  }
  assert.equal(
    diagnoseConsent({
      purpose: '许可内容培育',
      retentionDays: 30,
      optOutMechanism: '回复退出',
      automatedOutreach: false,
      contactAfterRefusal: true,
    }).code,
    'contact_after_refusal',
  );
  assert.equal(
    diagnoseExternalAction({
      action: 'publish_content',
      gate: 'approved',
      approvalId: 'approval-untrusted',
    }).code,
    'external_action_without_approval',
  );
});
