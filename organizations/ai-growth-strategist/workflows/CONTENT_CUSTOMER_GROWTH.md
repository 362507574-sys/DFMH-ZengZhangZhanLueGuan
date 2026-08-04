# 内容与客户增长 Workflow

## 1. 入口

确认主责为 AI增长战略官；读取增长机会、任务归属、知识凭证、品牌 Brief 版本、同意规则和成交交接版本。

## 2. 内容证据

为企业事实、客户原话、行为数据、公开来源、推断、假设和未知建立编号。每个内容单元至少绑定两条证据且包含事实，使用当前品牌版本并设置频率上限。

## 3. 渠道与生命周期

按短视频、小红书、公众号、许可私域等渠道设计原创内容。客户阶段至少区分认知与培育；观看、点击和被动到场不等于成交意向。明确进入信号、允许动作和退出信号。

## 4. 同意与安全

固定用途、保存期限、退出机制、拒绝即停和禁止自动外联。虚假稀缺、隐藏费用、胁迫、脆弱群体定向和伪造证明均为禁止项。

## 5. 成交交接

只有客户明确请求咨询、报价、购买或续费时交给 AI成交官。交接使用版本号和内部客户引用，包含同意、来源、触点、阶段需求、证据、未知、承诺限制、风险及允许/禁止下一步；成交官返回接受、拒绝原因、阶段与结果。

## 6. 复购

已完成服务且明确表示兴趣者才进入复购候选。投诉、退出、未解决退款必须排除；具体续费或购买决策仍由 AI成交官负责。

## 7. 实验与复盘

实验固定假设、方法、指标、目标、最长期限、最大成本和停止条件。候选通过 `validate_candidate.mjs` 后才能提交人工审阅；格式最多修正三轮，同一根因仍失败则停止。

## 8. v0.2.0 固定执行链

入口先锁定企业、项目、任务和运行身份，再核验四个精确成果：

- `growth-opportunity-brief@version` + SHA-256
- `benchmark-mechanism-map@version` + SHA-256
- `brand-brief@version` + SHA-256
- `deal-handoff-contract@version` + SHA-256

飞书凭证与匹配来源必须位于当前运行证据目录并核对 SHA-256。随后按以下顺序执行：

`intake → upstream-version-check → brand-product-lock → lifecycle-plan → content-strategy → short-video / xiaohongshu / permission-private-domain → content-candidate-library → brand-evidence-safety-check → approval → metric-collection → deal-handoff → repurchase → debug → review`

三渠道分别为 `short-video`、`xiaohongshu`、`permission-private-domain`，月计划不得机械跨发；周产能上限分别为 5、3、2。客户生命周期固定为 `anonymous-awareness`、`active-interest`、`consented-nurture`、`explicit-inquiry`、`service`、`repurchase-candidate`。

用途、保存期限、退出、拒绝即停、到期即停、禁止自动群发和禁止主动联系均为硬门禁。观看、点击、收藏等被动信号不能进入 `explicit-inquiry`。

成交交接必须保留完整 14 项字段并绑定上游 `deal-handoff-contract@version` 与 SHA-256；价格或退款规则未定版时只阻断成交交接，内容候选仍可继续内部规划。复购必须同时检查服务完成、客户主动需求和规则已确认，并排除投诉、退款、交付问题、拒绝与退出。

发布、付费、触达、价格、退款、品牌承诺、成交承诺和外部写入都保持 `awaiting_approval`，审批前 `approvalId=null`。审批后才能收集外部执行指标。浏览器动作复用公共连续动作控制器；声明已使用时必须保存真实存在、不可越过链接、且企业/项目/任务/运行/步骤身份匹配的 JSONL 时间线。

调试必须由调试器重新计算并覆盖 3 渠道 × 6 生命周期的 18 格矩阵，定位品牌版本、证据、渠道适配、CTA、频率、许可、生命周期、14 项交接、复购资格、外部门禁和追踪缺口；候选自报的全绿结果不得作为验收依据。

本版本继续为 `designing / acceptsFormalTasks=false`；只生成内部候选，不发布、不投放、不联系客户。本轮不创建 Checkpoint，不做 fresh forward proof。
