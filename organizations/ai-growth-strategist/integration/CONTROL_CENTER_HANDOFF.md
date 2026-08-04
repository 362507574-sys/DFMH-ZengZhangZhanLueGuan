# 控制中心交接

根控制中心以 `control-center/registries/organizations.json` 为权威注册表。

- 组织状态：`designing`
- 正式接单：否
- 路由降级：`fallback_existing`
- 唯一主责：AI增长战略官
- 协作：通过严格请求/返回契约，不共享可变上下文
- 候选门禁：`scripts/validate_candidate.mjs`

旧技能编号 `growth-positioning` 与 `growth-review` 已停止路由；增长定位归入增长机会分析，复盘成为三 Skill 共同闭环。

## 项目隔离舱正式读取边界

AI增长战略官只读取控制中心写入当前任务 `project-context.json` 的精确成果版本。首条正式协作链使用当前业务项目的 `enterprise-analysis@版本号`，同时核对 SHA-256；不得扫描 `organizations/ai-helmsman/`，不得读取“current”或猜测最新版本，也不得从其他客户或项目寻找近似资料。

上游发布新版本不会自动改变已经开始的增长任务。需要切换版本时，由控制中心提升项目上下文版本并重新绑定。
