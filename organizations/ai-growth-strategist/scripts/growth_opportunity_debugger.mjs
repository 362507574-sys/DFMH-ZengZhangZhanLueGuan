import { deepFreeze } from '../../../scripts/control-center/project_contract.mjs';
import { assertPlainData } from './strict_json.mjs';

const RESULT_FIELDS = [
  'code',
  'severity',
  'field',
  'explanation',
  'recoveryAction',
];
const MARKET_SIZE_PATTERN = /(?:市场规模|行业规模|market size).*(?:\d|亿|万|百万|千万)/iu;
const ENGAGEMENT_SIGNALS = new Set([
  'views',
  'likes',
  'follows',
  'collections',
  'clicks',
]);

export function diagnoseOpportunity(value) {
  assertPlainData(value, 'opportunity diagnostic input', {
    maxArrayLength: 100,
    maxNodes: 1_000,
  });
  const input = plainInput(value, 'opportunity diagnostic');
  const evidenceRefs = optionalStringArray(input.evidenceRefs);
  if (
    typeof input.claim === 'string'
    && MARKET_SIZE_PATTERN.test(input.claim)
    && evidenceRefs.length === 0
  ) {
    return result(
      'unsupported_market_size',
      'blocking',
      'claim',
      '市场或行业规模没有可核验事实证据。',
      '删除规模结论，或补充带来源、时间和适用范围的可靠证据。',
    );
  }
  const demandSignals = optionalStringArray(input.demandSignals);
  const purchaseSignals = optionalStringArray(input.purchaseSignals);
  if (
    demandSignals.some((signal) => ENGAGEMENT_SIGNALS.has(signal))
    && purchaseSignals.length === 0
  ) {
    return result(
      'engagement_is_not_purchase_demand',
      'warning',
      'demandSignals',
      '阅读、浏览或互动不能直接等同购买需求。',
      '将结论降级为兴趣信号，并通过客户主动咨询等证据继续验证。',
    );
  }
  if (evidenceRefs.length === 0) {
    return result(
      'missing_fact_evidence',
      'blocking',
      'evidenceRefs',
      '机会判断缺少事实证据。',
      '至少补充一条企业事实、客户原话、行为数据或可靠公开来源。',
    );
  }
  if (input.correlationClaimedAsCausation === true) {
    return result(
      'causality_overclaim',
      'blocking',
      'correlationClaimedAsCausation',
      '相关行为被错误解释为因果关系。',
      '改写为待验证推断，并建立对照实验或补充归因证据。',
    );
  }
  if (input.boundaryChange === true) {
    return result(
      'boundary_change',
      'blocking',
      'boundaryChange',
      '机会候选改变了战略、品牌、价格或成交边界。',
      '停止当前变更并向对应组织发起有界协作请求。',
    );
  }
  if (input.experiment && typeof input.experiment === 'object') {
    const experimentDiagnosis = diagnoseExperiment({
      metric: input.experiment.metric,
      stopConditions: input.experiment.stopConditions,
      boundaryChange: input.boundaryChange === true,
    });
    if (experimentDiagnosis.code !== 'ok') return experimentDiagnosis;
  }
  return result(
    'ok',
    'info',
    'opportunity',
    '机会判断保留了证据、未知、边界和可测量实验。',
    '按计划进入吸引力与可信度双层评价。',
  );
}

export function diagnoseExperiment(value) {
  assertPlainData(value, 'experiment diagnostic input', {
    maxArrayLength: 100,
    maxNodes: 1_000,
  });
  const input = plainInput(value, 'experiment diagnostic');
  if (typeof input.metric !== 'string' || !input.metric.trim()) {
    return result(
      'unmeasurable_metric',
      'blocking',
      'experiment.metric',
      '实验没有可测量的主指标。',
      '定义带分母、口径和数据来源的主指标。',
    );
  }
  const stopConditions = optionalStringArray(input.stopConditions);
  if (stopConditions.length === 0) {
    return result(
      'missing_stop_condition',
      'blocking',
      'experiment.stopConditions',
      '实验没有停止条件。',
      '补充风险、样本、期限或成本停止条件。',
    );
  }
  if (input.boundaryChange === true) {
    return result(
      'boundary_change',
      'blocking',
      'experiment.boundaryChange',
      '实验要求改变组织职责或已确认经营边界。',
      '停止并向对应组织请求明确版本的边界输入。',
    );
  }
  return result(
    'ok',
    'info',
    'experiment',
    '实验具备主指标与停止条件。',
    '提交审批门禁；未获审批不得执行外部动作。',
  );
}

export function diagnoseAttractivenessSensitivity(value) {
  assertPlainData(value, 'attractiveness diagnostic input', {
    maxArrayLength: 100,
    maxNodes: 1_000,
  });
  const input = plainInput(value, 'attractiveness sensitivity diagnostic');
  if (!Number.isFinite(input.baseTotal)
    || !Number.isFinite(input.maximumAllowedDelta)
    || input.maximumAllowedDelta < 0) {
    throw new Error('sensitivity totals and maximumAllowedDelta are invalid');
  }
  const alternatives = numericArray(input.alternativeTotals);
  const maximumDelta = alternatives.reduce(
    (current, item) => Math.max(current, Math.abs(item - input.baseTotal)),
    0,
  );
  if (maximumDelta > input.maximumAllowedDelta) {
    return result(
      'score_sensitivity_high',
      'warning',
      'attractiveness',
      '机会优先级对合理评分变化过度敏感。',
      '并列展示敏感区间，先补证据，不用单一总分作确定结论。',
    );
  }
  return result(
    'ok',
    'info',
    'attractiveness',
    '合理评分变化没有改变机会判断的稳定性。',
    '保留敏感性记录并进入可信度评价。',
  );
}

function result(code, severity, field, explanation, recoveryAction) {
  const value = {
    code,
    severity,
    field,
    explanation,
    recoveryAction,
  };
  if (Object.keys(value).some((key, index) => key !== RESULT_FIELDS[index])) {
    throw new Error('diagnostic result field order is invalid');
  }
  return deepFreeze(value);
}

function plainInput(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function optionalStringArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('diagnostic signal arrays must contain text');
  }
  return [...value];
}

function numericArray(value) {
  if (!Array.isArray(value)
    || value.length === 0
    || value.some((item) => !Number.isFinite(item))) {
    throw new Error('alternativeTotals must be a non-empty numeric array');
  }
  return [...value];
}
