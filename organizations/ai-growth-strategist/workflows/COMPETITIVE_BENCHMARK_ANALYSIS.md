# 竞争对标拆解 Workflow v0.2

## 1. 入口与身份

控制中心确认 AI增长战略官为唯一主责，锁定企业、项目、任务和运行身份。读取 `growth-opportunity-brief@version`、品牌 Brief、知识凭证与限制；上游、凭证和来源都必须是当前项目内真实普通文件并核对 SHA-256。

组织保持 `designing / acceptsFormalTasks=false`。本 Workflow 只产生内部候选，不代表正式生产接单。

## 2. 可恢复规划

按以下依赖顺序建立运行计划：

`intake → sample-plan → source-collection → source-validation → positioning → product-strategy → content-mechanism → acquisition-channels → observable-customer-path → mechanism-transfer → enterprise-adaptation → copy-brand-ip-check → experiments → approval`

来源采集与验证各允许两次、单次15秒；其余步骤一次。每步写入状态、输入版本、证据、尝试次数和结果哈希。恢复时沿用原 `runId`，只重跑失败步骤及依赖它的下游，禁止重复已经完成的外部动作。

## 3. 样本计划

默认恰好三个直接样本加一个显式替代方案。依据客户问题、产品形态、价格带、渠道、业务阶段、来源可核验性和机制差异记录选择理由。无法补齐时只形成受限报告，不以推断凑数。

## 4. 公开证据

每条公开来源保存：

- 来源文件路径与真实 SHA-256；
- 来源版本、观察时间和适用样本；
- 公开事实；
- 与事实分开的推断；
- 私有经营未知。

知识 receipt 使用 `schemaVersion` 数字 `2`。`sources` 只能是对象数组，每项精确为 `relativePath, sha256`；路径必须位于当前运行 `evidence/knowledge-sources/`，且 SHA-256 必须匹配该文件实际字节。`matched` 至少1项，`no_hit` 必须 `sources=[]`，`degraded` 若保留来源也逐项核验；字符串路径、额外字段、链接/联接目录和同路径字节替换均拒绝。

浏览器只做公开只读研究，遵循 `shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md`，调用 `scripts/browser_continuous_action_controller.mjs`。`source-collection` 与 `source-validation` 的生产动作必须先以控制中心外部身份通过 `validateBrowserResearchExecution`：实际使用时 timeline 精确绑定企业、项目、任务、运行和步骤；未使用时 `used=false` 且 action/timeline 均为 `null`，不得伪造浏览记录。不得绕过登录、验证码、付费墙或权限，不得写外部系统，notes 也必须通过私有经营表现文本审计。

## 5. 五层矩阵

逐样本拆解公开竞争定位、公开产品策略、内容机制、获客渠道、可观察客户路径。每层都有公开事实、推断、未知和证据引用。

频道存在不等于有效；文章频率不等于客户质量；私信入口不等于成交；公开课和目录不等于收入。后台转化、营收、利润、成本、复购和私域动作均保持未知。

## 6. 机制与原创适配

按“表面动作 → 底层机制 → 企业适配 → 原创实现 → 不可复制 → 反照抄检查”推导。禁止复制名称、口号、核心文案、视觉身份、案例、受保护课程结构、竞品价格动作或未公开成交方法。

复制项必须全为 `false`；品牌混淆和知识产权风险必须为 `none`。风险未清零时进入 `blocked`，不得以说明文字绕过字段门禁。

## 7. 有界实验

每项原创迁移绑定证据，并定义：

- 企业原创假设、实验对象和控制组；
- 样本与数据口径；
- 主指标、次指标和风险护栏；
- 基线与目标；
- 最长期限、最大成本；
- 数据收集方法、复盘时间和停止条件；
- 所需外部动作与审批状态。

实验只验证本企业原创实现。发布、投放、客户联系、外部系统写入、品牌承诺、价格和成交动作必须停在帝王审批。

## 8. 调试与协作

专属调试覆盖样本偏差、来源时效、未来来源 `future_source`、事实推断混淆、私有业绩声明、渠道效果误判、公开路径断层、复制、品牌混淆、知识产权、价格成交越界和浏览器异常。

- 品牌混淆或品牌承诺：向 AI品牌官提交精确版本请求；
- 价格、报价、成交规则：向 AI成交官提交精确版本请求；
- 企业战略或资源总盘：向 AI掌舵官提交精确版本请求；
- 流程模块和隔离建议：向 AI组织官提交有界请求。

协作不能改变企业、项目、主责组织或静默替换候选。

## 9. 候选校验与停止

候选必须通过 schema v2 契约与外部可信 CLI 上下文；候选自身不能提供 `expectedIdentity`、`projectRoot`、expected upstream 或 expected receipt。控制中心外部传入 `--expected-upstream-artifact-id`、`--expected-upstream-version`、`--expected-upstream-sha256`、`--expected-receipt-relative-path`、`--expected-receipt-status`、`--expected-receipt-sha256` 与 `--reference-at`。知识 receipt 的路径、状态和 SHA 必须与外部预期完全一致；matched/no_hit/degraded 必须满足真实来源和限制语义。所有业务文本先执行 Unicode `NFKC`，再清除全部 `Cf` 零宽格式字符。逗号、顿号、冒号，以及可是/却/而/然而/不过/但/yet/although/however/actually/in fact 保留为可靠分段兼容合同；无法可靠切分时失败关闭。规范化全文一旦出现私有指标，就按原顺序逐个指标审计所有片段，无指标的相邻片段也不得丢弃。审计不再使用删除安全词袋或中性词的模型；每一整段必须被锚定安全语法完整消费，只允许逐指标未知、完整均未知、关系否定、边界否定、无竞品主体的企业内部未来实验或指标标签，任何未消费残余都失败关闭。强断言、普通数字、百分比、方向变化和排序优先于 unknown、denial、hypothesis 拒绝；兼容示例顺序仍为“领先、最高、第一、strongest、leading”，但不构成有限词表。明确“截至/截止 + 19xx或20xx年”以及英文 `as-of/for 2026` 的合理4位年份只作为时间限定。关系否定允许 `GMV不代表利润`、`收入不能证明成交表现`、`Revenue does not prove profit` 与 `收入并非利润`；`不推断竞品私有成交表现`只在非 hypothesis 入口作为边界否定。hypothesis 在 unknown/denial 之前执行主体硬边界，竞品主体假设拒绝，出现对手或外部样本主体同样立即拒绝；`improve/increase/提高/改善` 等方向词仅允许在企业内部未来实验中出现。`收入未知。竞品稳居榜首`、`Future competitor revenue improve to be verified` 和安全句前后附加的数字、百分比或竞争残余都拒绝；`截至2026年收入未知`、`Revenue for 2026 is unknown`、逐指标未知与完整均未知允许。该门禁不依赖无限扩充排名词、标点或中性词名单。review 字段精确，diagnostic 样本必须真实，warning 不得伪装 passed。重复 JSON 键、额外字段、Proxy、accessor、Symbol、稀疏数组、超深对象、路径逃逸、链接、文件缺失、身份/状态不一致或 SHA 不一致一律拒绝。

证据类型必须按 `public_fact` 与 `scope_fact` 分开路由：`public_fact` 只保存来源逐字绑定的公开可观察动作，`scope_fact` 只保存锚定的比较范围或替代基线。无指标的外部主体经营、排名、方向或经营数值在非 `public_fact` 入口默认拒绝；公开观察正例与机制推断正例只按完整锚定语法放行。私有指标未知句不得再接受任意中文前缀，只允许无主语，或使用结构化样本、竞品标识与明确所有格作为主语。句末裁剪只移除 `.。!?！？;；` 和空白；Unicode 符号以及 `+ - / ↑ ↗ ↘ → 🚀 %` 不得移除或过滤丢弃。完整未知语法允许 `暂无数据`、`尚不清楚`、`未披露`、`is unavailable`、`not publicly disclosed`，任何同义词都必须由整句语法消费而不是词袋组合。

第九轮正式解析器以字符跨度和游标完整消费为准，并覆盖前述兼容分段表述：五条路由不得用 `.*`、`[\s\S]*` 或 `split/filter` 做关键词共现。只有 `.。!?！？;；` 是真实句末；冒号、逗号、顿号、括号、书名号与其他 Unicode 符号默认作为残余拒绝，只有固定内部模板可完整消费。`public_fact` 仅允许来源绑定的公开文章、清单、公开课、官网目录、公开售价与私信引导原子；`scope_fact` 仅允许完整比较基线原子。机制推断必须完整包含公开机制主语、有限情态、有限机制动作、有限公开对象与待验证标记；hypothesis 必须完整包含企业内部未来实验主语、有限测试动词、有限内部对象与待验证标记。无指标 unknown 只允许无主语或结构化样本/竞品主语、受控通用名词与完整未知标记，弯引号必须成对包住结构化主语。任意 token 边界插入经营结果、数字、符号或不配对括号均失败关闭；内部操作规则走独立 operational 审计语境，不得借此放宽真正 hypothesis。

fresh 写作必须先完成输出前逐字段自检，再交给正式 CLI：所有 evidence、sample、transfer 与 experiment 的 id 必须使用小写安全ID，完整匹配 `[a-z0-9][a-z0-9-]{2,119}`，且引用同步一致；alternative 的每个 layer.publicFacts 仍按 public_fact 审计，只能使用完整锚定的公开观察句，不能把替代范围说明直接复制进五层事实栏；scope.objective 与 scope.constraints 只能描述企业内部任务边界，外部主体不得与私有经营指标出现在同一陈述；transfer 的 surfaceAction、underlyingMechanism、enterpriseFit、originalImplementation 必须逐字段使用允许的企业内部动作或机制语法，不得书写外部主体经营、排名、方向或数值结论。字段级预检至少覆盖顶层身份与可信路径、全部ID与引用、evidence两类、四个样本的五层三栏、迁移四段、实验、debug 与 review，不能等待 CLI 逐个暴露本可在写作阶段发现的问题。

fresh raw writer 仅创建 `raw-forward.md` 与 `raw-candidate.json`，除此之外不得创建任何文件。父线程在 spawn 前独立写入并固定 `exact-invocation-prompt.txt` 的 SHA；spawn 前目录精确只有 prompt，fresh 完成前和每轮 raw 修复后目录精确只有 prompt 加两份 raw，任何 sidecar 路径均不得存在且 prompt SHA 必须保持不变。fresh prompt 静态禁止 sidecar 文件名、评分和正式证明指令。父线程只在正式 CLI 原始 UTF-8 校验退出0后生成评分与调用 sidecar，并同时记录 `rawWriterTask` 与 `sidecarWriterTask`，两者不得相同。目录文件集、写入顺序、prompt SHA 或作者隔离任一不符即归档失效，不允许内容修复后晋级。

同一格式错误最多修正三轮；同一根因三轮仍失败时停止，保存证据账本、运行状态、调试包和 timeline。组织仍为 `designing`，不得把本地测试通过解释为 `operational`。
