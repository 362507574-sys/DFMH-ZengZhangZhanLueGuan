# DFMH-ZengZhangZhanLueGuan

## AI增长战略官｜增长获客系统

帮助企业发现增长机会、拆解竞争打法并建立内容获客与客户增长系统。

- 当前成熟度：`designing`
- 正式任务许可：`false`
- 使用边界：当前为设计/试运行版本，默认用于候选分析和内部验证，不代表已经获得正式对外发布权限。

## 三个核心技能

| 技能 | Skill ID | 主要输出 |
| --- | --- | --- |
| 增长机会分析 | `growth-opportunity-analysis` | 市场趋势、用户需求、行业机会、增长空间 |
| 竞争对标拆解 | `competitive-benchmark-analysis` | 竞争对手定位、产品策略、内容打法、获客渠道、成交路径 |
| 内容与客户增长 | `content-customer-growth` | 短视频策划、小红书种草、私域运营、客户培育、复购设计 |

## 这个仓库能做什么

1. 接收企业、项目和任务资料，并严格保持项目隔离。
2. 按三个核心技能形成分析、方案、执行动作、验收指标和停止条件。
3. 区分已知事实、公开资料、推断和信息缺口，不用模拟数据冒充真实经营结果。
4. 通过版本化文件和本地门禁保留可复核的执行证据。

## 两种使用方式

### 方式一：单独使用当前组织

下载本仓库并作为一个独立 Codex 项目打开。它只加载 AI增长战略官 的三个核心技能，适合只需要本组织能力、希望保持环境简单的使用者。完整步骤见 `QUICKSTART.md`。这种方式不是把技能全局安装进 Codex。

### 方式二：通过DFMH-ZongKong完整安装

访问 https://github.com/362507574-sys/DFMH-ZongKong ，把安装话术发给 Codex，即可一次安装控制中心、五个组织、15个组织技能，以及海报设计和淘宝套图两个公共技能。不要手工复制五个组织目录，总控会按固定版本自动安装并校验。

## 使用方法

1. 先按 `QUICKSTART.md` 选择“单独使用”或“总控完整安装”。
2. 将任务资料放在仓库外的独立任务目录中，不要提交客户隐私、密钥或真实业务数据到公开仓库。
3. 单独使用时，先读取根目录 `AGENTS.md`、`PUBLIC_PACKAGE_CONTRACT.json`，再读取 `organizations/ai-growth-strategist/AGENTS.md` 和三个技能的 `SKILL.md`。
4. 执行 `npm test` 检查仓库结构、公开执行契约、本地依赖和敏感信息。

## 目录

- `organizations/ai-growth-strategist/skills/`：三个核心技能。
- `organizations/ai-growth-strategist/workflows/`：技能对应业务流程。
- `organizations/ai-growth-strategist/scripts/`：确定性运行与校验组件。
- `organizations/ai-growth-strategist/templates/`：候选、计划和交付模板。
- `control-center/registries/`：本组织的精简登记与输出目录。
- `shared/`：技能引用的公共只读标准。

## 控制中心边界

本仓库是可独立分发的单组织能力包，不包含飞书机器人凭据、客户资料、历史任务、临时文件或总控私有配置。它不等于完整AI数字员工控制中心，也不自动具备五组织编排、飞书调度、跨项目资产共享或私有知识库能力。公共海报和淘宝电商套图能力仍由外部控制中心按登记表调用，不在本仓库重复打包。

## 发布信息

- 生成时间：2026-08-06T01:58:32.445Z
- GitHub 仓库可见性：public
- 许可：保留所有权利，未经授权不得转售或公开再分发。
