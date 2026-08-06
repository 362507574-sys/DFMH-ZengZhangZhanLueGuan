---
name: competitive-benchmark-analysis
description: Use when 企业需要比较直接竞品与替代方案的公开定位、产品策略、内容机制、获客渠道或可观察客户路径，并把机制转成原创有界实验时。
---

# 竞争对标拆解

## 帝王版成果输出

专业交付统一规则：只输出总控已经锁定的组织、技能和业务子项，不得因为“全部、全面、所有资料”等深度词自行扩大任务范围。一级标题按总控目录编号并去掉“技能”后缀，二级和三级标题沿用总控下发的编号与名称；每个二级业务子项的三级标题固定为“核心结论、数据与分析、经营建议”。四级标题仅在有助于阅读时使用，并按当前行业、地域、客群或经营问题动态命名，禁止把“关键变量、推导逻辑、已知事实、待验证信息、执行动作、验收指标、风险与停止条件”设为固定可见栏目。正文不设置固定凑字数指标，以事实密度、判断质量和行动价值验收；不得靠重复套话凑篇幅。核心结论直接回答当前对象的状态及经营含义；数据与分析必须真正给出数据、样本、对比、推导和经营影响，不得解释什么叫分析；经营建议必须写清取舍、动作、验收方式和停止条件。公开研究子项逐节至少提供2项有口径的量化事实和2个可追溯来源；任务给出地域时必须下沉到当地。禁止用“本节采用某分析链”等方法论自述、跨章节复制、模拟数字、通用模板或篇幅冒充专业深度。

强制执行 `shared/ORGANIZATION_AI_WORK_OWNERSHIP_STANDARD.md`。AI可自主完成的调研、检索、比较、测算、预算拆分、方案设计、指标反推和风险情景分析必须在本轮直接完成。经营建议是AI已经完成分析后的可执行方案，不是交给帝王的研究作业清单。只有企业内部未公开事实、现场物理条件、个人偏好与授权、正式报价或合同条件，才可作为帝王最少补充项。公开精确值暂不可得时，必须输出有依据的区间、假设、公式、敏感性分析和验证阈值，不得把AI职责改写成待办。
任务涉及设备、器械、车辆、工程设施或其他固定资产时，强制执行 `shared/CAPITAL_ASSET_PROCUREMENT_STANDARD.md`，逐项比较全新、二手和混合采购，按全生命周期成本给出金额、理由、风险和推荐结果。

唯一目录事实源为 `control-center/registries/organization-output-standard.json`。本技能在帝王版组织 Word 中固定使用一级章节“竞争对标拆解”，并严格按以下顺序输出：

1. 竞争对手定位
2. 产品策略
3. 内容打法
4. 获客渠道
5. 成交路径

每个栏目必须基于公开可核验的竞品事实，分别说明事实、专业判断和未知；不得推断竞品私有营收、利润、转化和成交表现。仍缺少可靠公开信息时写明：`信息不足，暂时无法形成可靠分析。当前缺少：<具体信息>。` 样本选择、机制迁移和原创实验融入对应栏目，不新增帝王版目录。

## 基础运行闭环（完整链路强制）

当控制中心选择 `growth-basic-pipeline`，或任务需要中断恢复、修改闭环、同组织下游流转、精确版本交接时，必须把 `organizations/ai-growth-strategist/scripts/growth_basic_run_manager.mjs` 作为唯一基础运行入口；不得用零散调用 `growth_run_store.mjs`、规划器、调试器或候选校验器代替运行管理。十四步对标制作与 v2 严格校验仍照常执行，校验通过后再把候选载荷提交给基础运行器。

固定顺序：

1. 使用控制中心锁定的 `enterpriseId`、`businessProjectId`、`taskId`、`runId` 与帝王原始大白话目标调用 `createBasicGrowthRunManager({ projectRoot })` 后执行 `start(...)`。
2. 原项目中断后优先调用 `status(...)`；也可用完全相同身份、任务和原始目标重复 `start(...)`。两者都恢复原运行与未完成事务，不得换 `runId`、新建运行或重跑已验证成果。
3. 当 `nextSkillId` 为 `competitive-benchmark-analysis` 时，先核对运行器固化的上游机会成果精确版本、相对路径与 SHA-256，再按十四步完成调试和 v2 候选校验；通过后调用 `submitStage(...)`，`skillId` 固定为 `competitive-benchmark-analysis`。运行器会把所有已完成上游成果自动固化到新成果的 `upstreamArtifacts`。
4. 若同一运行的 `nextSkillId` 为 `content-customer-growth`，就在原运行内沿用对标成果的精确版本继续，不调用跨组织交接。
5. 帝王要求替换已完成对标阶段的样本或修改机制时，可在基础运行仍为 `running_internal` 且下游尚未执行时处理，也可在 `reviewing` 审核态处理；重新完成受影响步骤、调试和相应候选校验，再调用 `reviseStage(...)` 并写明原因。必须产生新版本、保留旧版本，并使内容与客户增长等后续成果失效后重做，禁止原地覆盖；未完成的阶段不得调用修改入口。
6. 只有交给其他组织时才调用 `createHandoff(...)`；协作合同会拒绝把 AI增长战略官自身设为目标组织。交接只使用运行器返回的精确 `artifactId@version`、相对路径与 SHA-256，不引用 `current` 或“最新文件”。
7. 本次运行选定的全部技能完成且帝王最终验收后才调用 `accept(...)`；不得把候选校验通过、内部完成或外部动作待审批自动解释为验收。
8. 需要供严格下游读取时，只由控制中心在整条运行验收后调用 `growth_artifact_publication_bridge.mjs`；本技能提交的 `payload.publication` 精确包含非空普通对象 `mechanismMap`。控制中心先固化三成果共同的项目级正式版本，再发布机会简报并将对标成果依赖改绑到其正式版本与 SHA-256；中断后沿用同一发布计划恢复。

基础运行器的主状态为 `running_internal → reviewing → completed`；本 Skill 下方的 `planned / running / waiting_* / blocked / completed` 只描述十四步内部作业状态，不得拿它覆盖基础运行主状态或虚构批准接口。任何发布、投放、客户联系、价格、退款、品牌或成交动作仍保持阻断。

当前基础版的恢复粒度只到“技能阶段成果与验收事务”，没有十四步专用 checkpoint API；十四步中断时只能依据已保存的业务文件与 debug bundle 识别最后已验证步骤，不得声称基础运行器能自动恢复到某个内部步骤。运行目录候选仍不等于 `shared-artifacts` 正式成果；控制中心发布桥现已能在整条三技能运行完成帝王验收后生成精确机会正式版本，严格 v2 对标门禁已经验证可直接读取。未验收、部分重做或发布桥未返回正式绑定时仍停在内部候选。细粒度十四步恢复与真实企业验收尚未完成，组织继续保持 `designing / acceptsFormalTasks=false`。

## 核心原则

只把公开可核验内容写成事实。逐样本分开事实、推断和未知；私域动作、后台转化、收入、利润与真实成交表现默认未知。学习底层增长机制，不复制竞品资产，也不越权改写企业品牌、价格或成交规则。

## 输入

- 控制中心锁定的 `enterpriseId`、`businessProjectId`、`taskId`、`runId`；
- 已发布的 `growth-opportunity-brief@version`、真实文件路径与 SHA-256；
- 当前品牌 Brief 精确版本及禁止表达；
- 三个直接样本和一个显式替代方案的公开来源；不足时输出受限对标；
- 飞书知识检索凭证、业务目标、产品、地域、时间与成本限制。

## 依赖

- 读取 `organizations/ai-growth-strategist/workflows/COMPETITIVE_BENCHMARK_ANALYSIS.md`。
- 复用 `growth_planner.mjs`、`growth_run_store.mjs`、证据账本、实验管理器、审批门禁和恢复机制。
- 用 `competitive_benchmark_v2_contract.mjs`、`competitive_benchmark_planner.mjs`、`competitive_benchmark_debugger.mjs` 执行 v0.2 专属链路。
- 浏览器研究必须读取 `shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md`，通过 `scripts/browser_continuous_action_controller.mjs` 执行；`source-collection` 与 `source-validation` 在生产调用前必须通过 `validateBrowserResearchExecution`，只读公开页面并保存脱敏 timeline；不得绕过登录、验证码、付费墙或权限。
- 品牌混淆、价格成交边界和企业战略资源问题分别有界协作 AI品牌官、AI成交官和 AI掌舵官；主责仍是 AI增长战略官。

## 状态机

`planned → running → waiting_input | waiting_approval | blocked | completed`

- 每步开始前写运行状态、依赖版本和输入摘要。
- 中断后只恢复未完成步骤；已验证来源、实验草案和审批不得重复执行。
- 任一 blocking 诊断进入 `blocked`；外部发布、投放、客户联系、品牌承诺、价格或成交动作进入 `waiting_approval`。

## 执行链路

严格执行十四步，不合并、不换序：

1. `intake`：核对身份、知识凭证、上游版本和组织边界。
2. `sample-plan`：确定三个直接样本和一个显式替代方案；记录选择理由。
3. `source-collection`：只读采集公开来源，保存来源文件、观察时间、适用范围与 SHA-256。
4. `source-validation`：核对文件、时效、口径、链接和冲突；不足则降级。
5. `positioning`：拆公开竞争定位。
6. `product-strategy`：拆公开产品策略，不推断私有价格动作。
7. `content-mechanism`：拆内容为什么可能吸引客户。
8. `acquisition-channels`：记录渠道存在；没有效果证据时不得称渠道有效。
9. `observable-customer-path`：只写公开可观察路径；私域与后台保持未知。
10. `mechanism-transfer`：先从表面动作提炼底层机制。
11. `enterprise-adaptation`：判断企业适配条件并设计原创实现。
12. `copy-brand-ip-check`：执行反照抄、品牌混淆和知识产权检查。
13. `experiments`：建立期限、主指标、护栏指标、成本和停止条件完整的有界实验。
14. `approval`：只提交候选；未经帝王验收不得执行外部动作。

来源采集和来源校验各最多两次、每次15秒；其他分析步骤最多一次。网页失败不得用绕登录、盲目刷新或切换未授权服务作为回退。

## 五层拆解

每个样本都必须填写：

1. 公开竞争定位；
2. 公开产品策略；
3. 内容机制；
4. 获客渠道；
5. 可观察客户路径。

每层分别保存 `publicFacts`、`inferences`、`unknowns` 和 `evidenceRefs`。不得用发布频率、渠道存在或公开入口推断真实营收、利润、转化或成交能力。

## 原创迁移

按以下字段连续推导：

`surfaceAction → underlyingMechanism → enterpriseFit → originalImplementation → doNotCopy → antiCopyChecks → experiment`

`doNotCopy` 至少包含名称、口号、核心文案、视觉身份和案例。五项复制标记必须全为 `false`，品牌混淆与知识产权风险必须为 `none`。不得复制受保护课程结构、竞品价格动作或未公开成交方法。

## 调试包

调试记录至少包含：步骤、样本、证据引用、输入版本、诊断码、严重级别、解释、恢复动作、尝试次数和 browser timeline 路径。

固定诊断：

| 诊断码 | 级别 | 处理 |
| --- | --- | --- |
| `missing_alternative_sample` | warning | 补替代样本；不能补齐则标记受限 |
| `stale_source` | warning | 有界重新核验，失败则降低结论强度 |
| `future_source` | blocking | 拒绝未来时间并核对采集时间线 |
| `private_performance_claim` | blocking | 删除私有业绩断言并改为未知 |
| `presence_is_not_effectiveness` | warning | 只记录渠道存在 |
| `observable_path_gap` | warning | 停在最后一个公开步骤 |
| `copy_risk` | blocking | 返回机制层重新原创 |
| `brand_confusion` | blocking | 停止并请求 AI品牌官复核 |
| `intellectual_property_risk` | blocking | 移除受保护内容 |
| `price_deal_boundary_change` | blocking | 停止并请求 AI成交官协作 |

## 输出与门禁

输出样本计划、公开证据账本、五层矩阵、差异地图、机制迁移链、不可复制清单、原创实验、调试包、协作请求和复盘规则。

### 机器候选最小合同

以下是校验器的结构、类型、枚举和边界合同，不是固定场景答案。所有对象只允许列出的字段，所有数组必须是无空洞的普通数组。

- 顶层精确字段：`schemaVersion, capabilityId, enterpriseId, businessProjectId, taskId, runId, status, knowledgeContext, scope, evidence, samples, transfers, boundaryChecks, collaborationRequests, debugReport, review`。`schemaVersion` 是 JSON 数字 `2`，`capabilityId` 是字符串 `competitive-benchmark-analysis`，`status` 是字符串 `candidate`；四个身份字符串必须与控制中心外部传入的预期身份完全一致。
- 受信任参数不放进候选：控制中心必须外部传入 `expectedIdentity, projectRoot, expectedUpstream, expectedKnowledgeReceipt, referenceAt`；CLI 对应 `--expected-enterprise-id, --expected-business-project-id, --expected-task-id, --expected-run-id, --project-root, --expected-upstream-artifact-id, --expected-upstream-version, --expected-upstream-sha256, --expected-receipt-relative-path, --expected-receipt-status, --expected-receipt-sha256, --reference-at`。`expectedUpstream` 精确字段为 `artifactId, version, sha256`；`expectedKnowledgeReceipt` 精确字段为 `relativePath, status, sha256`，二者都只能来自控制中心可信上下文。
- `knowledgeContext` 精确字段：`status, evidencePath, evidenceSha256`，三项必须与外部 `expectedKnowledgeReceipt` 完全一致。`status` 只能是 `matched | degraded | no_hit`；`evidencePath` 必须是从 `projectRoot` 起算且以 `business-projects/<enterpriseId>/<businessProjectId>/` 开头的相对路径，并精确落在当前运行的 `evidence/knowledge-context.json`，不能写绝对路径、`..`、文件链接或联接目录；SHA-256 必须匹配真实普通文件。凭证 JSON 精确字段为 `schemaVersion, enterpriseId, businessProjectId, taskId, runId, capabilityId, status, query, sources, limitations`，其中 `schemaVersion` 为数字 `2`、身份和状态与候选一致；`sources` 是0至100项普通对象数组，每项精确字段为 `relativePath, sha256`，路径必须位于当前运行的 `evidence/knowledge-sources/`，不得是绝对路径、`..`、文件链接或联接目录，`sha256` 必须匹配该相对路径下真实普通文件的实际 UTF-8 字节。同路径替换内容即使 receipt 被重新签名也必须拒绝。`matched` 必须有至少1个真实普通匹配来源对象，`no_hit` 必须 `sources` 为空且有 `limitations`，`degraded` 必须有非空降级 `limitations`；若有来源，每项同样执行路径和实际字节 SHA 校验。
- `scope` 精确字段：`upstreamArtifact, objective, productOrService, region, timeRange, brandBriefVersion, constraints`，后五项为非空字符串，`constraints` 是至少1项的字符串数组。`upstreamArtifact` 精确字段为 `artifactId, version, sha256, path`：`artifactId` 必须是 `growth-opportunity-brief`，版本是大于等于1的整数，`path` 是从 `projectRoot` 起算、精确指向当前项目 `shared-artifacts/growth-opportunity-brief/v<version>.json` 的相对路径；不得为绝对路径、`..`、文件链接或联接目录。真实上游 JSON 精确字段为 `schemaVersion, artifactId, version, enterpriseId, businessProjectId, opportunity, status`，且必须为 schema数字 `1`、状态 `published`，身份、版本、文件 SHA-256 与外部预期上游完全一致。
- `evidence` 是4至200条。每条精确字段：`id, type, claim, sourcePath, sourceVersion, sourceSha256, observedAt, appliesTo`。`evidence.type` 只能是字符串 `public_fact` 或 `scope_fact`；`evidence.appliesTo` 必须是单个对应 `sampleId` 的字符串，不能写成数组；`observedAt` 是 ISO 时间且不能晚于外部 `referenceAt`；`sourcePath` 是从 `projectRoot` 起算并位于当前运行 `evidence/sources/` 内的相对路径，不得是绝对路径、`..`、文件链接或联接目录，SHA-256 必须匹配真实普通文件；`public_fact.claim` 的规范化文本必须能在绑定来源中找到，且不得包含来源没有的私有经营表现。
- `samples` 必须恰好4条：精确3条 `kind: direct` 与1条 `kind: alternative`。每条精确字段为 `id, name, kind, selectionReason, observedAt, evidenceRefs, layers, privateUnknowns`；`evidenceRefs` 至少1项且只能引用本候选证据；`privateUnknowns` 至少1项并必须显式写明未知、无公开证据、无法判断或待验证。
- `layers` 精确包含 `positioning, productStrategy, contentMechanism, acquisitionChannels, observableCustomerPath`。每层精确字段为 `publicFacts, inferences, unknowns, evidenceRefs`，四项都是非空数组；前三项是非空字符串数组，不能跨栏重复，`publicFacts` 不能含推断语气，任何私有经营指标的确定性断言都禁止，`unknowns` 必须显式未知；`evidenceRefs` 只能引用 `appliesTo` 等于当前样本 `id` 的证据。
- `transfers` 至少1条。每条精确字段为 `id, evidenceRefs, surfaceAction, underlyingMechanism, enterpriseFit, originalImplementation, doNotCopy, antiCopyChecks, experiment`；`evidenceRefs` 至少2项；四段迁移文字均非空，且 `surfaceAction` 与 `underlyingMechanism` 不能相同；`doNotCopy` 至少包含精确字符串 `名称, 口号, 核心文案, 视觉身份, 案例`。
- `antiCopyChecks` 精确字段为 `copiesName, copiesSlogan, copiesCoreCopy, copiesVisualIdentity, copiesCases, brandConfusionRisk, intellectualPropertyRisk`；五个 `copies*` 必须是布尔值 `false`，两项风险必须是字符串 `none`。
- `experiment` 精确字段为 `id, hypothesis, experimentObject, control, sample, metric, secondaryMetrics, riskMetrics, baseline, target, maximumDays, maximumCost, stopConditions, dataCollectionMethod, reviewAt, externalActions, requiresApproval`。`secondaryMetrics, riskMetrics, stopConditions` 均为非空字符串数组；`baseline, target` 为不同的有限数字；`maximumDays` 是1至365整数；`reviewAt` 是标准 ISO 时间。`externalActions` 只能取内部动作 `analyze_evidence, analyze_internal_data, draft_internal_content, internal_analysis, measure_internal_metric, review_internal_result` 或外部动作 `publish_content, paid_media, contact_customer, change_price, change_refund_rule, brand_commitment, deal_commitment, write_external_system`；只要包含外部动作，`requiresApproval` 必须为布尔值 `true`，否则必须为 `false`。
- `boundaryChecks` 精确字段为 `changesEnterpriseStrategy, changesBrandPositioning, changesPricePolicy, changesDealRules`，四项必须全部为布尔值 `false`。`collaborationRequests` 可为空；每项精确字段为 `targetOrganization, reason`，目标只能是 `ai-brand-officer | ai-deal-officer | ai-helmsman | ai-organization-officer`。
- 全候选路径感知文本审计覆盖 `evidence.claim`、样本选择理由、五层三栏、`privateUnknowns`、迁移四段与 `doNotCopy`、实验文字、协作理由、调试解释/恢复、`remainingUnknowns`、复盘基线与决策规则；浏览 `notes` 使用同一分类器。所有输入先执行 Unicode `NFKC`，再清除全部 `Cf` 零宽格式字符后识别指标，禁止用 U+200B、U+200D 或其他未列格式字符拆开“利润/profit”等指标。逗号、顿号、冒号，以及可是/却/而/然而/不过/但/yet/although/however/actually/in fact 继续作为可靠分段兼容合同；无法可靠切分时失败关闭。只要规范化全文出现私有指标，就按原顺序逐个指标审计全部片段，无指标的相邻片段也不得丢弃。分类器不再使用“删除安全词袋后查看残余”的模型，而是用锚定完整允许句式实现安全语法；整段必须被逐指标未知、完整均未知、关系否定、边界否定、企业内部未来实验或指标标签完整消费，任何未消费的竞争或业务残余都失败关闭。强断言、普通数值、百分比和排序优先拒绝；兼容示例顺序仍为“领先、最高、第一、strongest、leading”，但不作为有限允许或拒绝词表。只有“截至/截止 + 19xx或20xx年”及英文 `as-of/for 2026` 这类明确时间限定中的合理4位年份不视为经营数值。`GMV不代表利润`、`收入不能证明成交表现`、`Revenue does not prove profit`、`收入并非利润`属于关系否定；`不推断竞品私有成交表现`只在非 hypothesis 入口作为边界否定。hypothesis 在匹配 unknown 或 denial 前先执行主体硬边界，竞品主体假设拒绝，出现对手或外部样本主体同样拒绝；方向词只允许在无竞品主体的企业内部未来实验中出现。后置未知、`提高/improve/increase` 与未知的组合、无指标相邻片段均不能洗白断言；“收入未知。竞品稳居榜首”“Future competitor revenue improve to be verified”拒绝，“截至2026年收入未知”“Revenue for 2026 is unknown”“收入未知 / 利润未知”和“收入和利润均未知”允许。可靠边界示例仅用于分段，安全性不依赖无限追加排名词、标点或中性词名单。
- `evidence.public_fact` 与 `evidence.scope_fact` 必须分开路由：`public_fact` 只允许来源逐字绑定的公开可观察动作，`scope_fact` 只允许锚定的比较范围或替代基线，不得把两者合并为普通 `fact`。无指标的外部主体经营、排名、方向或经营数值在非 `public_fact` 入口默认拒绝；公开观察正例和机制推断正例只能由完整锚定语法允许。含私有指标的未知主语不得使用任意中文前缀兜底，只允许无主语、结构化样本或竞品主语（如样本A、替代样本D、竞品A、sample A、competitor A）及明确所有格。句末裁剪只移除 `.。!?！？;；` 和空白；Unicode 符号、`+`、`-`、`/`、`↑`、`↗`、`↘`、`→`、`🚀`、`%` 不得移除或过滤丢弃，出现未消费残余即拒绝。完整未知语法同时允许 `暂无数据`、`尚不清楚`、`未披露`、`is unavailable`、`not publicly disclosed`，不得把这些词做成可自由组合的词袋。
- 第九轮路由收紧覆盖前述“可靠分段兼容”表述：解析器必须保留每个字符的位置并从首字符消费到末字符，不得使用 `.*`、`[\s\S]*` 关键词共现，也不得先 `split/filter` 后丢弃空片段。只有 `.。!?！？;；` 是真实句末；冒号、逗号、顿号、括号、书名号及其他符号默认都是未消费残余，只有双指标未知的固定斜杠模板等明确内部模板可以完整消费。`public_fact` 采用封闭公开动作原子，只覆盖公开文章、清单、公开课、官网目录、公开售价和私信引导；`scope_fact` 采用完整基线原子“替代样本D仅作为比较基线，不代表第四家市场主体”。机制推断必须由公开机制主语、有限情态动词、有限机制动作、有限公开对象和待验证标记完整组成；真正的 hypothesis 必须由明确企业内部未来实验主语、有限测试动词、有限内部对象和待验证标记完整组成。无指标 unknown 只允许无主语或结构化样本/竞品主语、受控通用名词和完整未知标记；弯引号仅可成对包住结构化样本主语。任何位置插入经营结果、数字、Unicode 符号或不配对括号都必须失败关闭。
- fresh 写作输出前必须完成字段级预检：所有 evidence、sample、transfer 与 experiment 的 id 必须使用小写安全ID，完整匹配 `[a-z0-9][a-z0-9-]{2,119}`，并同步检查全部引用；alternative 的每个 layer.publicFacts 仍按 public_fact 审计，必须写成完整锚定的公开观察句，不能复用 `scope_fact` 的范围说明；scope.objective 与 scope.constraints 只能描述企业内部任务边界，不得把外部主体与收入、利润、转化、成交、复购、ROI 或 ROAS 等私有指标写在同一陈述；transfer 的 surfaceAction、underlyingMechanism、enterpriseFit、originalImplementation 必须逐字段使用允许的企业内部动作或机制语法，禁止外部主体经营结论。写作者必须在输出前逐字段自检顶层身份与路径、ID及引用、evidence、四个样本五层三栏、迁移四段、实验、debug 和 review；不得依赖 CLI 逐错后再猜测修改。
- fresh raw writer 的文件权限固定为：仅创建 `raw-forward.md` 与 `raw-candidate.json`，除此之外不得创建任何文件。`exact-invocation-prompt.txt` 由父线程在 spawn 前创建并固定 SHA；spawn 前目录必须只有该 prompt，fresh 完成及每轮 raw 修复后目录必须精确为 prompt 加两份 raw，且 prompt SHA 不变。fresh prompt 禁止出现 sidecar 文件名、评分或正式证明指令。只有父线程运行正式 CLI 并确认退出0后，才可生成评分与调用 sidecar；sidecar 必须同时记录 `rawWriterTask` 与 `sidecarWriterTask`，两者不得相同。任一文件顺序、作者隔离或目录集合不符，整轮直接作为失效历史，不得靠内容修补晋级。
- `debugReport` 精确字段为 `status, diagnostics, remainingUnknowns`；状态只能是 `passed | passed_with_unknowns | blocked`。每条诊断精确字段为 `code, severity, affectedSample, explanation, recoveryAction`，`affectedSample` 只能是当前真实样本ID、受控值 `global` 或 `null`。固定 `code → severity`：`public_scope_only, all_sources_current, ok → info`；`missing_alternative_sample, limited_direct_sample, stale_source, presence_is_not_effectiveness, observable_path_gap → warning`；`private_performance_claim, copy_risk, brand_confusion, intellectual_property_risk, price_deal_boundary_change, invalid_sample_mix, future_source → blocking`。存在 blocking 时状态必须为 `blocked`；warning 不能使用 `passed` 且必须保留非空 `remainingUnknowns`；无 blocking 时不得为 `blocked`；来源超过365天必须有 `stale_source`；未来来源直接拒绝。
- `review` 精确且只允许 `baselineMetrics, reviewAt, decisionRules`；`baselineMetrics` 至少1项，`decisionRules` 至少2项，`reviewAt` 为 ISO 时间，额外字段直接拒绝。
- 浏览研究执行对象不写进候选，但生产前必须通过 `validateBrowserResearchExecution(execution, trustedIdentity)`。对象精确字段为 `stepId, policyId, used, action, externalWrite, loginBypass, timelinePath, notes, continuousActionStandard, controller`：`stepId` 只能是 `source-collection | source-validation`；`policyId` 为 `competitive-benchmark-read-only-research-v1`；`externalWrite` 与 `loginBypass` 都必须为 `false`；`used=true` 时 `action` 只能是 `open_page | read_page | navigate | find | scroll | extract_text | screenshot`，`timelinePath` 必须精确派生为 `temp/browser-research/<enterpriseId>/<businessProjectId>/<taskId>/<runId>/<stepId>.json`；`used=false` 时 `action` 与 `timelinePath` 必须为 `null`，不得伪造 timeline；`notes` 也执行私有表现文本审计。标准和控制器必须分别为 `shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md` 与 `scripts/browser_continuous_action_controller.mjs`。

形成 schema v2 JSON 后，用原始 UTF-8 字节通过标准输入调用 `scripts/validate_candidate.mjs`。控制中心必须外部传入预期身份、项目根、预期上游、预期知识凭证与受信任参考时间；候选文件不能自带或伪造这些参数。expected upstream 和 expected receipt 必须分别与发布态 JSON、知识凭证的路径、状态和 SHA-256 完全一致。

验收要求：

- 恰好三个直接样本和一个显式替代方案；
- 上游成果、知识凭证和公开来源均为真实普通文件并通过 SHA-256；
- 每个样本五层完整，事实、推断和未知分开；
- 私有经营表现没有被写成事实；
- 原创迁移顺序完整且反照抄、品牌、知识产权检查通过；
- 实验有主指标、护栏、期限、成本与停止条件；
- 不改变企业战略、品牌定位、价格政策或成交规则；
- 外部动作数为零，或停在帝王审批门禁。

## 异常、重试与停止

- 缺少上游固定版本、知识凭证或来源文件：立即停止候选校验。
- 样本或公开证据不足：在允许范围内重试来源采集；仍不足则输出受限对标，不凑数。
- 来源冲突：并列保留并降低结论强度，不静默选择有利证据。
- 同一格式错误最多修正三轮；同一根因三轮仍失败则保留调试包并停止。
- 页面变化、超时、登录、验证码、权限或付费要求：保存 timeline 并停止当前浏览动作。
- 任何复制、品牌混淆、知识产权、价格或成交越界：不得降级为 warning。

## 示例

用户：“比较三家公开的企业服务播客和一个线下同行社群，判断哪些机制适合我们。”

正确候选会把三家播客作为直接样本、线下社群作为替代样本，逐个拆五层并标注未知；先提炼“连续主题建立熟悉度”“公开目录降低理解成本”等机制，再用企业自己的知识框架设计14天原创实验。它不会复制节目名、口号、封面、案例或对手价格，也不会断言任何样本真实转化更高。

## 版本

- v0.2.3｜2026-08-05：接入控制中心验收后发布桥，补齐机会正式上游读取、对标正式依赖改绑与修改后v2链规则。
- v0.2.1｜2026-08-02：绑定基础运行器，补齐中断恢复、上游精确绑定、不可变修改、同组织下游流转、跨组织精确交接和最终验收规则。
- v0.2.0｜2026-07-30：增加正式项目身份、真实上游与来源哈希、十四步规划、五层事实分层、专属调试、只读浏览 timeline、原创迁移和 schema v2 严格门禁。
- v0.1.0｜2026-07-28：建立四样本、证据分层、反照抄、组织边界与实验基础契约。
