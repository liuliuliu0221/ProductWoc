# 阶段 3 本地 Agent 开发工作流分阶段开发计划

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档版本 | 0.1 |
| 状态 | 已确认；P3-00～P3-07 已完成 |
| 日期 | 2026-08-29 |
| 前置里程碑 | 阶段 2 独立 Gate G2 通过 |
| 最终门禁 | 独立 Gate G3 |
| 发布方向 | GitHub 开源、本地优先、不提供远程部署 |

本文档把《阶段 3 本地 Agent 开发工作流技术架构》拆为可独立验证的开发里程碑。阶段 3 从有效 `DevelopmentStartEnvelope` 开始，到本地代码任务全部完成并具备验证证据结束。

## 2. 交付目标

交付以下本地闭环：

```text
规划输入校验
→ Development Run
→ Phase / Task DAG
→ 模型与上下文快照
→ 候选 Patch
→ 本地应用与验证
→ Repair / Rollback
→ 用户阶段 Gate
→ development_completed
```

阶段结束时必须具备：

- 可版本化的 Development/Phase/Task/Agent Run 契约；
- 项目默认模型和任意阶段模型覆盖；
- 本地 Workspace Baseline、Patch Journal 与冲突保护；
- 结构化 Command Runner 与工具策略；
- Verification Evidence、有限 Repair 和可恢复回滚；
- 文件 Checkpoint、Outbox、暂停与进程恢复；
- Development Web/CLI；
- Gate G3、安全 Eval、开源文档和 GitHub CI；
- 无远程部署或生产写入入口。

## 3. 开发原则

1. 先冻结契约与纯领域状态机，再接文件系统、命令和模型。
2. 所有用户拥有相同模型配置能力；默认继承和按需覆盖只解决界面复杂度。
3. 每个工作项同时交付 Schema、实现、测试、文档和可演示结果。
4. 模型只能提出候选 Patch，不能直接宣布任务完成或扩大工具权限。
5. 每个完成状态必须由 Evidence 支撑。
6. 用户已有修改优先；Hash 冲突时停止并重新读取，不覆盖。
7. 默认单写 Task；没有冲突隔离前不做并行开发。
8. 不把远程部署、GitHub Push、依赖安装或破坏性操作隐藏在自动流程中。
9. 无付费模型、无网络、无 ProductFac 时仍可运行确定性测试和查看历史。
10. Gate 失败必须修复并重跑，不以人工口头说明替代证据。

## 4. 里程碑总览

| 里程碑 | 建议工期 | 主要结果 |
|---|---:|---|
| P3-00 开源与阶段 3 基线 | 2–3 天 | 边界、契约包、CI 骨架、许可证决策项 |
| P3-01 模型配置与路由 | 3–5 天 | 默认模型、阶段覆盖、能力协商、快照 |
| P3-02 Development 领域内核 | 4–6 天 | Run 状态机、Task DAG、幂等、Stale |
| P3-03 本地 Workspace 与工具策略 | 5–7 天 | Baseline、读写边界、Command Policy |
| P3-04 Implementation Agent 与 Patch | 5–7 天 | 最小上下文、候选 Patch、事务应用 |
| P3-05 Verification、Repair 与 Rollback | 4–6 天 | Evidence、有限修复、恢复点 |
| P3-06 持久化编排与恢复 | 4–6 天 | Checkpoint、Outbox、中断恢复 |
| P3-07 Development Web/CLI | 4–6 天 | DAG、Diff、日志、Gate、模型设置 |
| P3-08 Eval、安全、开源发布与 Gate G3 | 5–7 天 | 安全回归、跨平台、GitHub 发布准备 |

单人串行预计 7–10 周。工期是规划区间，不是承诺日期；任何安全边界问题优先于进度。

## 5. P3-00：开源与阶段 3 基线

### 5.1 目标

冻结阶段 3 范围、包边界、契约版本和开源发布前置项，避免执行引擎与阶段 2 规划内核耦合。

### 5.2 工作项

- 创建 `development-contracts/domain/agent/adapters/workflow/evals` 包骨架；
- 定义 Stage 3 Contract Manifest 和 Schema Version；
- 定义 `DevelopmentInputSnapshot`、Run ID、Task Definition Hash；
- 增加包依赖边界和 ProductFac 隔离检查；
- 固定 Node、pnpm、TypeScript、Vitest 基线；
- 新增 GitHub Actions 本地等价命令设计；
- 起草 `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`；
- 比较 Apache-2.0 与 MIT，由仓库所有者确认许可证；
- 记录不做远程部署、商业计费和用户分层的 ADR；
- 确认测试 Fixture 不含个人路径、凭据或私有项目数据。

### 5.3 交付物

- 阶段 3 包骨架和 Contract Manifest；
- 开源准备清单；
- 第一组 Development Schema Fixture；
- 架构依赖测试；
- P3 ADR 索引。

### 5.4 Exit Gate P3-A

- 所有新包可以独立构建和测试；
- Development Domain 不依赖文件系统、Shell、Git 或具体模型 SDK；
- CI 不包含部署或发布到服务器的 Job；
- 许可证仍未确认时不得公开 Release；
- `pnpm check` 和隔离检查通过。

## 6. P3-01：模型配置与路由

### 6.1 目标

提供对所有用户开放的模型默认继承、阶段覆盖、能力协商和不可变 Run Snapshot。

### 6.2 工作项

- 定义 `ModelProfile`、`ModelPolicy`、`StageModelOverride`；
- 定义应用默认、项目默认、项目阶段、单次 Run 的优先级；
- 支持以下 Scope：
  - `planning.discovery`；
  - `planning.project_spec`；
  - `planning.technical_design`；
  - `planning.execution_plan`；
  - `development.implementation`；
  - `development.review`；
  - `development.repair`；
- 实现 Deterministic Provider；
- 实现 Ollama-compatible 本地 Adapter；
- 实现通用 OpenAI-compatible Adapter，不绑定单一厂商 SDK；
- 实现 Structured Output、Tool Calling、Context Window、`localOnly` 能力协商；
- 实现 `ModelRunSnapshot` 和配置 Hash；
- Provider 不可用时暂停，不静默 Fallback；
- 实现用户预配置的显式 Fallback 记录；
- 配置只保存 Credential Ref，不保存真实密钥；
- 增加模型连接测试与脱敏错误摘要。

### 6.3 必测场景

- 未配置覆盖时全部阶段继承项目默认；
- 单阶段覆盖不影响其他阶段；
- 所有用户都能读取和修改相同配置项；
- 运行开始后修改 Profile 不改变进行中的 Snapshot；
- 能力不足在调用前阻断；
- Fallback 未确认时不会发生；
- Credential 不进入配置导出、Checkpoint、日志或 Git Diff；
- OpenAI-compatible Endpoint 不可用时保留可恢复状态。

### 6.4 Exit Gate P3-B

- 三类 Provider 通过统一契约测试；
- 配置继承、阶段覆盖和不可变快照测试通过；
- 无用户等级、套餐或隐藏能力字段；
- Deterministic Provider 可离线完成测试；
- Provider 错误不会造成状态误推进。

## 7. P3-02：Development 领域内核

### 7.1 目标

用纯函数证明 Development Run、Phase、Task、Gate、Evidence 和 Stale 规则。

### 7.2 工作项

- 定义 Development/Phase/Task/Agent Run 状态机；
- 定义命令和幂等结果；
- 校验 `DevelopmentStartEnvelope` 和绑定文档；
- 生成不可变 `DevelopmentInputSnapshot`；
- 解析并验证 Phase/Task DAG；
- 实现 Task Readiness 和串行调度选择；
- 实现 Task Definition Hash；
- 实现 Phase Exit Criteria 和 User Gate；
- 实现 Evidence 完成规则；
- 实现 Planning Revision → Development Run `stale`；
- 实现 Model Snapshot 变更的任务重跑和下游证据失效；
- 保留 append-only Run、Gate、Evidence 和失效历史。

### 7.3 必测场景

- 篡改或过期 Envelope 被拒绝；
- Task 环、未知依赖、孤儿和不可能顺序被拒绝；
- 重复 Start/Complete/Gate 命令只产生一个结果；
- 没有必要 Evidence 的 Task 不能完成；
- Phase 未满足 Exit Criteria 不能推进；
- 模型不能替用户确认 Gate；
- Project Spec 修订使整个 Run `stale`；
- Technical Design 或 Execution Plan 修订只失效受影响的执行资格；
- 已完成 Run 重放不会创建第二个完成起点。

### 7.4 Exit Gate P3-C

- 领域包覆盖所有合法和非法转换；
- Task 调度顺序确定性可复现；
- Evidence、Gate、Stale 和幂等规则全部由领域层执行；
- 状态推进不依赖模型判断。

## 8. P3-03：本地 Workspace 与工具策略

### 8.1 目标

建立不会覆盖用户修改、不会越出工作区、不会执行任意危险命令的本地执行边界。

### 8.2 工作项

- 定义 Workspace Adapter 和规范化根路径；
- 记录文件清单、初始 Hash、Git 状态和用户已有改动；
- 支持 `AGENTS.md` 等本地约束发现；
- 定义敏感路径、忽略路径和最大文件大小；
- 防止 `..`、绝对路径逃逸、符号链接逃逸和大小写绕过；
- 定义结构化 Read/Search/List/Patch/Command 工具；
- 定义允许的 Lint、Typecheck、Test、Build 命令模板；
- 依赖安装、删除和批量重写进入用户确认；
- 永久拒绝部署、生产写入和凭据操作；
- 记录 Tool Policy Version 和每次判定；
- 增加跨 macOS/Linux/Windows 的路径 Fixture。

### 8.3 必测场景

- 读取/写入工作区外路径被拒绝；
- 符号链接不能逃逸；
- `.env`、SSH 和云凭据路径被拒绝；
- 模型提供的 Shell 控制字符不能突破结构化命令；
- 未批准依赖安装不执行；
- 用户已有 Dirty Worktree 被识别且保留；
- 部署命令无论模型如何表达都被策略拒绝。

### 8.4 Exit Gate P3-D

- Workspace 和 Command Adapter 契约测试通过；
- 高危路径/命令 Fixture 全部失败关闭；
- 没有 destructive Git 清理路径；
- Tool Event 只包含脱敏参数和结果摘要。

## 9. P3-04：Implementation Agent 与 Patch Transaction

### 9.1 目标

让 Agent 针对单个 Task 生成最小、可审阅、可冲突检测的候选变更。

### 9.2 工作项

- 实现 Task Context Assembler；
- 只装配相关 Requirement、Acceptance Criteria、Design Item 和直接依赖证据；
- 装配允许写入路径、项目约束和必要代码摘要；
- 对 Prompt、Repository Instruction 和文件内容进行不可信边界标记；
- 定义结构化 Change Proposal；
- 定义 Patch Set、文件操作和前置/后置 Hash；
- 校验路径、大小、二进制文件、敏感内容和许可证风险；
- 实现候选 Patch 预览；
- 实现 `apply_patch` 风格的本地事务应用；
- 前置 Hash 冲突时拒绝并重新生成；
- 保存回滚 Patch 和 Patch Journal；
- 第一版禁止并行写 Task。

### 9.3 必测场景

- 上下文不包含无关文档、完整聊天和敏感文件；
- 恶意源码注释不能扩大工具权限；
- Patch 越界、过大、格式错误或前置 Hash 不一致被拒绝；
- 相同 Idempotency Key 不重复应用；
- 用户在生成后修改文件时 Agent 不覆盖；
- 新增依赖进入确认而不是自动安装；
- Patch Journal 可以重建变更来源。

### 9.4 Exit Gate P3-E

- 至少 5 个 Fixture Task 生成并应用有效 Patch；
- Patch 前后 Hash、Diff、Task 和 Agent Run 全部可追踪；
- 冲突保护和工作区边界测试通过；
- 无验证证据时 Task 仍保持未完成。

## 10. P3-05：Verification、Repair 与 Rollback

### 10.1 目标

用真实本地验证控制完成状态，并在失败时进行有限、可解释、可恢复的修复。

### 10.2 工作项

- 定义 Evidence Schema 和 Manifest；
- 实现 Lint、Typecheck、Test、Build Runner；
- 映射 Execution Plan Verification Step；
- 保存 Exit Code、脱敏摘要和完整日志 Artifact；
- 校验 Evidence 与 Task/Workspace Hash 绑定；
- 实现 Repair Context 和默认两次预算；
- 相同错误重复、策略失败和基础设施失败停止重试；
- 每次 Repair 创建独立 Agent Run/Patch Set；
- 实现当前 Task Patch 回滚；
- 回滚不得影响用户原有或其他 Task 修改；
- 支持人工确认、手工修复后重新验证；
- Phase Exit Criteria 聚合 Evidence。

### 10.3 必测场景

- 假阳性“完成”被 Evidence Gate 拒绝；
- 测试失败进入 Repair；
- 第二次 Repair 成功后保留完整历史；
- 预算耗尽进入 `needs_user_action`；
- 命令不存在和测试失败使用不同错误分类；
- 回滚恢复当前 Task 前置 Hash；
- 回滚冲突不覆盖用户新修改；
- 日志中的 Secret/PII 在进入模型或事件前脱敏。

### 10.4 Exit Gate P3-F

- 每类 Evidence 至少有一个通过和失败 Fixture；
- Repair Budget、错误分类和停止条件可复现；
- 回滚成功/冲突场景通过；
- Agent 文本不能绕过 Evidence Gate。

## 11. P3-06：持久化编排与恢复

### 11.1 目标

把领域闭环接入本地 Checkpoint、Outbox 和进程恢复，保持无远程基础设施依赖。

### 11.2 工作项

- 扩展原子文件 Checkpoint Store；
- 持久化 Run、Task、Model/Context Snapshot、Patch 和 Evidence；
- 状态变化与 Outbox Event 同一原子提交；
- 实现 Expected Revision 冲突；
- 实现 Start/Apply/Verify/Repair/Gate/Cancel 幂等键；
- 恢复时重新验证 Envelope 和 Workspace Hash；
- 处理 `applying_patch`、`verifying` 等不确定中间状态；
- 无法证明安全重放时进入人工核对；
- 实现 Pause、Resume、Cancel；
- 实现事件重投和已发布标记；
- 增加损坏 Checkpoint 和部分写入恢复测试。

### 11.3 故障注入

- Patch 已写文件但 Checkpoint 未提交；
- Checkpoint 已提交但事件未发布；
- 验证进程中断；
- Repair Provider 超时；
- 用户在暂停期间修改文件；
- 规划 Envelope 在暂停期间失效；
- 重复 Resume 和乱序 Gate。

### 11.4 Exit Gate P3-G

- 每个安全任务边界都能重启恢复；
- 不确定 Patch 不会被盲目重放；
- 重复命令不重复修改或完成；
- Workspace 漂移和规划失效能阻断恢复；
- Outbox 发布失败可重投。

## 12. P3-07：Development Web 与 CLI

### 12.1 目标

提供本地 Development Run 的可观察、可控制交互，不复制领域状态。

### 12.2 页面与组件

- Planning → Development 启动入口；
- Envelope 校验摘要；
- Phase/Task DAG；
- 当前任务、依赖和追踪关系；
- 项目默认模型与阶段覆盖；
- Model Snapshot 和 Provider 状态；
- Context 摘要；
- Patch 文件清单、Diff 和风险提示；
- 验证命令、日志和 Evidence；
- Repair 历史；
- Pause/Resume/Retry/Rollback/Cancel；
- Phase User Gate；
- Stale、Workspace Drift 和人工处理卡片。

### 12.3 交互规则

- 页面状态全部来自服务端 Checkpoint View Model；
- 写操作携带 Idempotency Key、Run Revision 和 Workspace Hash；
- 模型阶段覆盖对所有用户开放，默认折叠显示；
- 切换模型前显示对 Run/Task/Evidence 的影响；
- 危险 Patch 默认等待用户审阅；
- SSE 仅实时提示，重新查询是最终校正；
- 关闭页面不取消 Development Run；
- UI 不提供部署按钮。

### 12.4 CLI

- `develop`：从有效 Envelope 启动；
- `status`：输出 Run/Task/Evidence 摘要；
- `resume`：恢复安全边界；
- `verify`：重跑必要验证；
- `rollback`：请求当前 Task 回滚；
- `models`：查看继承与覆盖；
- `export-evidence`：导出脱敏证据包。

### 12.5 Exit Gate P3-H

- Web 与 CLI 对同一 Checkpoint 展示一致状态；
- 键盘可访问和桌面/窄屏基础响应式通过；
- Patch、日志、Evidence 和模型快照可随时查看；
- 暂停、恢复、冲突和 Stale 具有明确处理路径；
- 没有远程部署或生产写入入口。

## 13. P3-08：Eval、安全、开源发布与 Gate G3

### 13.1 Eval 数据集

至少 10 个最小开源 Fixture Repository，覆盖：

- TypeScript 库函数修改；
- Node CLI；
- 本地 HTTP API；
- 静态 Web UI；
- 数据迁移模拟但不连接真实数据库；
- 多文件重构；
- 失败测试修复；
- Dirty Worktree；
- 恶意 Repository Instruction；
- 路径逃逸、命令注入和 Secret Fixture；
- 中英混合需求和仓库内容；
- 不支持或需要人工处理的任务。

每个 Fixture 固定 Envelope、规划文档、初始文件 Hash、模型快照、期望 Patch 范围、禁止行为、验证命令和最终 Evidence。

### 13.2 质量指标

- Task 首次完成率；
- Patch 范围准确率；
- Required Verification 通过率；
- Repair 成功率与平均次数；
- 回滚正确率；
- Requirement → Evidence 覆盖率；
- Workspace 冲突识别率；
- 路径/命令/Secret 策略漏放次数；
- Reference/Repository Instruction 越权次数；
- Token、时延和用户可选成本；
- 人工接管率。

### 13.3 安全测试

- 路径穿越、符号链接和敏感目录；
- Shell 注入和命令模板逃逸；
- 恶意 `AGENTS.md`、源码注释和测试输出；
- Patch 修改自身 Tool Policy；
- 依赖包名混淆和安装脚本；
- Secret/PII 进入 Prompt、日志、Diff、Evidence 和导出包；
- Workspace Hash 替换和乱序 Apply；
- 旧 Model Snapshot/Context Snapshot 重放；
- Git Push、部署和生产写入绕过尝试；
- Checkpoint 篡改和损坏恢复。

### 13.4 开源发布准备

- 仓库所有者确认许可证；
- 完成 README、贡献、安全和行为准则；
- 提供无密钥示例配置；
- CI 在干净 Clone 上通过；
- 执行 Secret Scan 和个人路径扫描；
- 发布变更日志和已知限制；
- 确认没有 ProductFac 运行依赖；
- 不配置远程部署 Workflow。

### 13.5 Gate G3

按技术架构第 21 节执行十项验收，并保存：

- 输入 Envelope 和 Fixture Revision；
- Run/Task/Agent/Model Snapshot；
- Patch Journal；
- Verification Evidence；
- Repair/Rollback 记录；
- 安全测试报告；
- 恢复和 Stale 证明；
- 开源发布检查表。

### 13.6 Exit Gate P3-I

- 至少 10 个 Fixture Repository 建立稳定基线；
- 5 个不同计划完成开发验收；
- Gate G3 十项全部通过；
- 高危安全策略漏放次数为 0；
- 无付费模型的确定性 CI 通过；
- 许可证和开源文档完成；
- `pnpm check` 通过。

## 14. 跨里程碑依赖

```text
P3-00
  ├─ P3-01 Model Policy
  └─ P3-02 Domain
       └─ P3-03 Workspace/Tools
            └─ P3-04 Patch
                 └─ P3-05 Verification/Repair
                      └─ P3-06 Recovery
                           └─ P3-07 Web/CLI
                                └─ P3-08 Gate G3
```

P3-01 与 P3-02 可在契约冻结后并行；P3-03 之后的写入、验证和恢复切片按顺序推进。

## 15. 每个切片的 Definition of Done

一个工作项只有同时满足以下条件才算完成：

- Schema、状态和错误语义明确；
- 权限、路径、模型和工具策略由服务端/领域验证；
- 写操作幂等并绑定 Run Revision、Task Hash 和 Workspace Hash；
- 修改具有 Patch Journal 和恢复路径；
- 完成具有必要 Evidence；
- Secret/PII 不进入 Prompt、日志、事件或导出；
- 模型、Prompt、Context、Tool Policy 和 Schema 可追踪；
- 单元、契约、集成或 Eval 测试与风险匹配；
- 文档和 ADR 已更新；
- `pnpm check` 通过。

## 16. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| Agent 覆盖用户修改 | 数据损失 | Baseline Hash、Dirty Worktree、Patch 前置条件、停止而非覆盖 |
| 模型能力差异 | 输出不稳定 | Profile 能力协商、Run Snapshot、结构化 Schema、Eval |
| 静默 Fallback | 不可复现 | 默认暂停、显式策略、记录新 Agent Run |
| 任意 Shell | 本机安全风险 | 结构化 Command、模板白名单、参数校验、用户确认 |
| Prompt/Repository Injection | 权限扩大 | 信任分层、Tool Policy 独立裁决、恶意 Fixture |
| Repair 循环 | 成本与破坏扩大 | 默认两次预算、相同错误停止、人工接管 |
| 回滚误删用户文件 | 数据损失 | 只回滚 Patch Journal 内变更、Hash 冲突停止 |
| 规划在开发中修改 | 错误实现 | Envelope 重校验、Run `stale`、禁止继续 |
| 开源仓库泄密 | 隐私风险 | Secret/路径扫描、示例配置、发布检查表 |
| 跨平台命令差异 | 用户无法运行 | Adapter、Fixture Matrix、明确支持范围 |
| 范围滑向远程部署 | 安全与维护负担 | 无部署契约、无 UI 入口、策略永久拒绝 |

## 17. 暂停与回退条件

出现以下任一情况暂停当前里程碑：

- 工作区外文件被读取或写入；
- 用户已有修改被覆盖；
- Secret/PII 进入模型请求、日志或 Evidence；
- 任意 Shell 绕过结构化策略；
- 不确定 Patch 被自动重放；
- 规划失效后 Development Run 仍能推进；
- Model Fallback 未经配置和记录；
- 回滚不能限定在当前 Task；
- 测试无法在 Deterministic Provider 下复现。

回退时保留 Checkpoint、Patch Journal 和 Evidence，禁用受影响入口，不使用破坏性 Git 命令清理用户工作区。

## 18. 推荐实施顺序

第一周：

1. 评审并确认两份阶段 3 文档；
2. 确认开源许可证选择流程；
3. 创建 development-contracts 和 Contract Manifest；
4. 定义 Run/Task/Evidence/Model Policy Schema；
5. 实现 Envelope → DevelopmentInputSnapshot 校验；
6. 建立第一组状态机和幂等测试；
7. 建立 Deterministic Provider 的模型路由测试。

第一周不做文件写入、不执行 Shell、不接真实模型、不开发远程部署。

## 19. 阶段完成标准

阶段 3 完成必须同时满足：

- P3-A 至 P3-I 全部通过；
- 5 个不同项目完成本地开发 Gate；
- 10+ Fixture Repository 形成稳定 Eval；
- 进程中断、Workspace Drift 和 Planning Stale 均可恢复或阻断；
- 每个完成任务都有 Patch 和 Verification Evidence；
- 模型默认继承与阶段覆盖对所有用户开放；
- 高危路径、命令、Secret 和部署策略漏放次数为 0；
- 开源许可证、贡献、安全、行为准则和 CI 就绪；
- 仓库可在无 ProductFac、无远程模型、无部署服务时构建、测试和演示；
- Gate G3 证据和 ADR 已归档。
