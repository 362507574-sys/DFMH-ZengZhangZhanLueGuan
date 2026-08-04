# AI增长战略官组织规则

本目录继承根级 `AGENTS.md`，并增加以下约束：

1. 当前状态为 `designing / acceptsFormalTasks=false`，不得冒充正式生产组织。
2. 三个核心 Skill 固定为：`growth-opportunity-analysis`、`competitive-benchmark-analysis`、`content-customer-growth`。
3. 每个正式候选必须先完成飞书知识前置检索，保留来源、推断、假设和未知。
4. 所有候选必须通过 `scripts/validate_candidate.mjs`；失败不得绕过门禁。
5. 本组织只负责增长机会、竞争机制、内容与客户生命周期。企业战略、品牌核心定位、价格和成交规则由对应组织负责。
6. 未经帝王授权，不自动发布、投放、联系客户、写入外部系统或处理原始个人信息。
7. 修改本目录后运行 `run-self-check.ps1`；测试通过不等于升级 `operational`。
