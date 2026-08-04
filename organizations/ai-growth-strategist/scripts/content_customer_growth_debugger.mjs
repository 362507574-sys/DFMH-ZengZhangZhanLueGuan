import { deepFreeze } from '../../../scripts/control-center/project_contract.mjs';
import { assertPlainData } from './strict_json.mjs';

const PASSIVE_SIGNALS = new Set([
  'view', 'click', 'like', 'follow', 'collect', 'tool-download',
]);
const CHANNELS = Object.freeze([
  'short-video',
  'xiaohongshu',
  'permission-private-domain',
]);
const LIFECYCLE_STAGES = Object.freeze([
  'anonymous-awareness',
  'active-interest',
  'consented-nurture',
  'explicit-inquiry',
  'service',
  'repurchase-candidate',
]);

export function createContentCustomerGrowthDebugReport(candidate) {
  assertPlainData(candidate, 'content customer growth candidate', {
    maxDepth: 16,
    maxNodes: 30_000,
    maxArrayLength: 1_000,
  });
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('content customer growth candidate must be an object');
  }
  const input = candidate;
  const diagnostics = [];
  if (input.dealHandoff?.pricePolicyStatus === 'undecided') {
    diagnostics.push(result(
      'price_policy_not_finalized',
      'blocking',
      'pricePolicyStatus',
      '价格规则未定版。',
      '停止交接，等待 AI成交官固定价格规则。',
    ));
  }
  if (input.dealHandoff?.refundPolicyStatus === 'undecided') {
    diagnostics.push(result(
      'refund_policy_not_finalized',
      'blocking',
      'refundPolicyStatus',
      '退款规则未定版。',
      '停止交接，等待 AI成交官固定退款规则。',
    ));
  }
  if (diagnostics.length === 0) {
    diagnostics.push(result(
      'price-refund-confirmed',
      'info',
      'dealHandoff',
      '价格与退款规则已确认，仍不得由增长组织修改。',
      '任何变更重新进入成交组织和帝王审批。',
    ));
  }

  const channelLifecycleMatrix = [];
  for (const channel of CHANNELS) {
    for (const stage of LIFECYCLE_STAGES) {
      channelLifecycleMatrix.push(matrixCell(channel, stage));
    }
  }
  const blocked = diagnostics.some((item) => item.severity === 'blocking');
  return deepFreeze({
    status: blocked ? 'blocked' : 'passed_with_unknowns',
    channelLifecycleMatrix,
    diagnostics,
    remainingUnknowns: blocked
      ? ['价格或退款规则未定版，成交交接保持阻断']
      : ['外部动作实际效果尚未执行验证'],
  });
}

export function diagnoseContentLifecycle(value) {
  readInput(value, 'content lifecycle diagnostic');
  if (
    value?.channel === 'permission-private-domain'
    && value?.lifecycleStage === 'anonymous-awareness'
    && value?.hasConsent === false
    && value?.action === 'contact_customer'
  ) {
    return deepFreeze({
      code: 'consent_channel_stage_mismatch',
      severity: 'blocking',
      field: 'lifecycleStage',
      explanation: '匿名认知阶段且未取得同意时，不得进入许可私域联系客户。',
      recoveryAction: '停止触达；等待客户明确同意并进入许可培育阶段。',
    });
  }
  return deepFreeze({
    code: 'ok',
    severity: 'info',
    field: null,
    explanation: '渠道与生命周期阶段未发现冲突。',
    recoveryAction: '继续执行内部候选检查。',
  });
}

export function diagnoseContent(value) {
  const input = readInput(value, 'content diagnostic');
  if (input.brandVersionMatches === false) {
    return result(
      'stale_brand_version',
      'blocking',
      'brandArtifact',
      '内容绑定的品牌版本不是当前受信任版本。',
      '停止候选并重新绑定精确 brand-brief@version 与 SHA-256。',
    );
  }
  if (input.claimSupported === false) {
    return result(
      'unsupported_claim',
      'blocking',
      'proof',
      '内容主张没有允许承诺或事实证据支持。',
      '删除主张或补充受信任证据和允许承诺引用。',
    );
  }
  for (const [field, code, explanation] of [
    ['fakeScarcity', 'fake_scarcity', '候选制造了虚假稀缺。'],
    ['hiddenFees', 'hidden_fees', '候选隐藏了费用或收费条件。'],
    ['coercion', 'coercion', '候选使用了胁迫或高压成交表达。'],
    ['fabricatedProof', 'fabricated_proof', '候选伪造了证明、案例或口碑。'],
  ]) {
    if (input[field] === true) {
      return result(
        code,
        'blocking',
        field,
        explanation,
        '删除风险表达并退回品牌、证据和安全门禁重新检查。',
      );
    }
  }
  if (
    input.channel === 'xiaohongshu'
    && input.copiedFrom === 'short-video'
  ) {
    return result(
      'mechanical_cross_post',
      'warning',
      'channel',
      '小红书内容只是机械改写短视频，缺少渠道原创适配。',
      '按搜索场景、收藏价值和图文信息层级重新设计。',
    );
  }
  if (input.topicBusinessMismatch === true) {
    return result(
      'topic_business_mismatch',
      'warning',
      'topic',
      '选题与业务问题和增长目标脱节。',
      '退回增长机会与品牌证据重新选择主题。',
    );
  }
  if (input.ctaTooEarly === true) {
    return result(
      'cta_too_early',
      'warning',
      'cta',
      'CTA 早于客户阶段允许动作。',
      '改为客户可自主选择的低压力下一步。',
    );
  }
  if (input.frequencyFatigue === true) {
    return result(
      'frequency_fatigue',
      'warning',
      'frequencyLimit',
      '渠道频率超过产能或出现疲劳信号。',
      '降低频率并等待风险指标恢复。',
    );
  }
  if (input.trackingGap === true) {
    return result(
      'tracking_gap',
      'warning',
      'metrics',
      '指标缺少可追踪口径或数据回收方式。',
      '补充聚合口径、版本和数据来源后再执行。',
    );
  }
  return result(
    'ok',
    'info',
    'content',
    '内容保留了品牌版本、证据、渠道和阶段边界。',
    '继续进入审批门禁。',
  );
}

export function diagnoseLifecycle(value) {
  const input = readInput(value, 'lifecycle diagnostic');
  if (
    PASSIVE_SIGNALS.has(input.signal)
    && input.nextStage === 'explicit-inquiry'
  ) {
    return result(
      'passive_signal_is_not_inquiry',
      'blocking',
      'nextStage',
      '观看、点击、收藏等被动信号不能升级为明确询盘。',
      '保持匿名认知或主动兴趣，等待客户自主明确提出需求。',
    );
  }
  return result(
    'ok',
    'info',
    'lifecycle',
    '生命周期升级由明确客户信号驱动。',
    '继续检查许可和成交交接。',
  );
}

export function diagnoseConsent(value) {
  const input = readInput(value, 'consent diagnostic');
  if (typeof input.purpose !== 'string' || !input.purpose.trim()) {
    return result(
      'missing_consent_purpose',
      'blocking',
      'purpose',
      '同意没有说明用途。',
      '补充明确用途并重新取得同意。',
    );
  }
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1) {
    return result(
      'missing_retention',
      'blocking',
      'retentionDays',
      '同意没有有效保存期限。',
      '设定有界保存期限并在到期后停止。',
    );
  }
  if (
    typeof input.optOutMechanism !== 'string'
    || !input.optOutMechanism.trim()
  ) {
    return result(
      'missing_opt_out',
      'blocking',
      'optOutMechanism',
      '客户没有清晰退出机制。',
      '为每次触达提供可用退出方式。',
    );
  }
  if (input.contactAfterRefusal === true) {
    return result(
      'contact_after_refusal',
      'blocking',
      'contactAfterRefusal',
      '客户拒绝后仍被联系。',
      '立即停止并排除后续触达。',
    );
  }
  if (input.automatedOutreach === true) {
    return result(
      'automated_outreach',
      'blocking',
      'automatedOutreach',
      '候选包含自动外联或群发。',
      '关闭自动触达，任何联系单独进入审批。',
    );
  }
  return result(
    'ok',
    'info',
    'consent',
    '用途、期限、退出和拒绝即停完整。',
    '继续按许可渠道与频率执行内部候选。',
  );
}

export function diagnoseHandoff(value) {
  const input = readInput(value, 'handoff diagnostic');
  if (input.requiredFieldCount !== 14) {
    return result(
      'incomplete_handoff',
      'blocking',
      'requiredFields',
      '成交交接没有完整 14 项字段。',
      '按固定成交交接契约补齐并重新绑定上游版本与 SHA-256。',
    );
  }
  if (input.pricePolicyStatus === 'undecided') {
    return result(
      'price_policy_not_finalized',
      'blocking',
      'pricePolicyStatus',
      '价格规则未定版。',
      '停止交接，等待 AI成交官固定价格规则。',
    );
  }
  if (input.refundPolicyStatus === 'undecided') {
    return result(
      'refund_policy_not_finalized',
      'blocking',
      'refundPolicyStatus',
      '退款规则未定版。',
      '停止交接，等待 AI成交官固定退款规则。',
    );
  }
  return result(
    'ok',
    'info',
    'dealHandoff',
    '成交交接字段、版本和商业规则完整。',
    '仅在客户明确请求时交给 AI成交官。',
  );
}

export function diagnoseRepurchase(value) {
  const input = readInput(value, 'repurchase diagnostic');
  if (
    input.eligible === true
    && (
      input.activeComplaint === true
      || input.unresolvedRefund === true
      || input.deliveryIssue === true
      || input.optedOut === true
    )
  ) {
    return result(
      'invalid_repurchase_eligibility',
      'blocking',
      'eligible',
      '存在投诉、退款、交付或退出状态时不能进入复购候选。',
      '移出复购候选，先解决问题并等待客户自主提出进一步需求。',
    );
  }
  return result(
    'ok',
    'info',
    'repurchase',
    '复购资格与排除项没有冲突。',
    '保持不追购，客户主动请求后再交接。',
  );
}

export function diagnoseExternalAction(value) {
  const input = readInput(value, 'external action diagnostic');
  if (
    input.action
    && (
      input.gate !== 'awaiting_approval'
      || input.approvalId !== null
    )
  ) {
    return result(
      'external_action_without_approval',
      'blocking',
      'gate',
      '发布、付费、触达或外部写入绕过审批。',
      '停止动作并恢复 awaiting_approval，等待帝王单独验收。',
    );
  }
  return result(
    'ok',
    'info',
    'gate',
    '外部动作保持在审批门禁。',
    '未获审批不得执行。',
  );
}

function readInput(value, label) {
  assertPlainData(value, label, {
    maxDepth: 8,
    maxNodes: 200,
    maxArrayLength: 50,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function result(code, severity, field, explanation, recoveryAction) {
  return deepFreeze({
    code,
    severity,
    field,
    explanation,
    recoveryAction,
  });
}

function matrixCell(channel, stage) {
  if (stage === 'explicit-inquiry') {
    return {
      channel,
      stage,
      status: 'handoff_only',
      code: 'deal-handoff',
    };
  }
  if (stage === 'service') {
    return {
      channel,
      stage,
      status: 'limited',
      code: 'service-feedback',
    };
  }
  if (stage === 'repurchase-candidate') {
    return {
      channel,
      stage,
      status: 'handoff_only',
      code: 'repurchase-handoff',
    };
  }
  if (channel === 'permission-private-domain') {
    if (stage === 'consented-nurture') {
      return {
        channel,
        stage,
        status: 'approval_required',
        code: 'consent-and-approval',
      };
    }
    return {
      channel,
      stage,
      status: 'blocked',
      code: 'consent-required',
    };
  }
  return {
    channel,
    stage,
    status: 'allowed',
    code: 'public-content',
  };
}
