# 增长机会分析 Workflow｜v0.2

## 1. 入口与固定身份

读取根规则、组织章程、任务归属、飞书前置检索凭证及当前项目精确版本的企业、战略、品牌和成交边界。固定 `enterpriseId / businessProjectId / taskId / runId`，确认 AI增长战略官为唯一主责。

组织保持 `designing / acceptsFormalTasks=false`。本流程产生候选，不冒充正式生产结论。

## 2. 十二步计划

使用 `growth_opportunity_planner.mjs` 生成并保存：

```text
intake
→ input-audit
→ research-plan
→ market-trends
→ user-demand
→ industry-opportunity
→ enterprise-growth-space
→ opportunity-pool
→ priority-map
→ experiments
→ debug
→ approval
```

四条分析支线都依赖 `research-plan`；`opportunity-pool` 必须等待四支线完成。只有 `approval` 标记外部动作审批。

## 3. 证据账本

按企业事实、客户原话、行为数据、公开来源、飞书知识、推断、假设和未知分类。每条记录保存来源、时间、适用范围、版本、SHA-256、A—D可信度和冲突引用。

事实、推断、假设和未知不得混写。没有可靠行业规模证据时不估算市场规模；点击、阅读、点赞和收藏不得直接写成购买需求；相关性不得写成因果。

## 4. 四条支线

- `market-trends`：检查政策、技术、消费行为、渠道和品类变化；区分长期趋势、短期热点和噪声。
- `user-demand`：区分客户表达、实际行为、付费信号和专业推断。
- `industry-opportunity`：检查供需、竞争、替代方案、进入条件和时间窗口。
- `enterprise-growth-space`：检查获客、激活、培育、询盘、成交和复购断点。

每条支线输出 findings、evidenceRefs、inferences 和 unknowns。资料不足时标记 `limited` 或 `blocked`，不凑确定结论。

## 5. 机会池与双层评价

每个机会写明人群、问题、场景、机制、事实证据、`counterEvidenceRefs`、未知和实验。

吸引力按六项0—100加权：

```text
需求强度25% + 企业适配20% + 可触达15%
+ 潜在价值15% + 时间窗口10% + 竞争与执行15%
```

可信度按 A—D，只统计企业事实、客户原话、行为数据、可靠公开来源和知识来源；推断、假设和未知不计数：

- A：至少三类证据且包含企业行为数据；
- B：至少两类证据；
- C：主要为公开观察和有限样本；
- D：主要为假设，先补证。

存在未解决证据冲突时不得评为 A 或 B。

优先级不得只看总分，固定映射为：`>=70 + A/B → priority_experiment`；`>=70 + C/D → evidence_first`；`<50 + C/D → stop`；其余 `50—69` 及 `<50 + A/B → hold`。

## 6. 有界实验

为优先候选写明假设、对象、对照、样本、基线、主指标、辅助指标、风险指标、目标、最长期限、最大成本、停止条件、数据回收方式和复盘时间。

只生成实验候选，不执行外部动作。正式发布、付费媒体、联系客户、价格/退款变化、品牌/成交承诺和外部系统写入必须进入 `awaiting_approval`。

## 7. 专属调试

运行 `growth_opportunity_debugger.mjs`，至少检查：

- 无来源市场规模与缺事实证据；
- 互动信号冒充购买需求；
- 相关性冒充因果；
- 评分敏感性；
- 不可测量指标与缺停止条件；
- 企业执行能力和漏斗断点；
- 战略、品牌、价格、成交或组织边界变化；
- 反证遗漏。

运行级 debug bundle 固定保存：目标、输入版本、证据清单、作战计划、步骤时间线、工具状态、错误分类、重试记录、修复动作、候选输出、门禁结果、指标快照、复盘结论、可重放输入。

候选内 `debugReport` 只是摘要，包含 `status`、`diagnostics`、`remainingUnknowns`；每条诊断包含 `code`、`severity`、`field`、`explanation`、`recoveryAction`。存在 blocking 诊断时摘要 `status=blocked`，但该摘要值不是共享运行状态。

## 8. 契约与兼容

按 `templates/growth-opportunity-analysis.v2.json` 生成 v2 候选，通过标准输入运行 `validate_candidate.mjs`。v2 分派到 `growth_opportunity_v2_contract.mjs`；v1 继续走原契约。

v2 调用必须额外传入调用方控制的预期 `enterpriseId / businessProjectId / taskId / runId / projectRoot`；候选自身字段不能充当可信上下文。`matched / degraded / no_hit` 均核验凭证存在、非链接、位于当前运行目录且 SHA-256 匹配。

契约失败只修正当前候选，不改变事实证据。最多三轮；同一根因仍失败则停止并保存时间线。

## 9. 重试、恢复与停止

十二步业务链负责分析内容；共享状态机负责整次运行生命周期，两者不得混写。

正常运行状态：

```text
intake → planning → ready → running_internal
→ awaiting_approval → running_approved → reviewing → completed
```

异常运行状态：

```text
retrying / missing_input / evidence_conflict / boundary_blocked
/ cost_stopped / paused / failed
```

取消或归档属于项目生命周期控制，不伪造成运行状态，且不得自动恢复。

- 临时网络、工具超时或文件占用：最多重试两次；
- 页面或工具结构变化：使用已批准备用路线，最多两次；
- `no_hit / degraded`：继续受限分析；
- 运行中断：从最后已验证步骤恢复；
- 同一根因三轮：进入 `failed`；
- 证据冲突：进入 `evidence_conflict`，不静默选择；
- 付费、权限、安全和组织越界：不自动重试；
- 取消或归档：停止且不得自动恢复。

## 10. 输出和协作

输出四支线、证据账本、机会池、双层优先级、反证、有界实验、调试报告、复盘规则和下游交接包。

需要改变战略、品牌、成交或组织体系时分别请求 AI掌舵官、AI品牌官、AI成交官或 AI组织官。协作不改变主责，不替其他组织作承诺。

候选留在当前项目舱组织工作区。正式跨组织共享只能由控制中心发布固定 `artifactId@version`。
