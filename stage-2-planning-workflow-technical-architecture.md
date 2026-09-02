# 阶段 2 产品规划工作流技术架构

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档版本 | 1.0 |
| 状态 | 待确认 |
| 目标工作区 | `<workspace>/ProductWoc` |
| 对接系统 | `<workspace>/ProductFac` |
| 适用阶段 | 产品工厂阶段 2：产品规划工作流 |
| 当前平台基线 | ProductFac P1-01 已完成；P1-02、Gate G1 未完成 |

本文档以 ProductFac 当前的产品方向、社区 PRD、技术选型、总分阶段计划、开发进度和 ADR 为约束，描述 ProductWoc 如何并行开发阶段 2，并在未来无损接入 ProductFac 与社区。

> 2026-08-28 独立运行补充：ProductWoc 当前必须在不连接 ProductFac 的情况下独立跑通完整规划闭环。ProductFac 仅作为可选的未来兼容目标，不再是本地运行、测试或构建的前置条件；具体隔离边界以 ADR 008 为准。本补充不把本地内存实现定义为第二套生产平台。

## 2. 决策摘要

1. ProductWoc 不是第二个产品，也不是独立微服务；它是阶段 2 的并行开发工作区和未来可合入 ProductFac 的规划内核。
2. ProductFac 是唯一平台事实源，继续拥有账户、Workspace/RBAC、Project、PostgreSQL、迁移、Temporal 运行、Outbox、SSE、Artifact ACL 和社区公开读模型。
3. ProductWoc 只拥有可独立验证的纯领域能力：规划 Schema、不可变文档版本、审批与失效规则、上下文装配、Prompt、Markdown 渲染、Diff、Eval 和平台适配接口。
4. ProductWoc 可以立即开发纯逻辑；真实持久化、跨进程事件投影和端到端接入必须等待 ProductFac P1-02 完成并通过 Gate G1。
5. 规划文档以规范化 JSON 为权威内容，Markdown 是派生视图；审批绑定不可变版本、规范化内容 Hash、Workflow/Stage Run 和 Policy Version。
6. 阶段 2 只生成私有的“社区可映射”规划资料，不创建 CommunityProject、Publication 或公开 Blueprint；公开与复刻仍按 ProductFac 阶段 5–7 实施。

## 3. 目标与非目标

### 3.1 目标

实现以下可暂停、可恢复、可修改、可追踪的闭环：

```text
一句话需求
→ 需求理解与默认假设
→ 最多 1–3 个关键问题
→ PRD 草稿与确认
→ 技术方案与确认
→ 分阶段执行计划与确认
→ ready_for_development
```

必须满足：

- 用户不阅读全文，也可通过决策摘要控制 Agent；
- 三类文档均为不可变版本，可查看全文和版本 Diff；
- 重复确认幂等，不会推进两次；
- 修改上游后，下游文档、审批、上下文快照和证据确定性失效；
- Agent 输出不直接决定业务状态，Schema、领域规则和用户审批才可推进状态；
- 页面关闭或 Worker 重启后，待确认流程仍可恢复；
- 不支持或高风险需求必须明确说明，不伪装为可交付。

### 3.2 非目标

本阶段不包含：

- 生成或修改业务代码；
- E2B 沙箱开发、自检、预览和部署；
- 高保真视觉设计；
- Product Release、Product Blueprint 正式发布；
- 社区首页、公开详情、互动、审核和一键复刻；
- 另建身份系统、数据库、队列、工作流平台或社区数据副本。

## 4. 当前基线与并行开发约束

ProductFac 当前已有：

- Node.js 24、pnpm 11、Turborepo、TypeScript strict、Vitest；
- Next.js 16 Web 与 Temporal TypeScript Worker；
- Zod 契约、Workflow Registry、Approval Binding、Execution Event；
- Better Auth 数据库 Session、Workspace RBAC、Project CRUD；
- PostgreSQL/Neon Migration、Audit、Outbox/Idempotency 基础表；
- 受保护的 Planning/PRD Decision/SSE API；
- PRD v1 生成、修订、审批、拒绝的最小 Temporal 闭环。

现有 Planning 契约只覆盖：

```text
generating_prd
→ awaiting_prd_approval
→ revision_requested | ready_for_technical_design | cancelled
```

现有实现仍是阶段 2 的垂直切片，不等于完整阶段 2。ProductWoc 必须以版本化 v2 契约扩展，不能直接破坏 v1。

| 能力 | ProductWoc 可立即开发 | 接入 ProductFac 的前置条件 |
|---|---:|---|
| Schema、领域状态机、Hash、Diff | 是 | 无 |
| Prompt、上下文装配、Markdown 渲染 | 是 | 无 |
| Fixture、Eval、属性测试 | 是 | 无 |
| Temporal Workflow 纯逻辑与测试环境 | 是 | 固定 v2 契约 |
| PostgreSQL 版本表和审批持久化 | 仅设计适配器 | P1-02 运行记录与迁移边界稳定 |
| Outbox、幂等、跨进程投影 | 仅契约测试 | P1-02 完成 |
| ProductFac Web 集成 | 可做无后端原型 | Gate G1 通过后接真实 API |
| 社区公开与复刻 | 否 | 阶段 5–7 |

## 5. 系统边界与所有权

```text
ProductFac Web / API
  ├─ Better Auth + Workspace RBAC             [ProductFac]
  ├─ Project / PlatformStore                   [ProductFac]
  ├─ Planning Application Port                [共享契约]
  │    └─ ProductWoc Planning Kernel           [ProductWoc]
  │         ├─ Discovery / Clarification
  │         ├─ Project Spec
  │         ├─ Technical Design
  │         ├─ Execution Plan
  │         ├─ Approval / Invalidation
  │         └─ Context / Prompt / Eval
  ├─ Temporal Worker Adapter                   [最终由 ProductFac 托管]
  ├─ PostgreSQL + Outbox + Audit + SSE         [ProductFac]
  └─ Release / Blueprint / Community           [ProductFac，后续阶段]
```

### 5.1 ProductWoc 拥有

- `planning-contracts`：阶段 2 v2 输入、输出、命令、事件和文档 Schema；
- `planning-domain`：状态转换、版本指针、审批有效性、下游失效图；
- `planning-agent`：Provider 接口、任务路由、上下文装配、结构化输出校验；
- `planning-renderer`：JSON 到 Markdown、决策摘要和版本 Diff；
- `planning-evals`：至少 20 个 Fixture、评分器和回归基线；
- `planning-adapters`：对 Temporal、PlatformStore、ArtifactStore 的端口定义和测试替身。

### 5.2 ProductFac 保留

- 用户、Session、Workspace Membership 和 RBAC；
- Project 及项目状态；
- 数据库 Schema、Migration 和事务边界；
- WorkflowRun、StageRun、AgentRun、Artifact、Audit、Outbox、Idempotency；
- Temporal Client/Worker 的生产部署和 Task Queue；
- SSE 时间线、对象存储与访问控制；
- Release、Blueprint、Publication、CommunityProject、RemixRelationship。

### 5.3 禁止重复建设

ProductWoc 不得拥有独立生产数据库、身份系统、Project 表、社区表、发布表或长期运行的第二套 Temporal Namespace。测试可使用内存仓储、Temporal Test Server 和 Fixture，但不能成为另一个事实源。

## 6. 技术栈适配

| 层 | ProductFac 基线 | ProductWoc 选择 | 适配原则 |
|---|---|---|---|
| Runtime | Node.js `>=24 <25` | 完全一致 | 避免构建和 Temporal SDK 差异 |
| 包管理 | pnpm 11 | 完全一致 | 固定精确版本与 lockfile |
| 语言 | TypeScript 5.9 strict | 完全一致 | 共享类型与编译配置 |
| Monorepo | Turborepo | pnpm workspace + Turbo | 包可原样合入 ProductFac |
| 契约 | Zod | Zod + 导出 JSON Schema | Zod 为内部契约；Blueprint 后续用 JSON Schema 2020-12/Ajv |
| 工作流 | Temporal TS SDK | 纯 Workflow + Adapter | Workflow 禁止非确定性 IO |
| Agent | Responses API Provider | Provider/ModelRouter 接口 | 模型名称配置化，不散落业务代码 |
| 数据 | PostgreSQL/Neon + Drizzle | Repository Port + 内存实现 | 生产 Schema 与迁移只在 ProductFac 落地 |
| UI | Next.js 16、React、Tailwind、shadcn/ui | Headless view model；可选 Storybook/测试页 | 最终 UI 合入 ProductFac Web |
| 测试 | Vitest、Playwright | Vitest、Temporal tests、契约/Eval | Gate 命令可并入 `pnpm check` |
| 观测 | OTel、Sentry、Execution Event | 结构化 Run Metrics/Events | 由 ProductFac Adapter 落库与上报 |

不在 ProductWoc 单独引入新的 Web 框架、ORM、认证库、消息队列或状态管理平台。

## 7. 包与依赖结构

建议 ProductWoc 初始结构：

```text
ProductWoc/
├─ docs/
├─ packages/
│  ├─ planning-contracts/
│  ├─ planning-domain/
│  ├─ planning-agent/
│  ├─ planning-renderer/
│  ├─ planning-workflow/
│  └─ planning-evals/
├─ apps/
│  └─ planning-lab/          # 仅本地验证，不是第二个产品
├─ fixtures/
└─ scripts/
```

依赖方向固定为：

```text
planning-contracts
  ↑ planning-domain
  ↑ planning-agent / planning-renderer
  ↑ planning-workflow
  ↑ planning-lab / ProductFac adapters
```

`planning-domain` 不得依赖 Next.js、Temporal、数据库、OpenAI SDK、Artifact Provider 或 ProductFac Web。

## 8. 契约兼容策略

ProductFac 的 `@product-factory/contracts` 是平台契约权威源。ProductWoc 不手工复制后长期分叉，而使用“契约兼容包”工作：

```text
PlanningContractManifest
  contractVersion
  sourceRevision
  workflowKey
  workflowVersion
  definitionChecksum
  inputSchemaVersion
  eventSchemaVersion
  approvalPolicyVersion
  minimumPlatformCapability
```

开发期可使用固定本地包或打包产物；CI 必须校验 Manifest、导出 Schema Hash 和共享 Fixture。任何破坏性变更提升 Major Version，禁止静默覆盖。

### 8.1 v1 到 v2

- 保留当前 PRD v1 API 和状态，作为兼容入口；
- 新增完整 `PlanningWorkflowInputV2`、`PlanningSnapshotV2` 和文档版本 Schema；
- 使用显式 v1→v2 Adapter，不在 v1 字段中塞入新含义；
- 新 Workflow Run 固定 `product-factory-planning@2.x`；已启动的 v1 Run 继续按 v1 执行；
- 只有通过契约测试、回放测试和迁移演练后才将 v2 设为默认。

建议 v2 输入至少包含：`workspaceId`、`projectId`、`requestedBy`、`requestId`、`idea`、固定的 Workflow/Policy 版本和可选 Reference Artifact ID。权限仍必须在 ProductFac 服务端检查，不能信任输入中的 Actor 信息。

## 9. 规划工作流设计

### 9.1 固定 Stage

| Stage Key | 目标 | 权威产物 | 用户门禁 |
|---|---|---|---|
| `discovery` | 理解需求、假设与关键问题 | Decision/Answer 记录，更新草稿上下文 | 仅在存在关键不确定性时提问 |
| `product_spec` | 明确 MVP、需求与验收标准 | `ProjectSpecVersion` | PRD 确认 |
| `technical_design` | 在黄金栈内形成实现方案 | `TechnicalDesignVersion` | 技术方案确认 |
| `execution_plan` | 形成可执行阶段、依赖与检查 | `ExecutionPlanVersion` | 开发计划确认 |

Discovery 不创建第四份可审批长文档。用户回答、确定性事实和确认的假设写入 Decision Log，并作为 Project Spec 的来源。

### 9.2 状态机

```text
collecting_idea
→ analyzing_request
→ awaiting_clarification? ──回答──┐
→ generating_product_spec        │
→ awaiting_product_spec_approval │
   ├─ revise ────────────────────┘
   ├─ reject → cancelled
   └─ approve
→ generating_technical_design
→ awaiting_technical_design_approval
   ├─ revise → generating_technical_design
   ├─ back_to_spec → generating_product_spec + 下游失效
   └─ approve
→ generating_execution_plan
→ awaiting_execution_plan_approval
   ├─ revise → generating_execution_plan
   ├─ back_to_design/spec → 对应上游 + 下游失效
   └─ approve
→ ready_for_development
```

所有生成状态均允许进入 `needs_user_action`、可恢复失败或 `cancelled`。状态转换必须由领域函数验证；模型只返回候选内容。

### 9.3 澄清规则

- 最多一次展示 1–3 个真正阻断 PRD 的问题；
- 每个问题提供推荐默认值、影响和“采用默认值”选项；
- 非阻断信息直接记录为显式假设，不进行无休止访谈；
- 超出黄金栈、高风险外部操作或合规敏感需求进入 `needs_user_action`；
- 用户可在任意确认点修改单项或退回上阶段。

## 10. 权威文档模型

模型输出规范化 JSON，经 Schema 校验后持久化为不可变版本；Markdown、摘要卡片和 Diff 都从 JSON 派生。

### 10.1 ProjectSpecVersion

至少包含：

- 产品摘要、目标用户、核心任务与成功指标；
- 场景、用户流程和早期交互结构；
- MVP `inScope` / `outOfScope`；
- 带稳定 ID 的功能需求与验收标准；
- 非功能约束、默认假设、开放问题和风险；
- 来源 Decision、Reference Artifact 和 Prompt/Model 版本；
- `versionId`、`version`、`normalizedContentHash`、`createdAt`。

### 10.2 TechnicalDesignVersion

至少包含：

- 架构边界与黄金技术栈符合性；
- 模块、数据模型、API、权限和状态生命周期；
- 外部依赖、错误处理、安全和隐私；
- 测试、观测、迁移、回滚和风险权衡；
- Requirement ID → 设计项的追踪矩阵；
- 对应的 `projectSpecVersionId/hash`。

### 10.3 ExecutionPlanVersion

至少包含：

- 阶段、任务、依赖图和完成标准；
- Requirement/Acceptance Criterion 覆盖关系；
- 每阶段验证策略、证据要求、返工与回滚策略；
- 预估风险和需要用户参与的门禁；
- 对应的 Project Spec 与 Technical Design 版本/Hash。

### 10.4 内容 Hash

Hash 只基于规范化权威 JSON：对象键排序、空白规范、稳定数组语义和 Schema Version 固定。展示 Markdown、时间戳、模型措辞或 UI 折叠状态不得污染内容 Hash。

## 11. 审批、版本与失效

每次审批至少绑定：

```text
project_id
workflow_run_id
stage_run_id
subject_type
subject_version_id
subject_hash
approval_policy_version
approved_by
approved_at
```

### 11.1 失效矩阵

| 发生变化 | 立即失效 |
|---|---|
| Project Spec 内容 Hash 改变 | 旧 PRD 审批、Technical Design、Execution Plan、其审批、下游上下文/证据 |
| Technical Design 内容 Hash 改变 | 旧技术审批、Execution Plan、其审批、下游上下文/证据 |
| Execution Plan 内容 Hash 改变 | 旧计划审批、开发起点和下游上下文/证据 |
| Workflow/Policy/Schema 发生不兼容变化 | 与旧版本绑定的推进资格；历史记录保留 |
| 仅展示格式改变，规范化 Hash 不变 | 不失效 |

失效不是删除。旧版本、审批和原因保留审计，但不能成为当前有效指针或推进新 Run。

## 12. Agent 与上下文架构

```text
Planning Task
→ Context Assembler
→ Model Router / Responses Provider
→ Structured Output Validator
→ Limited Repair
→ Domain Policy Check
→ Persist Candidate Version
→ Derived Markdown / Decision Summary
→ User Approval
```

### 12.1 上下文分层

| 层 | 内容 | 可否推动状态 |
|---|---|---:|
| Authoritative Spec | 当前有效且已确认的规划文档 | 是，经领域校验 |
| Decision Log | 用户回答、审批、退回与失效关系 | 是 |
| Execution State | 当前 Stage、版本和待办 | 是，经领域校验 |
| Project Memory | 稳定偏好与已验证经验 | 否 |
| Reference Context | 附件、历史摘要、未来社区 Blueprint | 否 |
| Artifact Reference | 原始输出、附件、日志的摘要和 Hash | 否 |

只发送当前任务的最小上下文。参考内容按“不可信数据”标记，不能覆盖当前用户要求、平台策略、工具权限或审批规则。只有用户确认或确定性系统事实才能升级为权威内容。

### 12.2 Provider 和路由

- 业务代码只依赖 `PlanningModelProvider` 和 `ModelRouter`；
- 路由键按任务角色配置，如 `fast_extract`、`planning`、`architecture_review`；
- 具体模型名、超时、重试和预算由 ProductFac 环境配置；
- 每次生成记录 Provider、模型快照、Prompt Version、Tool Policy、Token、时延和成本；
- Schema 失败仅有限修复，仍失败则转人工，不把自由文本写入权威字段。

## 13. 应用端口、命令与事件

### 13.1 应用端口

ProductWoc 暴露以下抽象，ProductFac 提供生产实现：

- `PlanningRunRepository`；
- `PlanningDocumentRepository`；
- `DecisionRepository`；
- `ArtifactRepository`；
- `PlanningEventPublisher`；
- `PlanningModelProvider`；
- `Clock`、`IdGenerator` 和 `ContentHasher`。

### 13.2 命令

建议命令使用唯一 `requestId/idempotencyKey`：

- `StartPlanning`；
- `SubmitClarificationAnswers`；
- `ApproveSubject`；
- `RequestSubjectRevision`；
- `ReturnToPreviousStage`；
- `CancelPlanning`；
- `ResumePlanning`。

重复命令必须返回第一次的确定性结果。审批请求中的 Version/Hash 不匹配时返回 `subject_mismatch`，不得自动套用到新版本。

### 13.3 事件

复用 ProductFac Execution Event 模型，并按需以兼容方式扩展 Payload：

- `workflow_started`、`stage_started`；
- `artifact_recorded`；
- `approval_requested`、`approval_received`；
- `validation_failed`、`repair_started`；
- `stage_completed`。

事件通过 ProductFac Transactional Outbox 投影至时间线。事件是读模型和可观测记录，不替代领域文档、PostgreSQL 事实或 Temporal History。

## 14. 数据与持久化

阶段 2 生产数据最终进入 ProductFac PostgreSQL：

- `project_spec_versions`；
- `technical_design_versions`；
- `execution_plan_versions`；
- `decisions` / `approval_bindings`；
- `workflow_runs` / `stage_runs`；
- `planning_context_snapshots`；
- `artifacts`；
- `execution_events` / `outbox_events` / `audit_logs`。

规则：

- 版本内容只追加，不原地更新；
- 当前有效指针与新版本在同一事务内切换；
- 上游变更与下游失效记录同事务提交；
- 大型原始模型输出和附件进入 Artifact Store，数据库只存摘要、Hash 和 ACL 引用；
- 所有查询带 `actorId + workspaceId`，服务端执行 RBAC；
- ProductWoc 不自行创建生产迁移，迁移由 ProductFac 平台包评审和执行。

## 15. Temporal 运行设计

- Parent Workflow 表示一次产品规划过程；
- 四个固定 Stage 可用 Child Workflow 或版本化阶段函数实现；
- Agent 调用、持久化和事件写入是 Activity；
- 用户审批优先使用带校验的 Update，Signal 仅作兼容入口；
- UI 从 PostgreSQL Planning Read Model 查询，Temporal Query 只用于诊断；
- Activity Retry 必须配合请求幂等和 Outbox；
- 长时间等待通过 Temporal 持久化，不在 Web 内存中保存；
- Rework 创建新文档版本和必要的新 Stage Run，不覆盖历史；
- Workflow Run 固定 Workflow/Stage/Schema/Prompt/Policy 版本，升级不改变进行中的 Run。

Temporal Workflow 代码只做确定性编排；时间、随机 ID、网络、数据库和模型调用都经 Activity 或注入的确定性值完成。

### 15.1 独立运行实现

在不连接 ProductFac 的独立模式下，Temporal/PostgreSQL 组合由本地可替换运行层代替：每个状态转换把完整 Planning Checkpoint 与新 Outbox Event 写入同一 JSON 记录，临时文件完成写入后通过原子 Rename 切换；每次提交校验期望 Revision。重启时先投递未发布 Outbox，再从 Checkpoint 的确定状态继续。该实现只用于本地开发和验收，不改变领域状态机，也不充当第二套生产平台，详见 ADR 009。

## 16. Web 与交互适配

最终由 ProductFac Next.js Web 承载：

- 对话与关键问题区；
- 决策摘要卡片；
- 默认假设与风险提示；
- MVP 包含/不包含；
- 文档全文与版本 Diff；
- 确认、修改某项、退回上阶段；
- 工作流时间线与恢复提示。

ProductWoc 可先开发 Headless View Model 和本地 Lab，但不得复制 ProductFac 的登录、项目导航和生产 API。所有按钮状态由服务端 Snapshot 决定，前端隐藏按钮不构成权限控制。

### 16.1 独立 Web 实现

独立版由 `planning-lab` 提供零框架本地 HTTP Shell、Headless View Model 和文件 Checkpoint Adapter。页面只消费服务端派生视图；服务端固定本地身份上下文，并在每次读写时验证 Workspace、Role、幂等键、Subject Version 与 Hash。审批门不会由页面自动跨越，刷新通过 Query 恢复，SSE 仅用于提示重新读取。文档修订保留单调版本历史并生成结构化 JSON Diff。该 Lab 不实现登录、远程部署或 ProductFac 生产导航，详见 ADR 010。

## 17. 与未来社区的衔接

阶段 2 只保证“可映射”，不提前发布：

| 私有规划来源 | 阶段 5 Blueprint 候选字段 |
|---|---|
| ProjectSpecVersion | 产品摘要、用户、需求、范围、验收标准 |
| TechnicalDesignVersion | 架构、黄金栈、数据/API 契约、环境变量名称 |
| ExecutionPlanVersion | 里程碑、验证策略、依赖关系 |
| Decision/Approval | 默认不公开；仅生成白名单摘要 |

正式 Blueprint 必须在已验收 ProjectRelease 后生成，绑定固定 Commit、Release、Schema Version 和 Hash，并经过发布白名单与 Secret 扫描。私有 PRD、聊天、Prompt、内部决策、未脱敏 Artifact 和生产数据不得进入社区。

未来社区复刻的入口规则：

1. 固定 Blueprint/Release 作为 `Reference Context`，标记为不可信参考；
2. 保留来源、许可证和不可变版本标识；
3. 用户定制要求进入新的私有 Project；
4. 重新走本阶段全部确认，不把原作者审批复制为新项目审批；
5. `RemixRelationship` 由 ProductFac 社区模块在后续阶段保存。

ProductWoc 不创建 CommunityProject、Publication 或公开搜索索引。

## 18. 安全、隐私与权限

- 默认私有，工作区外不可读取规划内容；
- 服务端验证 Session、Membership 和资源所属关系；
- Secret 不进入 Prompt、日志、Markdown、事件 Payload 或未来 Blueprint；
- 社区、上传文件和历史 Memory 均按不可信输入处理；
- 原始模型输出采用受限 Artifact ACL；
- 审批、退回、失效和人工接管写入 append-only Audit；
- 高风险外部操作不在阶段 2 自动执行；
- 日志只记录 ID、Hash、状态、耗时和脱敏错误摘要。

### 18.1 独立安全实现

本地 Agent 边界在模型调用前脱敏常见凭据、私钥、邮箱和手机号；附件、Memory 与 Blueprint Reference 均附带 `trust=untrusted` 和 `instructionPolicy=never_follow`，不能覆盖当前用户请求。结构化候选在物化前再次扫描，发现敏感内容即进入人工处理，原始候选仅标记为 `workspace_private`。本地实现不声称替代生产 Artifact ACL、DLP 或合规审计，详见 ADR 011。

## 19. 可观测性与恢复

每次 Agent Run 记录：

- `workspaceId/projectId/workflowRunId/stageRunId/agentRunId`；
- 输入文档版本与 Hash；
- Prompt/Model/Tool/Schema/Policy Version；
- Token、时延、费用、重试和解析结果；
- 输出 Artifact ID、候选文档 Version/Hash；
- 错误分类：内容可修复、用户处理、基础设施错误、终止失败。

恢复原则：

- Worker 重启后从 Temporal History 和 PostgreSQL 事实恢复；
- 页面通过 SSE `Last-Event-ID` 续读，并以查询结果校正；
- Activity 重试不能重复创建版本或审批；
- 无法确定外部调用结果时进入人工核对，不盲目重放；
- 新版本必须显式失效旧推进资格。

## 20. 测试与 Gate

### 20.1 测试层级

- Schema 示例/反例与向后兼容测试；
- 状态机和失效图属性测试；
- 内容 Hash 稳定性与 Markdown 派生测试；
- 重复命令、乱序审批、Version/Hash 不匹配测试；
- Temporal time-skipping、重试、取消、恢复和回放测试；
- ProductFac Adapter 契约测试；
- RBAC、跨租户和 Artifact ACL 测试；
- 至少 20 个需求的 Prompt/Eval 回归；
- Playwright 完整确认、修改、返回和恢复流程。

### 20.2 Eval 指标

- 关键问题是否不超过 3 个且真正阻断；
- MVP 边界和默认假设是否清楚；
- Requirement → Design → Plan 覆盖率；
- Schema 首次成功率、修复率和人工接管率；
- 上游修改后的失效正确率；
- 不支持需求识别率；
- Memory/社区参考覆盖当前用户要求的违规数必须为 0；
- Token、时延与单次完整规划成本。

### 20.3 Gate G2（保持 ProductFac 原定义）

产品负责人选择 5 个不同需求走完流程，确认结构化决策摘要足以控制 Agent；再修改一个已审批 PRD，证明旧技术方案、计划和审批不会错误推进新版本。三次有效确认后，每个项目只能进入一个确定的 `ready_for_development` 起点。

独立 Gate G2 使用内存/文件 Adapter 和确定性离线模型执行同一领域约束。`ready_for_development` 允许通过显式 Return 命令重新进入受控修订；记录新版本后旧指针、有效审批、上下文资格和 DevelopmentStartEnvelope 同步失效，历史记录保持追加不可变。

## 21. 集成准入条件

ProductWoc 进入 ProductFac 主流程前必须同时满足：

- ProductWoc 全部 Schema、领域、Workflow、Eval 测试通过；
- v1→v2 Adapter 和共享 Contract Manifest 校验通过；
- ProductFac P1-02 完成，Gate G1 通过；
- PostgreSQL 迁移完成演练，含回滚/前滚策略；
- Outbox Claim/重试、请求幂等和跨进程投影已验证；
- Workspace/RBAC、跨租户、Audit、Artifact ACL 安全测试通过；
- 进行中的 v1 Run 不被 v2 发布破坏；
- 真实 Neon + Temporal + Web 的端到端恢复测试通过。

## 22. 需要记录为 ADR 的决策

实施时至少补充：

1. 阶段 2 v2 契约与 v1 兼容/迁移策略；
2. 规范化 JSON、内容 Hash 和 Markdown 派生规则；
3. 上游变更的失效图与当前有效指针事务；
4. Planning Workflow 的 Parent/Child 边界和 Continue-As-New 策略；
5. ProductWoc 合入 ProductFac 的包发布或源码迁移方式；
6. 社区 Blueprint 映射白名单由阶段 5 最终确认，本阶段不提前固定公开字段。

## 23. 参考基线

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
