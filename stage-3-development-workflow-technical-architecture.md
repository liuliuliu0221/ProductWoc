# 阶段 3 本地 Agent 开发工作流技术架构

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档版本 | 0.1 |
| 状态 | 已确认 |
| 日期 | 2026-08-28 |
| 目标仓库 | ProductWoc 开源仓库 |
| 适用阶段 | 阶段 3：本地 Agent 分阶段开发 |
| 前置条件 | 阶段 2 P2-00～P2-07 与独立 Gate G2 已通过 |
| 运行方式 | 本地优先、用户自带模型、无托管服务依赖 |

本文档定义 ProductWoc 如何消费阶段 2 生成的 `DevelopmentStartEnvelope`，在用户本地代码工作区中按 Execution Plan 执行任务、验证结果、有限修复并形成可审计证据。

ProductWoc 将作为独立开源项目发布到 GitHub。GitHub 负责源码协作、Issue、CI 和 Release，不承担 ProductWoc 应用托管。阶段 3 不设计远程部署、生产环境发布或云端执行平台。

## 2. 决策摘要

1. 阶段 3 只消费通过校验的 `DevelopmentStartEnvelope` 和其绑定的三份固定规划文档。
2. 第一版只支持本地串行任务执行；没有证据证明安全前，不并行修改同一工作区。
3. 代码修改必须形成 Patch Journal、文件 Hash、验证证据和可恢复 Checkpoint，Agent 不能直接宣称任务完成。
4. 远程部署、生产写入、支付、发布和凭据操作全部不在阶段 3 执行范围内。
5. 所有用户拥有相同模型配置能力，不设置普通/高级用户或商业套餐边界。
6. 默认只选择一个项目模型；任何用户都可为 Discovery、Project Spec、Technical Design、Execution Plan、Implementation、Review 和 Repair 单独覆盖模型。
7. 每个 Agent Run 启动时锁定 Provider、Model、参数、Prompt、工具策略和上下文 Hash；运行中不静默换模型。
8. 模型输出只是变更候选。Schema、任务前置条件、工具策略、测试结果和用户 Gate 共同决定是否推进。
9. 本地文件 Checkpoint 继续作为独立运行事实源；所有远程 Provider 都是可替换 Adapter。
10. 开源发布前必须完成许可证选择、安全政策、贡献指南、CI 和无凭据扫描。

## 3. 目标与非目标

### 3.1 目标

实现以下本地闭环：

```text
DevelopmentStartEnvelope
→ 校验规划绑定
→ 创建 Development Run
→ 解析 Phase / Task DAG
→ 准备最小任务上下文
→ 生成并应用候选 Patch
→ 运行验证
→ 有限修复或回滚
→ 用户阶段 Gate
→ development_completed
```

必须满足：

- 用户可以在本地仓库中观察每个任务修改了什么以及为什么；
- 每个完成结论都有命令、测试报告、文件 Hash 或人工确认等证据；
- 关闭页面或重启进程后能够从确定的任务边界恢复；
- 重放同一命令不会重复应用 Patch、重复记录证据或重复完成任务；
- 规划文档被修订后，旧 Development Run 不能继续推进；
- 模型、工具和上下文均可追踪并可替换；
- 无模型配置时仍可使用确定性 Fixture 和手工执行模式验证系统。

### 3.2 非目标

阶段 3 不包含：

- 远程部署、云端预览、生产发布或托管服务；
- 自动读取或使用生产凭据；
- 自动支付、采购、发邮件、发消息或修改外部业务系统；
- 自建远程沙箱、队列、数据库、身份系统或多租户 SaaS；
- 自动合并 Pull Request、自动推送 GitHub 或替用户接受许可证；
- 社区 Blueprint、应用市场、商业计费或功能分级；
- 对任意未知命令提供无限制 Shell 权限；
- 在未确认许可证前复制第三方受限代码。

## 4. 阶段 2 输入边界

阶段 3 启动前必须重新校验：

- `DevelopmentStartEnvelope` Schema；
- Workspace、Project 和 Planning Workflow Run 身份；
- Project Spec、Technical Design、Execution Plan 的 Version 与 Hash；
- 三个 Approval ID 仍为当前有效审批；
- Workflow Definition、Checksum 和 Validation Policy Version；
- Execution Plan DAG、Requirement/Acceptance/Design 覆盖率；
- 没有被失效的新版本或新的规划 Return 命令。

阶段 3 应保存只读 `DevelopmentInputSnapshot`，而不是在运行中重复读取可变规划对象：

```ts
interface DevelopmentInputSnapshot {
  developmentRunId: string;
  envelopeId: string;
  envelopeHash: string;
  projectSpecVersionId: string;
  technicalDesignVersionId: string;
  executionPlanVersionId: string;
  taskGraphHash: string;
  workspaceBaselineHash: string;
  modelPolicySnapshotId: string;
  toolPolicyVersion: string;
  createdAt: string;
}
```

任一规划绑定失效后，Development Run 进入 `stale`，只允许查看、导出证据或显式取消，不允许继续修改代码。

## 5. 系统边界

```text
Local Web / CLI
  │
  ├─ Development Application Service
  │    ├─ Envelope Validator
  │    ├─ Phase / Task Scheduler
  │    ├─ Model Router
  │    ├─ Context Assembler
  │    ├─ Tool Policy Engine
  │    ├─ Patch Transaction Manager
  │    ├─ Verification Runner
  │    └─ Evidence / Audit Projector
  │
  ├─ Local Workspace Adapter
  │    ├─ Read / Search
  │    ├─ Patch Apply
  │    ├─ Approved Command Runner
  │    └─ Baseline / Rollback Journal
  │
  ├─ Local Checkpoint + Outbox
  └─ Model Provider Adapters
       ├─ Deterministic Test Provider
       ├─ Ollama-compatible Local Provider
       └─ OpenAI-compatible User-configured Provider
```

Provider 可能访问用户配置的模型服务，但 ProductWoc 本身不托管模型、不代理密钥，也不要求公共网络才能启动、浏览历史或执行确定性测试。

## 6. 包与依赖规划

保留阶段 2 包，并新增阶段 3 包：

```text
packages/
├─ planning-contracts
├─ planning-domain
├─ planning-agent
├─ planning-workflow
├─ development-contracts    # Run、Task、Patch、Evidence、Model Policy Schema
├─ development-domain       # 状态机、DAG、Gate、失效与完成规则
├─ development-agent        # Implementation/Review/Repair Agent
├─ development-workflow     # 本地持久化编排与恢复
├─ development-adapters     # Workspace、Command、Model、Evidence 端口
└─ development-evals        # Fixture、安全和 Gate G3

apps/
└─ product-woc              # 逐步替代 planning-lab 名称的本地 Web/CLI 入口
```

依赖方向：

```text
planning-contracts ───────────────┐
development-contracts            │
  ↑ development-domain           │
  ↑ development-agent            │
  ↑ development-workflow ────────┘
  ↑ development-adapters
  ↑ local Web / CLI
```

领域包不得依赖文件系统、Shell、Git、具体模型 SDK 或 Web 框架。

## 7. 核心领域模型

### 7.1 Development Run

```ts
type DevelopmentRunStatus =
  | "validating_input"
  | "ready"
  | "running"
  | "awaiting_user_gate"
  | "paused"
  | "needs_user_action"
  | "stale"
  | "completed"
  | "failed"
  | "cancelled";
```

Development Run 保存当前 Phase/Task 指针、输入快照、模型策略快照、工具策略版本、工作区基线、Evidence 索引和已处理命令。

### 7.2 Task Run

```ts
type TaskRunStatus =
  | "pending"
  | "ready"
  | "assembling_context"
  | "generating_change"
  | "awaiting_patch_approval"
  | "applying_patch"
  | "verifying"
  | "repairing"
  | "completed"
  | "blocked"
  | "failed"
  | "rolled_back"
  | "cancelled"
  | "stale";
```

每个 Task Run 绑定：

- Execution Task ID 与 Task Definition Hash；
- 输入 Requirement、Acceptance Criterion 和 Design Item ID；
- Agent Run 和 Model Snapshot；
- Context Snapshot Hash；
- Patch Set ID 与前后文件 Hash；
- Verification Evidence ID；
- Repair 次数、失败分类和最终状态。

### 7.3 Phase Run

Phase 只在其全部 Task 完成且 Exit Criteria 证据齐全时完成。Execution Plan 中的 User Gate 必须映射为真实本地确认命令，不能由模型代替用户确认。

## 8. 调度与状态推进

第一版调度策略：

1. 验证 DevelopmentStartEnvelope；
2. 对 Phase 和 Task DAG 做拓扑排序；
3. 找到前置依赖全部完成的第一个 Task；
4. 锁定模型与上下文快照；
5. 生成单个候选 Patch；
6. 根据策略自动应用或等待用户审阅；
7. 执行任务定义中的必要验证；
8. 验证失败时进入有限 Repair；
9. 达到 Repair Budget 后进入 `needs_user_action`；
10. Phase Exit Criteria 满足后进入用户 Gate 或下一 Phase。

默认同时只有一个写 Task。只读分析可以并行，但不得改变文件、Checkpoint 或领域状态。后续并行写入必须先具备文件写集冲突检测、独立工作树和合并证据，不属于第一版。

## 9. 模型配置与路由

### 9.1 用户能力原则

所有用户都可以使用完整模型配置能力。产品只做渐进式呈现：

- 简洁配置：选择一个默认模型，所有阶段继承；
- 自定义配置：为任意阶段设置覆盖；
- 不存在普通用户、高级用户、付费解锁或隐藏能力。

### 9.2 配置层级

```text
单次 Run 显式覆盖
  ↓
项目阶段覆盖
  ↓
项目默认 Profile
  ↓
应用默认 Profile
```

建议支持的 Scope：

```text
planning.discovery
planning.project_spec
planning.technical_design
planning.execution_plan
development.implementation
development.review
development.repair
```

### 9.3 Model Profile

```ts
interface ModelProfile {
  profileId: string;
  providerType: "deterministic" | "ollama" | "openai_compatible";
  model: string;
  endpointRef?: string;
  credentialRef?: string;
  temperature: number;
  maxOutputTokens: number;
  contextWindow?: number;
  capabilities: {
    structuredOutput: boolean;
    toolCalling: boolean;
    vision: boolean;
    localOnly: boolean;
  };
}
```

配置只保存 `credentialRef`，不保存密钥值。密钥优先来自系统 Keychain 或进程环境变量；示例配置、Checkpoint、日志和 Git 永远不包含真实密钥。

### 9.4 锁定、切换与 Fallback

- Agent Run 开始时创建不可变 `ModelRunSnapshot`；
- 运行中的 Agent Run 不热切换模型；
- 模型切换产生新的 Agent Run；已有 Patch 不自动视为新模型的输出；
- 切换已完成规划阶段的模型必须产生新文档版本并走阶段 2 失效规则；
- 切换已完成开发任务的模型必须显式重跑该任务，并使依赖其输出的后续证据变为待复核；
- Provider 不可用时默认暂停并提示用户；Fallback 只有在用户预先配置且确认策略后才能发生；
- Fallback 事件必须记录原模型、目标模型、原因和新 Run ID。

### 9.5 能力协商

路由前检查模型是否满足 Stage Policy：

- Structured Output 能力；
- Context Window 是否容纳最小上下文；
- 是否允许 Tool Calling；
- 是否满足 `localOnly` 隐私要求；
- 用户是否配置有效 Endpoint/Credential Ref。

不满足时在调用前阻断，不通过猜测、截断关键约束或静默换模型降级。

## 10. 上下文装配

Implementation Agent 只接收当前任务所需内容：

- 当前 Task、其直接依赖输出和完成证据；
- 对应 Requirement、Acceptance Criteria、Design Items；
- 技术设计相关模块、数据/API 和安全规则；
- 允许修改的文件范围与工作区摘要；
- 项目级 `AGENTS.md` 和明确适用的本地约束；
- 必要的失败日志、验证输出和前一 Repair 摘要。

默认不发送：

- 完整聊天历史；
- 无关规划章节；
- `.env`、密钥、私钥和本地凭据目录；
- Git 历史中的敏感内容；
- 其他项目或 Workspace 数据；
- 原始附件全文，除非经过用户选择、脱敏和大小限制。

Context Snapshot 必须记录来源 ID、Version/Hash、裁剪规则、脱敏结果和最终 Context Hash。

## 11. 本地工作区与工具策略

### 11.1 Workspace Baseline

启动 Development Run 时记录：

- 工作区绝对路径的规范化标识；
- 文件清单与允许读取/写入范围；
- 初始文件 Hash；
- 是否为 Git 仓库、当前 Commit/Branch（如存在）；
- 用户已有未提交修改的清单；
- 忽略规则和敏感路径策略。

不得把用户已有修改当成 Agent 输出，也不得用 destructive Git 命令清理工作区。

### 11.2 工具分层

| 工具 | 默认策略 |
|---|---|
| 文件列表、读取、搜索 | 自动允许，但受工作区边界和敏感路径限制 |
| 创建/修改源文件 | 允许生成候选 Patch；按项目策略自动应用或等待确认 |
| 格式化、Lint、Typecheck、Test、Build | 命令模板匹配后允许 |
| 安装依赖 | 必须用户确认并显示包、版本和来源 |
| Git commit/tag/push | 默认不执行；显式确认后才可扩展 |
| 网络请求 | 默认拒绝；模型 Provider Endpoint 除外 |
| 删除、迁移、批量重写 | 必须用户确认并提供恢复点 |
| 部署、发布、生产写入 | 永久不在阶段 3 执行 |

Command Runner 使用结构化命令模板和参数，不接受模型拼接的任意 Shell 字符串。

## 12. Patch Transaction

每次代码变更遵循：

```text
读取基线
→ 生成候选 Patch
→ 校验路径、大小和敏感内容
→ 计算预期前置 Hash
→ 应用 Patch
→ 记录实际后置 Hash
→ 执行验证
→ Commit Evidence 或回滚 Patch
```

Patch Set 至少包含：

- Patch Set ID、Task Run ID 和 Idempotency Key；
- 修改前后的文件 Hash；
- 新增、修改、删除文件清单；
- 统一 Diff 或结构化编辑操作；
- 应用时间、工具版本和结果；
- 回滚 Patch 或恢复快照位置。

前置 Hash 不一致时拒绝应用，要求重新读取工作区并生成新候选，不能覆盖用户并发修改。

## 13. 验证、证据与完成规则

任务完成必须同时满足：

- 所有 required Verification Step 已执行；
- 命令 Exit Code、摘要和完整日志 Artifact 已记录；
- Requirement/Acceptance Criterion/Design Item 追踪仍完整；
- 没有未处理的高风险警告、敏感数据或策略违规；
- 工作区后置 Hash 与 Patch Journal 一致；
- 用户 Gate（如有）已由真实用户确认。

支持的 Evidence：

```text
test_report
typecheck_report
lint_report
build_report
file_hash_manifest
structured_diff
runtime_log
manual_confirmation
rollback_report
```

Agent 文本“已完成”不是 Evidence。

## 14. Repair 与回滚

- 默认每个 Task 最多 2 次自动 Repair，具体预算可配置；
- Repair 只能使用当前失败证据、原任务上下文和当前工作区；
- 每次 Repair 创建新的 Agent Run 和 Patch Set；
- 连续相同错误、策略错误、依赖安装失败或无法确定外部结果时停止自动重试；
- 回滚只撤销当前 Task 的已记录 Patch，不删除用户原有文件或无关修改；
- 回滚失败进入 `needs_user_action`，保留现场和恢复指引；
- 用户可以选择接受当前结果、修改计划、手工修复、重试或取消。

## 15. 持久化、幂等与恢复

沿用阶段 2 本地 Checkpoint + Outbox 模式，新增：

- Development Run Snapshot；
- Phase/Task Run；
- Model/Context/Tool Policy Snapshot；
- Patch Journal；
- Evidence Manifest；
- Process/Command Result；
- User Gate 与 Audit Entry。

状态转换与对应 Outbox Event 在同一个原子本地提交中落地。重启时：

1. 重新验证 Checkpoint Schema；
2. 校验规划 Envelope 是否仍有效；
3. 校验工作区文件 Hash 是否与最后提交一致；
4. 投递未发布事件；
5. 对 `applying_patch`、`verifying` 等不确定状态进入恢复审计；
6. 只有可证明未执行或可幂等重放的操作才自动继续。

## 16. 本地 Web 与 CLI

### 16.1 页面

在现有 Planning 页面之后增加 Development 页面：

- DevelopmentStartEnvelope 和输入校验摘要；
- Phase/Task DAG 与当前执行位置；
- 当前模型 Profile、继承来源和锁定快照；
- 当前任务上下文摘要；
- 候选 Patch、文件列表和 Diff；
- 验证步骤、实时日志和 Evidence；
- Repair 次数与失败原因；
- 继续、暂停、重试、回滚、人工完成和取消；
- Phase User Gate；
- 规划已失效或工作区漂移的阻断卡片。

### 16.2 模型设置

默认页面只显示项目默认模型。用户展开“阶段模型覆盖”后，可以为任一 Scope 选择其他 Profile；所有用户看到相同功能。

### 16.3 CLI

建议命令：

```sh
pnpm product-woc plan
pnpm product-woc develop
pnpm product-woc resume
pnpm product-woc status
pnpm product-woc verify
```

CLI 与 Web 共用 Application Service，不复制领域逻辑。

## 17. 安全与隐私

- 延续 P2-07 Secret/PII 脱敏和不可信 Reference 策略；
- 默认拒绝读取 `.env*`、SSH、云凭据、系统 Keychain 原文和浏览器数据；
- 模型上下文生成前执行路径、内容和大小策略；
- Provider 请求日志不记录 Prompt 原文和密钥；
- 命令输出先脱敏再进入摘要、事件或模型 Repair Context；
- Patch 禁止修改 ProductWoc 配置以扩大自身权限；
- 依赖新增必须显示包名、版本、许可证和脚本风险；
- 不执行远程部署、发布或生产写入；
- GitHub Token 不由开发 Agent 自动读取；
- 安全策略失败时停止，不让模型自行解释为可以继续。

## 18. 可观测性

每个 Agent Run 记录：

- Development/Phase/Task/Agent Run ID；
- Model Profile 与不可变 Model Snapshot；
- Context Hash、输入/输出 Token、时延和用户可选成本；
- Tool Call 名称、策略判定和脱敏结果；
- Patch/Evidence ID；
- 验证结果、Repair 次数和错误分类。

本地日志默认结构化保存，可由用户导出。不开启遥测上报；未来如增加匿名遥测，必须独立设计、默认关闭并明确征得用户同意。

## 19. 开源与 GitHub 发布

公开前必须具备：

- 用户明确选择的 OSI 许可证；推荐评审 Apache-2.0 与 MIT 后决定，不在本文档替用户决定；
- `README.md`、`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`；
- 架构、Provider Adapter、模型配置和本地安全说明；
- GitHub Actions 仅执行安装、Lint、Typecheck、Test、Build 和 Secret Scan；
- Dependabot/Renovate 取舍与依赖更新政策；
- Issue/PR 模板、Release Notes 和 SemVer；
- 无真实密钥、个人路径、测试私有数据和 ProductFac 运行依赖；
- Deterministic Provider 保证贡献者无需付费模型也能跑完整门禁。

阶段 3 不创建 GitHub 自动发布到服务器的 Workflow。

## 20. 测试策略

- Schema 示例/反例和版本兼容；
- Envelope 篡改、过期和规划失效；
- Phase/Task DAG 环、孤儿、乱序和重复命令；
- Model Profile 继承、覆盖、能力协商、锁定和显式 Fallback；
- 工作区越界、路径穿越、符号链接和敏感文件访问；
- Patch 前置 Hash 冲突和并发用户修改；
- 命令注入、恶意仓库说明、Prompt Injection 和依赖脚本风险；
- 验证失败、Repair Budget、回滚失败和进程中断恢复；
- 规划修订使 Development Run 进入 `stale`；
- Web/CLI 的暂停、恢复、Gate 和 Evidence 浏览；
- Windows/macOS/Linux 的路径和命令策略兼容性；
- 至少 10 个开源 Fixture 仓库的本地端到端回归。

## 21. Gate G3

Gate G3 至少包含：

1. 使用 5 个不同 Execution Plan 启动本地 Development Run；
2. 完成至少一个包含两个 Phase、三个 Task 的真实代码修改闭环；
3. 每个完成 Task 都有 Patch、验证和追踪证据；
4. 在 Task 执行中断进程并成功恢复；
5. 制造测试失败，验证有限 Repair 和预算耗尽；
6. 在 Agent 读取后人工修改同一文件，验证前置 Hash 冲突阻止覆盖；
7. 修改已批准 Project Spec，验证运行立即 `stale`；
8. 切换阶段模型，验证新 Run Snapshot 和下游证据失效；
9. 验证 Secret/PII、路径越界、命令注入和远程部署全部被阻断；
10. 新环境从 GitHub Clone 后，不配置付费模型也能运行确定性 Gate。

## 22. ADR 待办

阶段 3 实施时至少记录：

1. Development Run/Task Run 状态机；
2. Model Profile 继承、锁定与 Fallback；
3. Workspace Baseline、Patch Journal 和回滚；
4. Tool Policy 与结构化 Command Runner；
5. Evidence 完成规则与 Repair Budget；
6. Planning Revision → Development Run Stale 规则；
7. 本地密钥引用和 Provider 配置；
8. 开源许可证与发布治理。

## 23. 完成标准

阶段 3 完成必须同时满足：

- DevelopmentStartEnvelope 校验和 Stale 规则通过；
- Phase/Task DAG 可确定性执行和恢复；
- 模型默认继承与阶段覆盖均可用，所有用户能力相同；
- Patch、验证、Evidence、Repair 和回滚闭环通过；
- 本地 Web/CLI 能完整控制 Development Run；
- 远程部署和生产写入不存在可执行入口；
- Gate G3、安全测试和跨平台基础测试通过；
- GitHub 开源所需文档、许可证决策和 CI 完成；
- `pnpm check` 在无 ProductFac、无远程模型条件下通过。
