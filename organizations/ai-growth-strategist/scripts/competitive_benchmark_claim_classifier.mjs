import { deepFreeze } from '../../../scripts/control-center/project_contract.mjs';
import { assertPlainData } from './strict_json.mjs';

const METRIC_PATTERNS = Object.freeze([
  ['conversion', /(?:转化(?:率)?|conversion(?:\s+rate)?)/iu],
  ['deal', /(?:成交(?:率|量|表现|能力|数据)?(?!规则|政策|路径|方法|动作|承诺|边界)|订单(?:量)?|销量|deal(?:\s+rate)?|orders?|sales\s+volume)/iu],
  ['revenue', /(?:营收|收入|月流水|流水|GMV|revenue|turnover|gross\s+merchandise\s+value)/iu],
  ['profit', /(?:利润|净利(?:润)?|profit|net\s+income)/iu],
  ['repurchase', /(?:复购(?:率)?|repeat\s+purchase(?:\s+rate)?|repurchase(?:\s+rate)?)/iu],
  ['roi', /(?:\bROI\b|return\s+on\s+investment)/iu],
  ['roas', /(?:\bROAS\b|return\s+on\s+ad\s+spend)/iu],
]);
const CONTEXTS = new Set([
  'fact',
  'public_fact',
  'scope_fact',
  'inference',
  'unknown',
  'private_unknown',
  'label',
  'hypothesis',
  'operational',
]);
const UNKNOWN_MARKER =
  /(?:未知|无公开证据|没有公开证据|无法判断|不能判断|待验证|待核验|未经验证|尚未验证|暂无数据|尚不清楚|未披露|未公开|unknown|unavailable|not\s+publicly\s+disclosed|no\s+public\s+evidence|cannot\s+(?:determine|verify)|to\s+be\s+verified)/iu;
const DENIAL_MARKER =
  /(?:而非|并非|不代表|不能证明|不得视为|不判断|不推断|禁止推断|not\s+(?:a\s+)?(?:fact|proof)|does\s+not\s+(?:mean|prove)|do\s+not\s+infer|must\s+not\s+infer)/iu;
const COMPETITOR_OR_EXTERNAL_SUBJECT =
  /(?:竞品|竞争对手|对手|同业|该竞品|替代样本|样本[A-D]|competitor|competitive\s+peer|peer|alternative\s+sample|sample\s*[A-D])/iu;
const DETERMINISTIC_RANKING_MARKER =
  /(?:领先|领跑|最高|最强|第一|冠军|头部|榜首|首位|称霸|傲视|遥遥领先|排名|leading|strongest|highest|best|number\s*one|no\.?\s*1|top(?:\s*\d+|\s+tier)?|dominat\w*|outperform\w*|ranks?\s+\w+)/iu;
const DIRECTIONAL_ASSERTION_MARKER =
  /(?:提高|改善|下降|增加|增长|减少|上升|下滑|变化|提升|降低|improv\w*|increas\w*|decreas\w*|grew|grow\w*|declin\w*|chang\w*)/iu;
const UNSAFE_OUTCOME_CLAIM_MARKER =
  /(?:王者|垄断|翻倍|赢得客户|控制市场|主导赛道|收割客户|击败对手|必然成交|double\s+customers?|win\s+customers?|control(?:s|led)?\s+the\s+market)/iu;
const DETERMINISTIC_VALUE_MARKER =
  /(?:\d+(?:\.\d+)?\s*(?:%|％|元|万元|亿元|万|亿|million|billion)?|百分之[零一二三四五六七八九十百]+)/iu;
const SAFE_YEAR_QUALIFIER =
  /(?:截至|截止|截至于)\s*(?:19|20)\d{2}\s*年|(?:as[\s-]*of|for)\s+(?:19|20)\d{2}\b/giu;
const UNSAFE_EDGE_RESIDUE =
  /^(?:[\p{S}+%/／-])|(?:[\p{S}+%/／-])$/u;
const UNSAFE_FREE_SYMBOL =
  /[\p{S}+%]/u;
const UNSAFE_STRUCTURAL_PUNCTUATION =
  /[()[\]{}（）【】]/u;
const PUBLIC_FACT_ATOMS = new Set([
  'D是不新增竞品式内容动作的显式替代方案',
  'D不新增竞品式内容动作',
  'D仅保留企业现有公开资料承接',
  'D保留企业现有公开资料承接',
  '不新增竞品式内容动作',
  '不新增公开渠道动作',
  '不引入竞品产品结构或价格动作',
  '只保留企业现有公开资料承接',
  '维持现状而不增加新的外部行动入口',
  '竞品A的官网公开课程目录',
  '公开售价为9.9元',
  'A每周公开3篇公众号文章',
  'B公开运营小红书清单内容',
  'C每月举办1场公开课',
  'A每周发布300篇公众号文章',
  'A每周3篇公众号文章并公开9.9元资料包',
  '每周3篇公众号文章',
  '公开9.9元资料包',
  'A同时公开公众号文章与资料包',
  'B每周5条小红书清单内容并引导私信',
  '每周5条小红书清单内容',
  '引导私信',
  'B公开清单内容并引导私信',
  'C每月1场公开课,官网有课程目录但价格未公开',
  '每月1场公开课',
  '官网有课程目录',
  'C举办公开课并公开官网课程目录',
  '公开动作围绕公众号文章与低门槛资料包',
  '存在公开9.9元资料包',
  '每周公开3篇公众号文章',
  '公开可观察渠道是公众号',
  '可观察路径为文章到公开资料包',
  '公开动作以小红书清单内容呈现',
  '题面没有公开产品或价格信息',
  '每周公开5条清单内容',
  '公开可观察渠道是小红书',
  '可观察路径为清单内容到用户主动私信',
  '公开课和官网课程目录共同出现',
  '官网公开课程目录但未公开价格',
  '每月公开1场公开课',
  '公开可观察渠道包括公开课和官网',
  '可观察路径为公开课或官网到课程目录',
  '该样本被定义为维持现有公开资料承接',
  'The competitor publishes three public posts weekly',
]);
const SCOPE_FACT_ATOMS = new Set([
  '替代样本D仅作为比较基线,不代表第四家市场主体',
  '替代样本D定义为“不新增竞品式内容动作,只保留企业现有公开资料承接”',
  '替代样本D是不新增竞品式内容动作、只保留企业现有公开资料承接的比较基线',
  'Alternative sample D is only a comparison baseline, not a fourth market actor',
]);
const MECHANISM_SUBJECTS = Object.freeze([
  '公开内容', '公开机制', '公开文章', '公开资料', '课程目录', '清单内容',
  '竞品A的公开内容', '样本A的公开内容', '样本B的公开内容',
  '样本C的公开内容', '替代样本D的公开资料',
  'Public content', 'Public mechanism', 'Competitor A public content',
]);
const MECHANISM_MODALS = Object.freeze([
  '可能', '可以', '可', ' may ', ' can ',
]);
const MECHANISM_VERBS = Object.freeze([
  '连接', '承接', '形成', '降低',
  'connect ', 'carry ', 'form ', 'reduce ',
]);
const MECHANISM_OBJECTS = Object.freeze([
  '公开资料入口', '可观察行动入口', '公开入口', '信息理解成本',
  'public entry', 'observable action entry', 'information comprehension cost',
]);
const MECHANISM_EXACT_STATEMENTS = new Set([
  '公开内容到许可式主动行动的企业内部增长机制',
  '可能以知识解释和低门槛自助产品承接需求',
  '资料包可能承担轻量验证或首次自主行动入口',
  '稳定频率可能形成重复认知和主题验证',
  '公众号可能承担存量读者的深度解释',
  '公开产品减少了用户理解下一步的摩擦',
  '可能突出快速扫描和收藏价值',
  '产品承接可能发生在用户主动私信之后',
  '高频清单可能降低阅读门槛并增加主题试验次数',
  '平台搜索和推荐可能共同带来公开曝光',
  '私信是意向表达入口而非成交事实',
  '可能强调系统知识和深度解释',
  '目录能够解释课程范围,但决策信息仍不完整',
  '长时内容可能用于集中解释复杂问题',
  '公开课可能吸引兴趣,官网承接进一步了解',
  '目录提供了下一步了解入口,但价格缺失可能增加询问环节',
  '它提供不新增内容机制的比较基线',
  '可以隔离内容机制与产品调整的影响',
  '作为控制条件可减少同时变化',
  '渠道保持不变有助于观察新增内容动作的增量',
  '它是实验控制路径,不代表最佳实践',
  '固定发布节奏可能形成稳定的信息接触',
  '公开资料包可能降低首次体验门槛',
  '文章与资料包组合可能连接解释与行动',
  '公众号公开内容可能提供可识别入口',
  '公开文章到公开资料包构成可观察路径',
  '清单结构可能降低信息扫描成本',
  '清单内容可能形成可复用的信息单元',
  '固定频率可能支持持续内容接触',
  '小红书公开内容可能提供可识别入口',
  '公开清单到私信引导构成可观察路径',
  '公开课可能集中解释复杂主题',
  '课程目录可能降低产品理解成本',
  '公开课与课程目录可能形成预览机制',
  '公开课与官网可能提供组合入口',
  '公开课到官网课程目录构成可观察路径',
  '现有公开资料可能形成低增量基线',
  '现有资料承接可能保留原有信息结构',
  '不新增动作可能隔离增量内容变量',
  '现有公开资料可能提供基础入口',
  '现有公开资料承接可作为新增机制的对照路径',
  '仅形成企业内部候选',
  '不改变企业战略、品牌定位、价格政策或成交规则',
  '同时公开内容频率、承接产品和价格,适合观察内容到自助行动的公开路径',
  '公开展示高频清单内容与私信入口,适合观察内容吸引和主动行动机制',
  '公开展示低频深度活动与官网课程目录,适合观察信任和产品信息承接',
  '作为不新增竞品式内容动作的显式替代方案,帮助识别新增机制的真实增量',
  '企业内部比较不新增竞品式内容动作的基线',
  '稳定发布结构化内容,并提供清晰的用户自主下一步',
  '企业内部制作公开内容与资料承接草案',
  '用重复主题验证建立认知,再把用户自主行动连接到可理解的公开承接信息',
  '底层机制是降低信息理解成本并形成可观察行动入口',
  '企业已有经营诊断知识内容,可原创重组为场景清单与公开说明,不需要复制竞品表达',
  '企业内部采用现有资料形成原创内容草案',
  '维持现有公开资料承接,不新增竞品式动作',
  '企业内部现有资料承接草案',
  '内部审核仅保留公开可观察动作',
  '企业内部保留私有表现未知',
  '内部审核确认观察时间不晚于参考时间',
  '企业内部保留当前来源绑定',
  '内部审核仅记录公开渠道动作',
  '企业内部保留渠道效果待验证',
  '内部审核仅记录最后一个公开步骤',
  '内部实验只使用模拟路径,不补造后续信息',
  'A按周发布文章并公开资料包,B按周发布清单并引导私信',
  '连续、结构化的公开内容可能形成稳定的信息入口',
  '连续公开内容可能形成稳定的信息入口',
  '结构化目录可能降低公开信息查找成本',
  '机制推断:固定发布节奏可能形成稳定的信息接触',
  '机制推断:不新增动作可能隔离增量内容变量',
  '机制推断:公开课到官网课程目录构成可观察路径',
  '机制推断:公开课可能集中解释复杂主题',
  '机制推断:公开课与官网可能提供组合入口',
  '机制推断:公开课与课程目录可能形成预览机制',
  '机制推断:公开清单到私信引导构成可观察路径',
  '机制推断:公开文章到公开资料包构成可观察路径',
  '机制推断:公开资料包可能降低首次体验门槛',
  '机制推断:公众号公开内容可能提供可识别入口',
  '机制推断:固定频率可能支持持续内容接触',
  '机制推断:课程目录可能降低产品理解成本',
  '机制推断:清单结构可能降低信息扫描成本',
  '机制推断:清单内容可能形成可复用的信息单元',
  '机制推断:文章与资料包组合可能连接解释与行动',
  '机制推断:现有公开资料承接可作为新增机制的对照路径',
  '机制推断:现有公开资料可能提供基础入口',
  '机制推断:现有公开资料可能形成低增量基线',
  '机制推断:现有资料承接可能保留原有信息结构',
  '机制推断:小红书公开内容可能提供可识别入口',
  '只读采集公开页面',
]);
const INTERNAL_HYPOTHESIS_SUBJECTS = Object.freeze([
  '企业内部未来实验',
  '未来企业内部实验',
  '本企业内部未来实验',
  '本公司内部未来实验',
  '我方内部未来实验',
  'Our company internal future experiment',
  'Enterprise internal future experiment',
]);
const INTERNAL_HYPOTHESIS_VERBS = Object.freeze([
  '测试', '比较', '测量', '复核', '验证',
  ' tests ', ' compares ', ' measures ', ' reviews ', ' verifies ',
]);
const INTERNAL_HYPOTHESIS_OBJECTS = Object.freeze([
  '原创内容草案', '原创资料承接结构', '内部方案', '内部任务完成率',
  '内部信息定位完成率', '内部阅读完成率', '内部路径',
  '原创场景清单与现状内部方案',
  'original content draft', 'internal draft', 'internal task result',
]);
const LEGACY_INTERNAL_HYPOTHESIS_EXACT = new Set([
  '企业内部未来实验验证原创资料承接结构是否改善内部任务完成率',
  '企业内部未来实验将比较原创主题卡片方案与现有公开资料承接方案的内部模拟路径完成数',
  '主指标达到目标且护栏无异常时申请扩大验证',
  '若后续获得同口径公开证据,按新版本追加,不覆盖当前候选',
]);
const UNKNOWN_GENERIC_NOUNS = Object.freeze([
  '客户路径', '渠道效果', '公开资料完整性', '内容节奏', '品牌认知',
  '用户反馈', '公开路径', '资料结构', '后台步骤', '公开信息',
  '公众认知', '完整结构', '渠道组合', '后台购买数据', '客户质量',
  '私信后的回复', '私信量', '有效咨询', '成本', '报名', '到场',
  '询盘', '报价', '成交路径', '购买后路径', '私域动作',
  'public path', 'channel effect', 'content rhythm', 'backend step',
  '客户具体如何理解其差异定位',
  '后续产品结构、交付成本和购买表现',
  '内容质量、阅读完成与主题差异',
  '渠道规模与新增来源',
  '目标人群与差异心智',
  '产品、价格与交付结构',
  '内容同质化程度与实际互动质量',
  '曝光来源与渠道有效性',
  '私信后的回复、转化和成交',
  '客户心智与差异认知',
  '价格、交付方式与购买条件',
  '报名、到场和内容质量',
  '流量来源与渠道有效性',
  '咨询、报价与成交路径',
  '现有资料的客户认知效果',
  '当前产品信息完整性',
  '当前内容基线表现',
  '现有渠道组合和有效性',
  '现有客户路径断点',
]);
const UNKNOWN_MARKERS_EXACT = Object.freeze([
  '未知', '无公开证据', '没有公开证据', '无法判断', '不能判断',
  '待验证', '待核验', '未经验证', '尚未验证', '暂无数据',
  '尚不清楚', '未披露', '未公开',
  ' is unknown', ' is unavailable', ' is not publicly disclosed',
  ' has no public evidence', ' is to be verified',
]);

export function classifyPrivatePerformanceText(text, options) {
  assertPlainData(options, 'private performance classifier options', {
    maxDepth: 2,
    maxNodes: 4,
    maxArrayLength: 0,
  });
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('private performance text is required');
  }
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || Reflect.ownKeys(options).length !== 1
    || !Object.hasOwn(options, 'context')
    || !CONTEXTS.has(options.context)
  ) {
    throw new Error('private performance classifier context is invalid');
  }

  const normalizedText = normalizeAuditText(text);
  const metricSpans = collectMetricSpans(normalizedText);
  const metrics = [...new Set(metricSpans.map((span) => span.metric))];
  const metricDetected = metrics.length > 0;
  const explicitUnknown = UNKNOWN_MARKER.test(normalizedText);
  const explicitDenial = DENIAL_MARKER.test(normalizedText);

  let prohibitedAssertion = false;
  if (
    (options.context === 'hypothesis' || options.context === 'operational')
    && COMPETITOR_OR_EXTERNAL_SUBJECT.test(normalizedText)
  ) {
    prohibitedAssertion = true;
  } else if (hasUnsafeEdgeResidue(
    trimTerminalPunctuation(normalizedText),
  )) {
    prohibitedAssertion = true;
  } else if (!metricDetected) {
    prohibitedAssertion = !isAllowedNoMetricStatement(
      normalizedText,
      options.context,
    );
  } else if (
    !isAllowedCompleteStatement(normalizedText, options.context)
    && !isSafeSlashUnknownSequence(normalizedText, options.context)
  ) {
    const segments = tokenizeMetricClauses(normalizedText);
    prohibitedAssertion = segments.length === 0
      || segments.some((segment) => (
        segment.kind !== 'clause'
        || !isAllowedSegment(segment.text, options.context)
      ));
  }

  return deepFreeze({
    metricDetected,
    explicitUnknown,
    explicitDenial,
    prohibitedAssertion,
    metrics,
  });
}

function normalizeAuditText(text) {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').trim();
}

function isAllowedNoMetricStatement(text, context) {
  const statement = trimTerminalPunctuation(text);
  if (
    !statement
    || hasUnsafeEdgeResidue(statement)
    || DETERMINISTIC_RANKING_MARKER.test(statement)
  ) {
    return false;
  }
  if (context === 'label') {
    return isSafeNoMetricLabel(statement);
  }
  if (
    context === 'unknown'
    || context === 'private_unknown'
  ) {
    return isSafeNoMetricUnknown(statement)
      || (
        context === 'unknown'
        && isSafeBrowserBoundaryStatement(statement)
      )
      || (
        context === 'private_unknown'
        && isSafePrivateUnknownBoundary(statement)
      );
  }
  if (context === 'public_fact' || context === 'fact') {
    return isSafePublicObservableFact(statement);
  }
  if (context === 'scope_fact') {
    return isSafeScopeFact(statement);
  }
  if (context === 'hypothesis') {
    return isSafeInternalNoMetricHypothesis(statement);
  }
  if (context === 'operational') {
    return isSafeInternalNoMetricHypothesis(statement)
      || isSafeInternalOperationalStatement(statement)
      || isSafeMechanismInference(statement);
  }
  return (
    isSafePublicObservableFact(statement)
    || isSafeMechanismInference(statement)
    || isSafeInternalOperationalStatement(statement)
    || isSafeInternalScopeDescription(statement)
    || isSafeBoundedGeneralInference(statement)
    || isSafeNoMetricUnknown(statement)
  );
}

function isSafePublicObservableFact(statement) {
  const canonical = canonicalRouteText(statement);
  return PUBLIC_FACT_ATOMS.has(canonical)
    || isSourceBoundPublicObservation(canonical);
}

function isSourceBoundPublicObservation(statement) {
  if (
    DETERMINISTIC_RANKING_MARKER.test(statement)
    || DIRECTIONAL_ASSERTION_MARKER.test(statement)
    || UNSAFE_FREE_SYMBOL.test(statement)
  ) {
    return false;
  }
  return /^(?=.{4,500}$)[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 .&'_-]{0,119}(?:公开页面|官方页面|官网公开页面|官网页面)(?:列出|展示|说明|提供|包含|设置|将)[\s\S]+$/u
    .test(statement);
}

function isSafeScopeFact(statement) {
  return SCOPE_FACT_ATOMS.has(canonicalRouteText(statement));
}

function isSafeNoMetricUnknown(statement) {
  const text = stripSafeYearQualifier(statement);
  return text !== null && parseGenericUnknown(text);
}

function isSafePrivateUnknownBoundary(statement) {
  return /^(?:企业现有|本企业|本公司|我方)[\s\S]*(?:后台|私有|经营数据)[\s\S]*(?:不进入本候选|不纳入本次|不作判断)$/u
    .test(statement);
}

function isSafeBrowserBoundaryStatement(statement) {
  return /^(?:本步骤未使用浏览器[,，]不生成timeline|browser\s+was\s+not\s+used\s+for\s+this\s+step[,;]?\s+no\s+timeline\s+was\s+generated)$/iu
    .test(statement);
}

function isSafeMechanismInference(statement) {
  const canonical = canonicalRouteText(statement);
  return MECHANISM_EXACT_STATEMENTS.has(canonical)
    || parseMechanismInference(canonical);
}

function isSafeBoundedGeneralInference(statement) {
  if (
    !statement
    || statement.length > 1_000
    || UNSAFE_FREE_SYMBOL.test(statement)
    || DETERMINISTIC_RANKING_MARKER.test(statement)
    || UNSAFE_OUTCOME_CLAIM_MARKER.test(statement)
    || UNSAFE_STRUCTURAL_PUNCTUATION.test(statement)
  ) {
    return false;
  }
  const bounded = /(?:仍待本企业内部未来实验验证|待本企业内部未来实验验证)$/u
    .test(statement)
    || /适合观察[\s\S]+$/u.test(statement)
    || /(?:可)?作为[\s\S]{1,80}基线$/u.test(statement)
    || /(?:不判断|不推断|只比较|仅记录|受限对标)/u.test(statement);
  const internal = /^(?:成都项目|本企业|本公司|我方|企业内部|本企业内部|项目|内部|原创|当前|本轮|后续)/u
    .test(statement);
  const observable = /^(?:公开|官方)(?:展示|说明|提供|列出|设置)[\s\S]+$/u
    .test(statement);
  const procedural = /^(?:用|把|让|按|由|只|不|在|为)/u
    .test(statement)
    && /(?:项目|企业|内部|原创|机制|路径|入口|场景|体验|任务|信息|内容|样本|验证|记录|对照|基线)/u
      .test(statement);
  return bounded || internal || observable || procedural;
}

function isSafeInternalOperationalStatement(statement) {
  if (
    /^(?:出现(?:品牌混淆|疑似复制|结构近似)标记|达到最长期限|达到未来企业内部成本上限|继续保持公开事实、推断与未知分栏|所有渠道判断只保留为待验证推断|未经帝王审批[,，]不执行任何外部动作|本步骤未使用浏览器[,，]不生成timeline)$/u
      .test(statement)
  ) {
    return true;
  }
  if (
    UNSAFE_FREE_SYMBOL.test(statement)
    || COMPETITOR_OR_EXTERNAL_SUBJECT.test(statement)
    || DETERMINISTIC_RANKING_MARKER.test(statement)
  ) {
    return false;
  }
  const chinese =
    /^(?=.{2,500}$)(?=[\s\S]*(?:企业|本企业|本公司|我方|内部|当前|现有|原创|主指标|护栏|版本|候选|来源|证据|成本上限|最大周期|期限|固定观察|实验|停止条件|匿名|许可范围|品牌混淆|制作|复盘|同口径))(?=[\s\S]*(?:比较|申请|停止|追加|覆盖|保持|分析|制作|测量|收集|复核|核验|采用|保留|限制|使用|形成|设计|完成|记录|采集|联系|触发|终止|维持|产生|到期|超过|投诉|扩大验证|没有|不新增|不判断|不覆盖|不采集|不联系))[\s\S]+$/u;
  const english =
    /^(?=.{2,700}$)(?=[\s\S]*(?:enterprise|company|our|internal|current|existing|original|guardrail|version|candidate|source|evidence|experiment|review|cost\s+limit))(?=[\s\S]*(?:compare|apply|stop|append|preserve|analyze|make|measure|collect|review|verify|use|design|record|terminate|retain))[\s\S]+$/iu;
  return chinese.test(statement) || english.test(statement);
}

function isSafeInternalScopeDescription(statement) {
  if (
    COMPETITOR_OR_EXTERNAL_SUBJECT.test(statement)
    || DETERMINISTIC_RANKING_MARKER.test(statement)
    || hasExternalOutcomeRisk(statement)
  ) {
    return false;
  }
  return /^(?:(?:两组|三组|同一组)?企业[\s\S]*(?:内容|课程|服务|资料|目标|范围|结构|机制|草案)|中国大陆公开中文渠道|固定(?:场景)?公开观察(?:场景)?|截至(?:19|20)\d{2}年\d{1,2}月\d{1,2}日的固定观察|brand-brief@\d+|只读研究[\s\S]*(?:不绕过登录|不自动发布|投放|联系客户)|不修改品牌定位、价格政策或成交规则|外部动作[:：]无)$/iu
    .test(statement);
}

function isSafeInternalNoMetricHypothesis(statement) {
  const canonical = canonicalRouteText(statement);
  return parseInternalHypothesis(canonical)
    || parseBoundedInternalHypothesis(canonical);
}

function parseBoundedInternalHypothesis(statement) {
  const subject = INTERNAL_HYPOTHESIS_SUBJECTS.find(
    (atom) => statement.startsWith(atom),
  );
  if (!subject) return false;
  const verb = INTERNAL_HYPOTHESIS_VERBS.find(
    (atom) => statement.startsWith(atom, subject.length),
  );
  if (!verb) return false;
  const body = statement.slice(subject.length + verb.length).trim();
  if (
    body.length < 2
    || body.length > 700
    || UNSAFE_FREE_SYMBOL.test(body)
    || DETERMINISTIC_RANKING_MARKER.test(body)
    || UNSAFE_OUTCOME_CLAIM_MARKER.test(body)
    || DETERMINISTIC_VALUE_MARKER.test(body)
    || UNSAFE_STRUCTURAL_PUNCTUATION.test(body)
  ) {
    return false;
  }
  return /(?:,)?待验证$/u.test(body);
}

function isSafeNoMetricLabel(statement) {
  return (
    statement.length <= 120
    && !COMPETITOR_OR_EXTERNAL_SUBJECT.test(statement)
    && !DETERMINISTIC_RANKING_MARKER.test(statement)
    && !DIRECTIONAL_ASSERTION_MARKER.test(statement)
    && !DETERMINISTIC_VALUE_MARKER.test(statement)
    && !UNSAFE_FREE_SYMBOL.test(statement)
    && /^(?:[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\s_-]*)$/u
      .test(statement)
  );
}

function hasExternalOutcomeRisk(statement) {
  return (
    COMPETITOR_OR_EXTERNAL_SUBJECT.test(statement)
    && (
      DETERMINISTIC_RANKING_MARKER.test(statement)
      || DIRECTIONAL_ASSERTION_MARKER.test(statement)
      || DETERMINISTIC_VALUE_MARKER.test(statement)
    )
  );
}

function hasUnsafeEdgeResidue(statement) {
  return UNSAFE_EDGE_RESIDUE.test(statement);
}

function isAllowedCompleteStatement(text, context) {
  const statement = trimTerminalPunctuation(text);
  if (
    !statement
    || hasUnsafeEdgeResidue(statement)
    || hasUnsafeValue(statement)
  ) {
    return false;
  }
  if (DETERMINISTIC_RANKING_MARKER.test(statement)) {
    return false;
  }
  if (isSafeUnknownStatement(statement)) {
    return true;
  }
  if (isSafeRelationshipDenial(statement)) {
    return true;
  }
  if (isSafeBoundaryDenial(statement)) {
    return context !== 'hypothesis'
      || !COMPETITOR_OR_EXTERNAL_SUBJECT.test(statement);
  }
  if (
    (context === 'hypothesis' || context === 'operational')
    && isSafeInternalFutureHypothesis(statement)
  ) {
    return true;
  }
  return context === 'label' && isSafeMetricLabel(statement);
}

function isAllowedSegment(text, context) {
  const segment = trimTerminalPunctuation(text);
  if (
    !segment
    || hasUnsafeEdgeResidue(segment)
    || hasUnsafeValue(segment)
  ) {
    return false;
  }
  if (DETERMINISTIC_RANKING_MARKER.test(segment)) {
    return false;
  }
  if (
    (context === 'hypothesis' || context === 'operational')
    && COMPETITOR_OR_EXTERNAL_SUBJECT.test(segment)
  ) {
    return false;
  }
  if (isSafeUnknownStatement(segment)) {
    return true;
  }
  if (isSafeRelationshipDenial(segment)) {
    return true;
  }
  if (isSafeBoundaryDenial(segment)) {
    return true;
  }
  if (
    (context === 'hypothesis' || context === 'operational')
    && isSafeInternalFutureHypothesis(segment)
  ) {
    return true;
  }
  return context === 'label' && isSafeMetricLabel(segment);
}

function isSafeUnknownStatement(statement) {
  const text = stripSafeYearQualifier(statement);
  if (text === null || DIRECTIONAL_ASSERTION_MARKER.test(text)) {
    return false;
  }
  if (DETERMINISTIC_RANKING_MARKER.test(text)) {
    return false;
  }

  const english = text.match(
    /^(?:no\s+public\s+evidence\s+for\s+(.+)|(?:cannot\s+(?:determine|verify)\s+)(.+)|both\s+(.+?)\s+and\s+(.+?)\s+are\s+(?:both\s+)?unknown|(.+?)\s+and\s+(.+?)\s+are\s+both\s+unknown|(.+?)\s+(?:is|are)\s+(?:unknown|unavailable|not\s+publicly\s+disclosed|to\s+be\s+verified))$/iu,
  );
  if (english) {
    const subjects = english.slice(1).filter(Boolean);
    return subjects.length > 0
      && subjects.every((subject) => isSafeUnknownSubject(subject));
  }

  const prefix = text.match(/^(?:无法判断|不能判断)\s*(.+)$/u);
  if (prefix) {
    return isSafeUnknownSubject(prefix[1]);
  }

  return isSafeChineseUnknownList(text);
}

function isSafeChineseUnknownList(text) {
  if (!UNKNOWN_MARKER.test(text)) {
    return false;
  }
  const parts = tokenizeUnknownList(text);
  if (parts.length === 0) {
    return false;
  }

  const pendingSubjects = [];
  let consumedUnknown = false;
  for (const part of parts) {
    const match = part.match(
      /^(.*?)(?:(?:明确)?(?:均|皆|都|全部)(?:为)?\s*)?(未知|无公开证据|没有公开证据|无法判断|不能判断|待验证|待核验|暂无数据|尚不清楚|未披露)$/u,
    );
    if (!match) {
      pendingSubjects.push(part);
      continue;
    }
    const subjects = [...pendingSubjects, match[1].trim()];
    pendingSubjects.length = 0;
    if (
      subjects.some((subject) => (
        !subject || !isSafeUnknownSubject(subject)
      ))
    ) {
      return false;
    }
    consumedUnknown = true;
  }
  return consumedUnknown && pendingSubjects.length === 0;
}

function tokenizeUnknownList(text) {
  const parts = [];
  let start = 0;
  let cursor = 0;
  const separators = ['以及', '、', '，', ',', '；', ';', '和', '与', '及'];
  while (cursor < text.length) {
    const separator = separators.find((item) => text.startsWith(item, cursor));
    if (!separator) {
      cursor += 1;
      continue;
    }
    const part = text.slice(start, cursor).trim();
    if (!part) return [];
    parts.push(part);
    cursor += separator.length;
    start = cursor;
  }
  const finalPart = text.slice(start).trim();
  if (!finalPart) return [];
  parts.push(finalPart);
  return parts;
}

function isSafeUnknownSubject(subject) {
  const value = subject.trim();
  if (
    !value
    || UNKNOWN_MARKER.test(value)
    || DENIAL_MARKER.test(value)
    || DIRECTIONAL_ASSERTION_MARKER.test(value)
    || DETERMINISTIC_RANKING_MARKER.test(value)
    || DETERMINISTIC_VALUE_MARKER.test(value)
  ) {
    return false;
  }
  return isStructuredMetricSubject(value)
    || /^(?:购买后路径|私域动作|后台购买数据|客户质量|私信后的回复|私信量|有效咨询|成本|报名|到场|询盘|报价|成交路径)$/u
      .test(value);
}

function isStructuredMetricSubject(subject) {
  const spans = collectMetricSpans(subject);
  if (spans.length !== 1) {
    return false;
  }
  const span = spans[0];
  const prefix = subject.slice(0, span.start).trim();
  const suffix = subject.slice(span.end).trim();
  const safePrefix = /^(?:(?:三家|所有样本|各样本|替代样本[A-D]|样本[A-D])(?:的)?\s*)?(?:(?:该)?(?:竞品|竞争对手|对手)(?:[A-D])?(?:的)?|其\s*)?(?:(?:私有|后台|真实|公开|现有|当前)\s*)*$/u;
  const safeEnglishPrefix =
    /^(?:(?:all|both|three|sample\s*[A-D]|alternative\s+sample\s*[A-D])(?:'s)?\s*)?(?:(?:the\s+)?(?:competitor|competitive\s+peer|peer)(?:\s*[A-D])?(?:'s)?|its\s*)?(?:(?:private|backend|actual|real|public|current)\s*)*$/iu;
  const safeSuffix =
    /^(?:表现|能力|数据|结果|水平|情况|状态|指标|路径)?$/u;
  const safeEnglishSuffix =
    /^(?:performance|capability|data|result|results|level|status|metric|metrics|path)?$/iu;
  return (
    (safePrefix.test(prefix) && safeSuffix.test(suffix))
    || (safeEnglishPrefix.test(prefix) && safeEnglishSuffix.test(suffix))
  );
}

function isSafeRelationshipDenial(statement) {
  const chinese = statement.match(
    /^(.+?)\s*(不代表|不能证明|并非|而非)\s*(.+)$/u,
  );
  if (chinese) {
    const [, left, operator, right] = chinese;
    if (
      isStructuredMetricSubject(left)
      && isStructuredMetricSubject(right)
    ) {
      return true;
    }
    if (
      operator === '不代表'
      && isStructuredMetricSubject(left)
      && /^(?:全部|整体|所有)?情况$/u.test(right.trim())
    ) {
      return true;
    }
    return statement === '私信是意向表达入口而非成交事实';
  }

  const english = statement.match(
    /^(.+?)\s+does\s+not\s+(?:mean|prove)\s+(.+)$/iu,
  );
  return Boolean(
    english
    && isStructuredMetricSubject(english[1])
    && isStructuredMetricSubject(english[2]),
  );
}

function isSafeBoundaryDenial(statement) {
  if (statement === '私信是意向表达入口而非成交事实') {
    return true;
  }
  const chinese = statement.match(
    /^(?:不|不得|禁止)(?:判断|推断|把|将)?\s*(.+)$/u,
  );
  if (chinese) {
    const body = chinese[1].replace(
      /(?:视为|当作|作为)(?:确定)?(?:事实|表现|结论)$/,
      '',
    );
    return isStructuredMetricSubject(body);
  }
  const english = statement.match(
    /^(?:do\s+not|must\s+not)\s+(?:infer|treat)\s+(.+?)(?:\s+as\s+(?:a\s+)?(?:fact|proof|conclusion))?$/iu,
  );
  return Boolean(english && isStructuredMetricSubject(english[1]));
}

function isSafeInternalFutureHypothesis(statement) {
  if (
    COMPETITOR_OR_EXTERNAL_SUBJECT.test(statement)
    || !/(?:内部|本企业|本公司|我方|internal|our\s+(?:company|enterprise|business))/iu.test(statement)
    || !/(?:未来|future)/iu.test(statement)
    || !/(?:实验|experiment)/iu.test(statement)
  ) {
    return false;
  }
  const chinese = statement.match(
    /^(?:企业)?内部未来实验假设(?:本企业|本公司|我方)(.+?)(?:可能|预计|预期|将|拟)(?:提高|下降|改善|变化|增加|减少)(?:，|,)?待内部验证$/u,
  ) ?? statement.match(
    /^未来内部实验假设(?:本企业|本公司|我方)(.+?)(?:可能|预计|预期|将|拟)(?:提高|下降|改善|变化|增加|减少)(?:，|,)?待内部验证$/u,
  );
  if (chinese) {
    return isStructuredMetricSubject(chinese[1]);
  }
  const english = statement.match(
    /^(?:the\s+)?(?:company|enterprise|our\s+business)\s+internal\s+future\s+experiment\s+hypothesizes\s+(?:our\s+)?(.+?)\s+(?:may|might|could|would)\s+(?:improve|increase|decrease|change)(?:,\s*)?to\s+be\s+internally\s+verified$/iu,
  );
  return Boolean(english && isStructuredMetricSubject(english[1]));
}

function isSafeMetricLabel(statement) {
  const value = statement.replace(
    /^(?:内部|未来|实验|主|次要|风险|护栏|基线|目标)\s*/,
    '',
  ).replace(
    /^(?:internal|future|experiment|primary|secondary|risk|guardrail|baseline|target)\s+/iu,
    '',
  );
  return isStructuredMetricSubject(value);
}

function stripSafeYearQualifier(statement) {
  const matches = [...statement.matchAll(SAFE_YEAR_QUALIFIER)];
  const digits = statement.match(/\d{4}/gu) ?? [];
  if (digits.length > 0 && matches.length !== digits.length) {
    return null;
  }
  return statement.replace(SAFE_YEAR_QUALIFIER, ' ').replace(/\s+/gu, ' ').trim();
}

function hasUnsafeValue(statement) {
  const withoutSafeYears = stripSafeYearQualifier(statement);
  return withoutSafeYears === null
    || DETERMINISTIC_VALUE_MARKER.test(withoutSafeYears);
}

function trimTerminalPunctuation(text) {
  return text.trim().replace(/[.。!?！？;；\s]+$/gu, '');
}

function canonicalRouteText(text) {
  return trimTerminalPunctuation(text)
    .replace(/，/gu, ',')
    .replace(/[’‘]/gu, '’')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseMechanismInference(statement) {
  const subject = [...MECHANISM_SUBJECTS]
    .sort((left, right) => right.length - left.length)
    .find((atom) => statement.startsWith(atom));
  if (!subject) return false;
  let cursor = subject.length;
  const modal = MECHANISM_MODALS.find(
    (atom) => statement.startsWith(atom, cursor),
  );
  if (!modal) return false;
  cursor += modal.length;
  const verb = MECHANISM_VERBS.find(
    (atom) => statement.startsWith(atom, cursor),
  );
  if (!verb) return false;
  cursor += verb.length;
  const object = [...MECHANISM_OBJECTS]
    .sort((left, right) => right.length - left.length)
    .find((atom) => statement.startsWith(atom, cursor));
  if (!object) return false;
  cursor += object.length;
  const ending = [',待验证', '待验证', ', to be verified', ' to be verified']
    .find((atom) => statement.startsWith(atom, cursor));
  if (!ending) return false;
  cursor += ending.length;
  return cursor === statement.length;
}

function parseInternalHypothesis(statement) {
  if (LEGACY_INTERNAL_HYPOTHESIS_EXACT.has(statement)) return true;
  const subject = INTERNAL_HYPOTHESIS_SUBJECTS.find(
    (atom) => statement.startsWith(atom),
  );
  if (!subject) return false;
  let cursor = subject.length;
  const verb = INTERNAL_HYPOTHESIS_VERBS.find(
    (atom) => statement.startsWith(atom, cursor),
  );
  if (!verb) return false;
  cursor += verb.length;
  const object = [...INTERNAL_HYPOTHESIS_OBJECTS]
    .sort((left, right) => right.length - left.length)
    .find(
    (atom) => statement.startsWith(atom, cursor),
  );
  if (!object) return false;
  cursor += object.length;
  let verifiedEnding = false;
  for (const ending of [',待验证', '待验证', ', to be verified', ' to be verified']) {
    if (statement.startsWith(ending, cursor)) {
      cursor += ending.length;
      verifiedEnding = true;
      break;
    }
  }
  return verifiedEnding && cursor === statement.length;
}

function parseGenericUnknown(statement) {
  const normalized = normalizeStructuredQuotes(statement);
  if (normalized === null) return false;
  const marker = UNKNOWN_MARKERS_EXACT.find(
    (candidate) => normalized.endsWith(candidate),
  );
  if (!marker) return false;
  const subjectAndNoun = normalized.slice(0, -marker.length).trim();
  const noun = [...UNKNOWN_GENERIC_NOUNS]
    .sort((left, right) => right.length - left.length)
    .find(
    (candidate) => subjectAndNoun.endsWith(candidate),
  );
  if (!noun) {
    return isSafeGeneralUnknownSubject(subjectAndNoun);
  }
  const subject = subjectAndNoun.slice(0, -noun.length).trim();
  return subject === '' || isStructuredGenericSubject(subject);
}

function isSafeGeneralUnknownSubject(value) {
  if (
    !value
    || value.length > 500
    || UNSAFE_FREE_SYMBOL.test(value)
    || DETERMINISTIC_RANKING_MARKER.test(value)
    || UNSAFE_OUTCOME_CLAIM_MARKER.test(value)
    || DETERMINISTIC_VALUE_MARKER.test(value)
    || UNSAFE_STRUCTURAL_PUNCTUATION.test(value)
    || /(?:但是|但|然而|不过|却|actually|in\s+fact|yet|although|however)/iu
      .test(value)
  ) {
    return false;
  }
  return /^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 .&'_,，、的和与及到从各类真实仍尚当前本地之间后前均-]*$/u
    .test(value);
}

function normalizeStructuredQuotes(statement) {
  let text = statement;
  const leftCount = [...text].filter((char) => char === '“').length;
  const rightCount = [...text].filter((char) => char === '”').length;
  if (leftCount !== rightCount || leftCount > 1) return null;
  if (leftCount === 1) {
    const match = /^“(竞品[A-D]|样本[A-D]|替代样本[A-D])”(的)?/u.exec(text);
    if (!match) return null;
    text = `${match[1]}${match[2] ?? ''}${text.slice(match[0].length)}`;
  }
  return text;
}

function isStructuredGenericSubject(subject) {
  return /^(?:三家样本(?:的)?|所有样本(?:的)?|各样本(?:的)?|样本[A-D](?:的)?|替代样本[A-D](?:的)?|竞品[A-D](?:的)?|竞争对手[A-D](?:的)?|all samples|three samples|Alternative sample [A-D](?:'s|’s)?|Competitor [A-D](?:'s|’s)?)$/iu
    .test(subject);
}

function isSafeSlashUnknownSequence(text, context) {
  const separator = ' / ';
  const first = text.indexOf(separator);
  if (first <= 0 || first !== text.lastIndexOf(separator)) return false;
  const left = trimTerminalPunctuation(text.slice(0, first));
  const right = trimTerminalPunctuation(
    text.slice(first + separator.length),
  );
  if (!left || !right) return false;
  if (
    (context === 'hypothesis' || context === 'operational')
    && (
      COMPETITOR_OR_EXTERNAL_SUBJECT.test(left)
      || COMPETITOR_OR_EXTERNAL_SUBJECT.test(right)
    )
  ) {
    return false;
  }
  return isSafeUnknownStatement(left) && isSafeUnknownStatement(right);
}

function tokenizeMetricClauses(text) {
  const tokens = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const connector = matchConnectorAt(text, cursor);
    const char = text[cursor];
    if (connector || isMetricClauseSeparator(char)) {
      const raw = text.slice(start, cursor);
      const clause = trimTerminalPunctuation(raw);
      if (!clause) return [];
      tokens.push({
        kind: 'clause',
        text: clause,
        start,
        end: cursor,
      });
      cursor += connector?.length ?? 1;
      start = cursor;
      continue;
    }
    if (isForbiddenResidualCharacter(char)) return [];
    cursor += 1;
  }
  const raw = text.slice(start);
  const clause = trimTerminalPunctuation(raw);
  if (!clause) return [];
  tokens.push({
    kind: 'clause',
    text: clause,
    start,
    end: text.length,
  });
  return tokens;
}

function matchConnectorAt(text, cursor) {
  for (const connector of [
    '但是', '可是', '不过', '然而', 'although', 'however',
    'actually', 'in fact', 'yet', 'but', '却', '但',
  ]) {
    if (text.startsWith(connector, cursor)) return connector;
  }
  return null;
}

function isMetricClauseSeparator(char) {
  return ['。', '！', '？', '!', '?', '；', ';']
    .includes(char);
}

function isForbiddenResidualCharacter(char) {
  return /[\/／|｜（）()【】\[\]《》〈〉，,、：:\n\r\p{S}+%]/u.test(char);
}

function collectMetricSpans(text) {
  const matches = [];
  for (const [metric, pattern] of METRIC_PATTERNS) {
    const flags = pattern.flags.includes('g')
      ? pattern.flags
      : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(matcher)) {
      matches.push({
        metric,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  matches.sort((left, right) => (
    left.start - right.start
    || right.end - left.end
    || left.metric.localeCompare(right.metric)
  ));
  const spans = [];
  for (const match of matches) {
    const previous = spans[spans.length - 1];
    if (previous && match.start < previous.end) {
      continue;
    }
    spans.push(match);
  }
  return spans;
}
