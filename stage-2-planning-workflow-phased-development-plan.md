# 阶段 2 产品规划工作流分阶段开发文档

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档版本 | 1.0 |
| 状态 | 待确认 |
| 开发工作区 | `<workspace>/ProductWoc` |
| 最终集成系统 | `<workspace>/ProductFac` |
| 开发策略 | ProductWoc 与 ProductFac P1-02 并行，契约先行，Gate 后集成 |
| 最终门禁 | ProductFac Gate G2 |

本文档是阶段 2 的执行计划。产品范围、技术边界和社区衔接以《阶段 2 产品规划工作流技术架构》及 ProductFac 现有文档为准。

> 2026-08-28 独立运行补充：P2-00 至 P2-04 及本地完整工作流必须脱离 ProductFac 独立构建、测试和运行。P2-05 至 P2-07 的 ProductFac 集成工作视为可选后续路线，不阻塞 ProductWoc 的独立运行完成度；具体隔离边界以 ADR 008 为准。

## 2. 交付目标

交付从一句话需求到 `ready_for_development` 的完整私有规划闭环：

```text
需求理解与默认假设
→ 最多 1–3 个关键问题
→ Project Spec / PRD 确认
→ Technical Design 确认
→ Execution Plan 确认
→ 唯一、版本固定的开发起点
```

阶段结束时必须具备：

- 三类不可变规划文档和稳定内容 Hash；
- 用户审批、修改、退回、取消和恢复；
- 确定性的下游失效；
- 结构化决策摘要、全文、Diff 和时间线；
- Responses Provider、配置化模型路由和最小上下文装配；
- 至少 20 个需求 Fixture 的可复现 Eval；
- ProductFac 身份、租户、PostgreSQL、Temporal、Outbox/SSE 的真实集成；
- 面向后续 Blueprint 的私有映射能力，但不开放社区功能。

## 3. 开发原则

1. 先完成纯领域与共享契约，再接数据库和 Temporal；不让 ProductWoc 被 P1-02 阻塞。
2. ProductFac 是生产事实源；ProductWoc 不创建第二套身份、Project、数据库或社区系统。
3. 当前 PRD v1 流程继续可用；完整工作流以 v2 契约新增，不原地破坏。
4. 每个切片同时交付 Schema、实现、测试、文档和可演示结果。
5. 模型输出只产生候选文档；Schema、领域规则、审批和独立校验控制状态推进。
6. 阶段 2 不生成业务代码，不把后续开发、部署和社区需求提前塞入本阶段。

## 4. 两条并行主线

### 4.1 ProductWoc 主线（可立即开始）

- 工程基线与 Contract Manifest；
- v2 Schema、纯领域状态机、Hash、版本和失效图；
- Discovery、PRD、技术方案、执行计划生成内核；
- Markdown/摘要/Diff；
- Prompt、Context Assembler、Provider 接口；
- Fixture、Eval、Temporal 纯 Workflow 测试；
- ProductFac Adapter 契约测试。

### 4.2 ProductFac 主线（继续 P1-02）

- 版本化 WorkflowRun/StageRun；
- Transactional Outbox Claim、重试与消费协议；
- Web 请求幂等和跨进程事件投影；
- Artifact ACL、Telemetry/Sentry、完整项目页面；
- Gate G1。

### 4.3 汇合条件

两条主线只在以下条件满足后进入真实集成：

- ProductWoc v2 契约冻结并通过兼容测试；
- ProductFac P1-02 完成且 Gate G1 通过；
- PlatformStore、Outbox、Planning Timeline Adapter 的接口稳定；
- v1 进行中 Run 的兼容与迁移策略已评审。

## 5. 总体里程碑

| 里程碑 | 建议工期 | 主要结果 | 是否依赖 G1 |
|---|---:|---|---:|
| P2-00 工程与契约基线 | 2–3 天 | 可独立运行的 ProductWoc、兼容清单 | 否 |
| P2-01 领域内核 | 4–5 天 | 版本、Hash、状态机、审批、失效 | 否 |
| P2-02 Discovery 与 Project Spec | 4–6 天 | 关键问题、PRD v2、摘要与确认 | 否 |
| P2-03 Technical Design | 3–5 天 | 黄金栈技术方案与追踪矩阵 | 否 |
| P2-04 Execution Plan | 3–5 天 | 阶段计划、依赖与覆盖校验 | 否 |
| P2-05 Workflow 与平台集成 | 5–7 天 | Temporal、PostgreSQL、Outbox/SSE | 是 |
| P2-06 Web 体验与恢复 | 4–6 天 | 对话、卡片、Diff、时间线、恢复 | 是 |
| P2-07 Eval、安全与 Gate G2 | 4–6 天 | 20+ Fixture、5 项目验收、变更证明 | 是 |

单人串行约 5–7 周；ProductWoc 与 P1-02 并行时，日历时间取决于 Gate G1。工期是规划区间，不是承诺日期。

## 6. P2-00：工程与契约基线

### 6.1 目标

建立与 ProductFac 完全兼容、可独立测试、未来可直接合入的 ProductWoc 工作区。

### 6.2 工作项

- 初始化 pnpm 11 Workspace、Turbo、Node.js `>=24 <25`、TypeScript strict、ESLint、Vitest；
- 固定精确依赖版本并生成 lockfile；
- 建立 `planning-contracts/domain/agent/renderer/workflow/evals` 包；
- 建立统一 `lint/typecheck/test/build/check`；
- 从 ProductFac 导出并固定 `PlanningContractManifest`；
- 保存 v1 Planning 契约 Fixture，建立 v1→v2 Adapter 测试骨架；
- 记录 P2 v2 契约 ADR 和 ProductWoc 合入策略 ADR；
- 建立 `planning-lab`，只用于本地演示和 Fixture 回放。

### 6.3 交付物

- 可执行工作区；
- Contract Manifest 与 Schema Hash；
- 包依赖规则；
- v1 兼容 Fixture；
- 第一条 CI/本地质量门禁。

### 6.4 验收

- `pnpm check` 全部通过；
- Node/pnpm/TypeScript/Vitest 主版本与 ProductFac 一致；
- `planning-domain` 无 Next、Temporal、数据库、OpenAI SDK 依赖；
- Contract Manifest 漂移会使测试失败；
- 不创建生产数据库、身份或社区表。

## 7. P2-01：规划领域内核

### 7.1 目标

先用纯函数证明所有状态、版本、审批和失效规则，再接外部系统。

### 7.2 工作项

- 定义 `PlanningWorkflowInputV2`、`PlanningSnapshotV2` 和命令结果；
- 定义 `ProjectSpecVersion`、`TechnicalDesignVersion`、`ExecutionPlanVersion`；
- 实现规范化 JSON 和稳定 SHA-256 内容 Hash；
- 实现四个固定 Stage 与完整状态转换；
- 实现 Approval Binding 校验和 Decision 幂等；
- 实现当前有效版本指针；
- 实现 PRD→技术方案→执行计划的失效依赖图；
- 实现 `ready_for_development` 的唯一进入条件；
- 实现 JSON→Markdown、决策摘要和结构化 Diff 基础；
- 定义 Repository、Model、Artifact、Event、Clock 和 ID 端口。

### 7.3 必测场景

- 同一命令重复执行只产生一个结果；
- Version/Hash 不匹配的审批被拒绝；
- 修改 PRD 后技术方案和计划不可继续使用；
- 修改技术方案后计划不可继续使用；
- 展示 Markdown 改变但规范化 JSON 不变时 Hash 稳定；
- 旧审批和旧版本可审计但不能成为有效指针；
- 三次有效审批只产生一个开发起点；
- 非法越级状态转换被拒绝。

### 7.4 Exit Gate P2-A

- 领域测试和属性测试通过；
- 失效矩阵 100% 覆盖；
- v1 Fixture 可经 Adapter 读取；
- 文档 Hash 在不同键顺序和展示格式下保持稳定；
- 架构评审确认没有平台层反向依赖。

## 8. P2-02：Discovery 与 Project Spec

### 8.1 目标

把一句话需求转为可确认的 MVP PRD，同时避免过度提问。

### 8.2 工作项

- 实现 `RequirementUnderstanding`：摘要、目标用户、核心任务、假设、风险和支持范围；
- 实现关键不确定性评分，仅提出最多 1–3 个阻断问题；
- 为每个问题提供推荐默认值和影响说明；
- 将回答、采用的默认值和确定性事实写入 Decision Log；
- 定义并生成完整 `ProjectSpecVersion`；
- 生成决策摘要：产品目标、用户、MVP 包含/不包含、假设、风险和待确认项；
- 实现批准、单项修改、退回、拒绝和版本 Diff；
- 对超出黄金栈或高风险需求返回明确原因与可行降级；
- 建立 CRUD SaaS、后台、内容/表单、模糊需求和不支持需求 Fixture。

### 8.3 Agent 约束

- 输出必须通过 Zod/JSON Schema；
- Schema 修复次数有限，失败转 `needs_user_action`；
- Prompt、模型路由、Schema 和 Policy 均版本化；
- 原始输出作为受限 Artifact 保存，不能成为事实源；
- 不无差别发送完整历史；只装配当前 idea、回答、有效 Decision 和必要 Reference。

### 8.4 Exit Gate P2-B

- 至少 8 个代表需求可生成有效 Project Spec；
- 关键问题不超过 3 个；
- 所有假设明确标记，默认值可被用户覆盖；
- PRD 修改必定创建新版本；
- 重复批准不重复推进；
- 决策摘要足以让测试用户在不阅读全文时做出确认或修改。

## 9. P2-03：Technical Design

### 9.1 目标

基于已批准 PRD，生成与 ProductFac 黄金栈一致、可追踪且可实施的技术方案。

### 9.2 工作项

- 定义 Technical Design Schema 和 Markdown 模板；
- 固定黄金栈约束：Next.js 16、Node 24、TypeScript、PostgreSQL/Neon、Drizzle、Better Auth、Temporal、E2B、GitHub App、Netlify、R2；
- 生成模块边界、数据模型、API、权限、状态生命周期、错误处理和安全设计；
- 生成测试、观测、迁移、回滚、依赖和风险权衡；
- 建立 Requirement ID → Design Item 追踪矩阵；
- 标记需要 ADR 或人工确认的技术决策；
- 支持批准、修改、退回 PRD 和版本 Diff；
- 实现 Product Spec Version/Hash 绑定与上游变更失效。

### 9.3 规则

- 不允许模型擅自更换黄金栈；例外必须明确说明并经用户确认；
- 社区 Blueprint 只能作为 Reference Context，不能覆盖当前 PRD 或安全策略；
- 技术方案不能将暂未完成的 ProductFac 能力描述为已存在；
- Secret、真实凭证和生产数据不得进入文档或 Prompt。

### 9.4 Exit Gate P2-C

- 所有已确认需求均映射到设计项或明确标记无需设计；
- 技术方案引用正确的 PRD Version/Hash；
- PRD 更新后旧技术方案立即失效；
- 黄金栈偏离会被 Validator 拦截或进入人工确认；
- 架构、安全和数据边界评分达到 Eval 基线。

## 10. P2-04：Execution Plan

### 10.1 目标

把已确认 PRD 和技术方案转为未来阶段 3 可消费的分阶段开发计划。

### 10.2 工作项

- 定义 Execution Plan Schema；
- 生成阶段、任务、依赖图、输入/输出、完成标准和用户门禁；
- 为每项任务绑定 Requirement ID 和 Acceptance Criterion ID；
- 生成每阶段验证策略、证据类型、修复与回滚策略；
- 校验循环依赖、孤立任务、遗漏验收标准和不可能顺序；
- 标记高风险外部操作和 `needs_user_action`；
- 支持批准、修改、退回技术方案/PRD 和版本 Diff；
- 生成阶段 3 所需的只读 `DevelopmentStartEnvelope`，固定三类文档 Version/Hash、Workflow/Policy Version。

### 10.3 `DevelopmentStartEnvelope`

至少包含：

```text
workspaceId / projectId
planningWorkflowRunId
projectSpecVersionId / hash
technicalDesignVersionId / hash
executionPlanVersionId / hash
approvalIds[]
workflowDefinitionVersion / checksum
validationPolicyVersion
createdAt
```

它只是阶段 3 的确定性输入，不是代码生成命令；任何绑定对象失效后，该 Envelope 立即不可用。

### 10.4 Exit Gate P2-D

- Requirement/Acceptance Criterion 覆盖率达到 100% 或有明确豁免；
- 依赖图无环且所有任务可达；
- 修改技术方案或 PRD 后旧计划和 Envelope 失效；
- 三次审批后只生成一个有效 Envelope；
- 阶段 3 团队可仅依赖该 Envelope 和绑定文档开始设计开发执行。

## 11. P2-05：Temporal 与 ProductFac 平台集成

> 独立版实施（2026-08-28）：本阶段当前实现为本地原子 Checkpoint、可暂停/恢复工作流、乐观版本冲突保护及事务 Outbox；不连接 ProductFac、Temporal 或 Neon。原生产集成工作项保留为可选后续路线，详见 ADR 009。

### 11.1 前置条件

此里程碑必须等待 ProductFac P1-02 完成并通过 Gate G1，不得用 ProductWoc 的临时实现替代平台能力。

### 11.2 工作项

- 在 ProductFac Workflow Registry 注册版本化 Planning v2 定义和四个 Stage；
- 实现 Parent Workflow、Stage 编排、Update/Signal 和 Query 兼容；
- 将模型、文档持久化、失效和事件写入封装为 Activity；
- 在 ProductFac PlatformStore 落地三类版本表、Decision/Approval、当前指针和 Context Snapshot；
- 同事务写领域变化、Audit 和 Outbox；
- 接入跨进程 Timeline/SSE 投影；
- 为 Start、Decision、Revision、Return、Cancel 命令接入请求幂等；
- 记录 Artifact ACL、Agent Run、Prompt/Model/Token/Latency/Cost；
- 实现 v1 Run 继续执行、v2 新 Run 默认启用的迁移/开关；
- 完成真实 Neon 和 Temporal 的故障恢复测试。

### 11.3 数据迁移规则

- Migration 由 ProductFac 平台包创建和执行；
- 新表先扩展、双版本读取，再切换默认，最后清理兼容代码；
- 不改写已存在 PRD v1 历史；
- 生产切换前备份 Schema 和演练前滚；
- 旧 Run 固定旧 Workflow Definition，不热升级。

### 11.4 Exit Gate P2-E

- Worker 重启和页面关闭后可恢复待确认状态；
- Activity 重试不会重复创建文档、审批或事件；
- 事件序号连续，SSE 断线可续读；
- 跨 Workspace 读写全部被拒绝；
- v1 进行中 Run 不受 v2 影响；
- 真实 Neon + Temporal 集成测试通过。

### 11.5 独立版 Exit Gate P2-E-local

- 任一确认状态可写入 Checkpoint 并在新进程 Adapter 中继续；
- Checkpoint 与状态事件在单个原子文件提交中落地；
- 发布失败的 Outbox Event 在恢复时重新投递，成功后无待处理事件；
- 重复打开已完成 Run 不创建新文档、审批或 Envelope；
- 旧 Revision 提交收到确定性的冲突错误，不静默覆盖新状态；
- 独立运行全程不连接 ProductFac、Temporal、Neon 或其他外部服务。

## 12. P2-06：ProductFac Web 体验

> 独立版实施（2026-08-28）：已在 `planning-lab` 完成本地 Project Planning Web。它直接读取本地原子 Checkpoint，不复制 ProductFac 登录、导航或生产 API；服务端固定本地 Actor/Workspace 并执行 RBAC、租户、幂等键和 Version/Hash 校验。ProductFac Next.js 合入仍为可选后续路线，详见 ADR 010。

### 12.1 目标

把完整规划能力接回统一产品工作台，不建立第二个生产 UI。

### 12.2 页面与组件

- Project Planning 页面；
- 对话与关键问题；
- 默认假设和风险提示；
- 三类文档的决策摘要卡片；
- MVP 包含/不包含；
- 全文、版本列表和结构化 Diff；
- 确认、修改某项、退回上阶段、取消；
- 时间线、重试状态、人工处理提示；
- `ready_for_development` 摘要和 DevelopmentStartEnvelope 状态。

### 12.3 交互规则

- 页面状态来自服务端 Snapshot；
- 所有写操作带 Idempotency Key 和当前 Subject Version/Hash；
- 审批前展示被审批版本，不使用缓存中的旧对象；
- SSE 只做实时更新，重新查询是最终校正；
- 用户离开页面不取消 Workflow；
- 高风险或不支持需求使用明确阻断卡片，不静默降级。

### 12.4 Playwright 场景

- 新项目从 idea 完成三次审批；
- 采用默认回答和手工回答；
- PRD 修订两次后批准；
- 从技术方案退回 PRD，验证下游失效；
- 从计划退回技术方案；
- 重复点击确认；
- SSE 断线重连和页面刷新恢复；
- Viewer 不可修改，Editor 可规划，跨租户不可访问。

### 12.5 Exit Gate P2-F

- 关键路径 Playwright 全部通过；
- 用户无需阅读全文即可通过摘要发现范围和风险；
- 全文与 Diff 随时可查看；
- 所有错误都有恢复或人工处理路径；
- 可访问性和桌面/移动基础响应式通过。

### 12.6 独立版 Exit Gate P2-F-local

- 从 Idea 到三次明确审批、三份文档和唯一 DevelopmentStartEnvelope 的浏览器路径通过；
- 页面刷新从文件 Checkpoint 恢复，SSE 更新后仍以重新查询结果为准；
- 审批、修订、返回上阶段和取消均由服务端命令处理，写操作绑定幂等键、Version 与 Hash；
- Viewer、跨 Workspace、过期绑定和重复命令测试通过；
- 三份决策摘要、全文、版本列表与结构化 Diff 可查看；
- 窄屏无横向溢出，跳到主要内容和键盘焦点路径可用；
- 本地浏览器验收与 Vitest 集成测试通过，不连接 ProductFac 或远程服务。

## 13. P2-07：Eval、安全和 Gate G2

> 独立版实施（2026-08-28）：已建立 20 个固定多语言 Fixture、套件级质量/成本指标、Reference 信任隔离、Secret/PII 边界及可重复执行的本地 Gate G2。生产模型成本和 ProductFac 基础设施安全仍属于未来可选集成路线，详见 ADR 011 与 `docs/p2-07-gate-g2-report.md`。

### 13.1 Eval 数据集

至少 20 个固定 Fixture，覆盖：

- CRUD SaaS；
- 管理后台/内部工具；
- 内容、表单和轻工作流产品；
- 极度模糊或互相冲突的需求；
- 超出黄金栈范围的需求；
- 需要付费、高风险外部写操作或合规敏感的需求；
- 带附件、历史 Memory 或社区 Blueprint 参考的需求；
- 中文、英文及中英混合输入。

每个 Fixture 固定输入、期望关键决策、禁止行为、Schema Version、Prompt Version 和评分器。

### 13.2 质量指标

- 关键问题数量与必要性；
- MVP 边界、假设和风险完整度；
- PRD/技术方案/执行计划一致性；
- Requirement → Design → Task 覆盖率；
- Schema 首次通过率、修复率、人工接管率；
- 上游变更失效正确率；
- 不支持需求识别和诚实降级；
- Reference/Memory 越权影响次数为 0；
- 单流程 Token、时延和成本。

### 13.3 安全测试

- Workspace RBAC 和 IDOR；
- Subject Version/Hash 替换；
- 重放、重复请求和乱序 Update；
- Prompt Injection、恶意附件和恶意 Blueprint；
- Secret/PII 泄漏到 Prompt、日志、事件或 Markdown；
- Artifact URL 和原始输出 ACL；
- Audit 不可变和失效原因可追踪。

### 13.4 Gate G2

按 ProductFac 原计划执行：

1. 产品负责人选择 5 个不同需求，分别走完 Discovery、PRD、技术方案和执行计划；
2. 确认决策摘要足以控制 Agent，不需要每次阅读全文；
3. 修改一个已经审批的 PRD；
4. 验证旧技术方案、旧计划、旧审批、旧上下文和旧 DevelopmentStartEnvelope 均不能推进新版本；
5. 验证每个完成项目只有一个有效 `ready_for_development` 起点。

Gate 失败必须回到对应里程碑修复并重跑 Eval，不以人工口头豁免代替证据。

### 13.5 独立版 Exit Gate P2-G-local

- 20 个 Fixture 覆盖 10 类需求以及中文、英文和混合输入；
- Discovery、Project Spec、Technical Design、Execution Plan 的确定性基线评分全部通过；
- MVP 边界、假设/风险、预期决策、禁止行为、覆盖率、Schema、修复、人工接管、失效和成本字段进入统一报告；
- 附件、Memory 和 Blueprint 统一标记为不可信、不可执行指令，越权影响次数为 0；
- Secret/PII 在进入模型上下文和持久化规划内容前脱敏，含敏感信息的候选输出失败关闭，原始候选标记为 Workspace Private；
- Workspace/Viewer、IDOR、Version/Hash 替换、重放、乱序、Audit 与失效原因回归通过；
- 5 个不同需求完成三次审批；完成后修订 Project Spec 会清除全部有效审批和旧 DevelopmentStartEnvelope，并在重新审批后形成唯一新起点；
- `pnpm eval:gate` 与 `pnpm check` 通过，全程不连接 ProductFac 或远程模型。

## 14. 社区衔接工作包（仅兼容，不开发社区）

### 14.1 本阶段完成

- 为三类文档保留稳定字段 ID 和来源关系；
- 提供私有 `PlanningExportCandidate` 映射测试；
- 标记可公开候选字段与必须保密字段，但不作最终发布决定；
- 支持未来把固定 Blueprint 作为不可信 Reference Context；
- 为复刻入口定义 Adapter：来源 Blueprint + 用户修改要求 → 新私有 Project 的 Discovery 输入；
- 保证新项目重新审批，绝不复制原项目 Approval。

### 14.2 本阶段不完成

- 正式 ProductBlueprintVersion；
- Release/Commit/Deployment 绑定；
- Publication Policy、Secret Scan 和公开白名单；
- CommunityProject、搜索、详情、互动和治理；
- RemixRelationship 持久化和一键复刻。

这些能力继续按 ProductFac 阶段 5、6、7 实施。

## 15. 合入 ProductFac 的目录映射

建议稳定后按以下方式合入，具体路径由 ADR 最终确认：

| ProductWoc | ProductFac 目标 |
|---|---|
| `planning-contracts` | `packages/contracts` 的 planning v2 模块或独立 `packages/planning-contracts` |
| `planning-domain` | `packages/domain` 的 planning 模块或独立 `packages/planning-domain` |
| `planning-agent` | `packages/agent` / `packages/planning-agent` |
| `planning-renderer` | `packages/planning-renderer` |
| `planning-workflow` | `apps/worker` + `packages/workflow` 的受控模块 |
| `planning-evals` | `packages/evals` / `tests/evals/planning` |
| `planning-lab` | 不进入生产；保留为 Story/Fixture 工具或删除 |

在合入前，ProductWoc 不直接修改 ProductFac 的 Auth、PlatformStore、Timeline、Outbox 或 Web 生产代码；通过 Adapter 接口和契约测试协作，减少并行冲突。

## 16. 分支、评审与契约同步

- 每个里程碑使用独立短分支或变更集；
- Schema 变化先更新 ADR、Contract Manifest 和兼容 Fixture；
- 每次同步 ProductFac 契约时记录来源 Revision 和 Schema Hash；
- 领域包变化需要领域/平台共同评审；
- Prompt 或模型路由变化必须重跑 Eval；
- Workflow、Schema、Approval Policy 的破坏性变化提升 Major Version；
- 不通过复制粘贴长期维护两份同名 Schema。

## 17. 每个切片的 Definition of Done

一个工作项只有同时满足以下条件才算完成：

- Schema、实现和错误语义明确；
- 单元、契约、集成或 Eval 测试与风险匹配；
- Workspace/RBAC 在服务端验证；
- 写操作幂等，版本与 Hash 绑定；
- 状态变化产生可观测事件和 Audit；
- Secret、PII 和受限 Artifact 不泄漏；
- Prompt/Model/Tool/Schema/Policy 可追踪；
- 文档和 ADR 已更新；
- 演示路径可复现；
- `pnpm check` 通过。

## 18. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| ProductWoc 与 ProductFac 契约漂移 | 合入返工 | Contract Manifest、Schema Hash、共享 Fixture、版本化 Adapter |
| P1-02 延迟 | 平台集成阻塞 | 先完成纯领域、Prompt、Eval 和 Temporal 测试；不复制临时平台 |
| v2 破坏 v1 Run | 已有流程中断 | 新 Workflow Version、旧 Run 固定版本、兼容 Adapter、回放测试 |
| 模型输出不稳定 | 文档质量波动 | 结构化输出、有限修复、Eval、配置化路由、人工接管 |
| PRD 修改未正确失效下游 | 错误开发起点 | 纯领域失效图、同事务指针切换、属性测试、G2 反向用例 |
| 过度提问 | 用户流失 | 阻断性评分、最多 3 问、推荐默认值、Eval 指标 |
| 社区需求提前耦合 | 阶段失焦和隐私风险 | 只做私有映射；发布/公开/复刻留到阶段 5–7 |
| 参考内容 Prompt Injection | 当前需求被覆盖 | 信任分层、引用隔离、策略校验、恶意 Fixture |
| 成本和时延过高 | 无法规模化 | 最小上下文、任务路由、缓存派生视图、Token/成本预算 |

## 19. 暂停与回退条件

出现以下任一情况暂停合入，不暂停 ProductWoc 的安全离线工作：

- ProductFac Gate G1 未通过；
- v1→v2 兼容或 Temporal Replay 失败；
- 跨租户、审批重放或 Artifact ACL 出现高危问题；
- 失效矩阵存在不能确定性复现的错误；
- Schema 成功率或人工接管率未达到团队设定基线；
- 5 个 G2 项目中任一无法从中断状态恢复。

回退策略：保留 Planning v1 为默认入口，v2 通过 Feature Flag 停用；不删除 v2 历史数据，不改写已完成审批。

## 20. 完成标准

阶段 2 完成必须同时满足：

- ProductFac Gate G1 已通过；
- P2-00 至 P2-07 的 Exit Gate 全部通过；
- 至少 20 个 Eval Fixture 建立稳定基线；
- 5 个不同项目通过完整人工验收；
- 已审批 PRD 的变更测试证明全部下游正确失效；
- 关闭页面、Worker 重启、SSE 断线和重复确认均可恢复；
- 三次确认后生成唯一、版本固定的 DevelopmentStartEnvelope；
- 私有规划内容没有进入任何社区公开表或公开 Artifact；
- Gate G2 证据、ADR、Runbook 和开发进度文档已归档。

完成后才进入 ProductFac 阶段 3“Agent 分阶段开发”。社区仍按 Blueprint 与内部复刻 → 社区公开发布 → 社区复刻闭环的顺序推进。

## 21. 推荐的第一周任务顺序

1. 完成 P2-00 工程基线和 Contract Manifest；
2. 冻结 Planning v2 第一版 Schema；
3. 实现规范化 Hash、审批有效性和失效图；
4. 建立 6 个最小领域 Fixture；
5. 实现 Project Spec JSON→Markdown 和决策摘要；
6. 与 ProductFac P1-02 对齐 Repository/Outbox/Timeline Adapter 接口；
7. 评审 P2-A，再进入 Discovery/PRD Agent 开发。

第一周不接真实数据库、不改 ProductFac 生产 Workflow，也不开发社区页面。

## 22. 参考基线

- `ProductFac/docs/product-factory-direction.md`
- `ProductFac/docs/product-factory-community-prd.md`
- `ProductFac/docs/product-factory-technical-selection.md`
- `ProductFac/docs/product-factory-phased-development-plan.md`
- `ProductFac/docs/development-progress.md`
- `ProductFac/docs/adr-007-postgresql-execution-timeline-and-sse.md`
- `ProductFac/docs/adr-012-stage-completion-controller.md`
- `ProductFac/docs/adr-013-platform-identity-workspace-rbac.md`
- `ProductFac/packages/contracts/src/index.ts`
- `ProductFac/apps/worker/src/workflows/planning.ts`
