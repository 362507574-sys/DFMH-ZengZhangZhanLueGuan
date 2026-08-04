import { deepFreeze } from '../../../scripts/control-center/project_contract.mjs';
import { classifyPrivatePerformanceText } from './competitive_benchmark_claim_classifier.mjs';
import { assertPlainData } from './strict_json.mjs';

const COPY_FIELDS = Object.freeze([
  'copiesName',
  'copiesSlogan',
  'copiesCoreCopy',
  'copiesVisualIdentity',
  'copiesCases',
]);

export function diagnoseSampleSet(value) {
  const input = readInput(value, 'sample set diagnostic');
  const samples = denseArray(input.samples, 'samples');
  const direct = samples.filter((item) => item?.kind === 'direct').length;
  const alternative = samples.filter(
    (item) => item?.kind === 'alternative',
  ).length;
  if (direct !== 3 || alternative !== 1 || samples.length !== 4) {
    if (alternative === 0) {
      return result(
        'missing_alternative_sample',
        'warning',
        null,
        '样本只有直接竞品，缺少显式替代方案。',
        '增加一个能解决同一客户问题的替代方案；无法补齐时标记受限对标。',
      );
    }
    return result(
      'invalid_sample_mix',
      'blocking',
      null,
      '样本必须严格为三个直接竞品和一个替代方案。',
      '删除额外样本或补齐缺失类型后重新诊断。',
    );
  }
  return result(
    'ok',
    'info',
    null,
    '样本包含三个直接对象和一个显式替代方案。',
    '进入公开来源校验。',
  );
}

export function diagnoseSource(value) {
  const input = readInput(value, 'source diagnostic');
  const observed = canonicalTime(input.observedAt, 'observedAt');
  const reference = canonicalTime(input.referenceAt, 'referenceAt');
  if (
    !Number.isInteger(input.maximumAgeDays)
    || input.maximumAgeDays < 1
    || input.maximumAgeDays > 3_650
  ) {
    throw new Error('maximumAgeDays must be an integer from 1 to 3650');
  }
  const ageDays = (reference - observed) / 86_400_000;
  if (ageDays < 0) {
    return result(
      'future_source',
      'blocking',
      optionalSample(input.sampleId),
      '来源观察时间晚于受信任参考时间。',
      '拒绝该来源并重新核对时间戳与采集时间线。',
    );
  }
  if (ageDays > input.maximumAgeDays) {
    return result(
      'stale_source',
      'warning',
      optionalSample(input.sampleId),
      '公开来源超过允许时效，不能直接代表当前状态。',
      '在15秒有界采集窗口内重新核验；失败则保留旧来源并标记受限。',
    );
  }
  return result(
    'ok',
    'info',
    optionalSample(input.sampleId),
    '来源位于允许时效内。',
    '继续核对来源文件与SHA-256。',
  );
}

export function diagnoseClaim(value) {
  const input = readInput(value, 'claim diagnostic');
  if (typeof input.claim !== 'string' || !input.claim.trim()) {
    throw new Error('claim is required');
  }
  if (typeof input.publicEvidence !== 'boolean') {
    throw new Error('publicEvidence must be a boolean');
  }
  const classified = classifyPrivatePerformanceText(input.claim, {
    context: 'inference',
  });
  if (classified.prohibitedAssertion) {
    return result(
      'private_performance_claim',
      'blocking',
      optionalSample(input.sampleId),
      '私有转化、收入、利润或后台经营表现被写成确定结论。',
      '删除数字或确定性判断，改为未知；只有可核验公开证据才可作为事实。',
    );
  }
  return result(
    'ok',
    'info',
    optionalSample(input.sampleId),
    '结论没有把未公开经营表现伪装成事实。',
    '继续保持事实、推断与未知分层。',
  );
}

export function diagnoseTransfer(value) {
  const input = readInput(value, 'transfer diagnostic');
  if (COPY_FIELDS.some((field) => input[field] === true)) {
    return result(
      'copy_risk',
      'blocking',
      optionalSample(input.sampleId),
      '原创迁移包含名称、口号、核心文案、视觉身份或案例复制。',
      '退回机制层，重新设计企业原创实现并完成逐项反照抄检查。',
    );
  }
  if (
    input.brandConfusionRisk !== undefined
    && input.brandConfusionRisk !== 'none'
  ) {
    return result(
      'brand_confusion',
      'blocking',
      optionalSample(input.sampleId),
      '原创方案存在品牌混淆风险。',
      '停止候选并请求AI品牌官按固定版本复核。',
    );
  }
  if (
    input.intellectualPropertyRisk !== undefined
    && input.intellectualPropertyRisk !== 'none'
  ) {
    return result(
      'intellectual_property_risk',
      'blocking',
      optionalSample(input.sampleId),
      '原创方案存在知识产权风险。',
      '移除受保护表达、结构或资产后重新检查。',
    );
  }
  if (
    input.changesPricePolicy === true
    || input.changesDealRules === true
  ) {
    return result(
      'price_deal_boundary_change',
      'blocking',
      optionalSample(input.sampleId),
      '竞争迁移越权改变价格政策或成交规则。',
      '停止变更，只向AI成交官提交有界协作请求。',
    );
  }
  return result(
    'ok',
    'info',
    optionalSample(input.sampleId),
    '迁移没有复制、品牌混淆、知识产权或价格成交越界。',
    '进入原创有界实验。',
  );
}

export function diagnoseChannel(value) {
  const input = readInput(value, 'channel diagnostic');
  if (
    typeof input.present !== 'boolean'
    || typeof input.effectivenessEvidence !== 'boolean'
  ) {
    throw new Error('channel states must be booleans');
  }
  if (input.present && !input.effectivenessEvidence) {
    return result(
      'presence_is_not_effectiveness',
      'warning',
      optionalSample(input.sampleId),
      '观察到渠道存在，但没有公开证据证明渠道有效。',
      '只记录渠道存在，把有效性保留为未知并用企业实验验证。',
    );
  }
  return result(
    'ok',
    'info',
    optionalSample(input.sampleId),
    '渠道存在与有效性证据没有混淆。',
    '继续记录证据口径。',
  );
}

export function diagnoseObservablePath(value) {
  const input = readInput(value, 'observable path diagnostic');
  denseArray(input.publicSteps, 'publicSteps');
  if (typeof input.hasObservableNextStep !== 'boolean') {
    throw new Error('hasObservableNextStep must be a boolean');
  }
  if (!input.hasObservableNextStep) {
    return result(
      'observable_path_gap',
      'warning',
      optionalSample(input.sampleId),
      '公开客户路径在下一步行动处断层。',
      '停止推断私域或成交动作，只描述已经公开可观察的步骤。',
    );
  }
  return result(
    'ok',
    'info',
    optionalSample(input.sampleId),
    '公开可观察客户路径具有下一步行动。',
    '私域与后台成交仍保持未知。',
  );
}

function readInput(value, label) {
  assertPlainData(value, label, {
    maxDepth: 16,
    maxNodes: 500,
    maxArrayLength: 100,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function result(code, severity, affectedSample, explanation, recoveryAction) {
  return deepFreeze({
    code,
    severity,
    affectedSample,
    explanation,
    recoveryAction,
  });
}

function denseArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be dense`);
    }
  }
  return value;
}

function canonicalTime(value, label) {
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return Date.parse(value);
}

function optionalSample(value) {
  if (value === undefined || value === null) return null;
  return requireSafeId(value, 'sampleId');
}

function requireSafeId(value, label) {
  if (
    typeof value !== 'string'
    || !/^[a-z0-9][a-z0-9_-]{2,119}$/u.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
