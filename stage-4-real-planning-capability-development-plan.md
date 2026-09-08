# 阶段 4 ProductWoc 独立 Web 与真实模型能力分阶段开发计划

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档版本 | 0.1 |
| 状态 | 实施中；P4-01 已于 2026-09-08 通过 Gate P4-B |
| 日期 | 2026-09-06 |
| 前置里程碑 | `v0.1.0`、独立 Gate G3 通过 |
| 最终门禁 | 独立 Gate G4 |
| 目标版本 | `v0.2.0` |
| 运行方向 | ProductFac 完全隔离、开发者配置模型、用户通过 Web 使用 |

本文档把 ProductWoc 从“确定性工作流与安全边界基线”推进为可实际使用的独立产品。阶段 4 不重新引入 ProductFac，也不让网页用户承担 Provider、Endpoint 或 Credential 配置；模型由安装和运行 ProductWoc 的开发者或运行维护者统一配置，网页用户只参与需求、澄清、文档审阅、审批和开发 Gate。

## 2. 当前问题与阶段目标

`v0.1.0` 已具备规划与开发状态机、文档 Schema、审批、版本、失效、Checkpoint、模型路由契约和确定性测试，但 Planning Web 固定使用 `LocalDeterministicPlanningModelProvider`。它能够证明工作流，却只能生成通用模板，不能作为真实 AI 规划产品。

阶段 4 交付以下闭环：

```text
开发者安装 ProductWoc
→ 在服务端配置 Model Profiles、默认模型和阶段覆盖
→ 启动独立 ProductWoc Web 服务
→ 网页用户输入产品想法并回答关键问题
→ 分阶段生成并审批 Project Spec / Technical Design / Execution Plan
→ Development 按阶段选择已配置模型
→ 生成候选 Patch、验证、Repair 和 Gate
→ 本地持久化、恢复和导出证据
```

阶段结束时必须满足：

- ProductWoc 从干净 GitHub Clone 独立安装、配置、启动和恢复；
- Runtime 不导入、不调用也不要求 ProductFac 的包、源码、服务、数据库、身份、Temporal、环境变量或仓库；
- 开发者在服务端配置模型，浏览器用户不能读取或修改模型配置；
- 一个部署默认使用一个模型，同时允许开发者为七个既定阶段分别覆盖模型；
- Planning Web 使用真实 Provider 生成有业务针对性的三类规划文档；
- Development 使用锁定的阶段模型生成 Implementation、Review 和 Repair 候选；
- Deterministic Provider 继续服务于离线 CI 和 Fixture，但不得在普通运行中伪装成真实 AI；
- Provider、模型、Prompt、配置和上下文均形成不可变快照并可审计；
- 凭据不进入浏览器、配置文件、Checkpoint、日志、Evidence、Git 或导出物；
- Gate G4 在无 ProductFac 条件下通过，并完成 `v0.2.0` 发布准备。

## 3. 角色与权限边界

### 3.1 开发者 / 运行维护者

开发者或运行维护者拥有 ProductWoc 进程和本地文件系统的管理权限，负责：

- 安装依赖和启动服务；
- 创建 Model Profile；
- 指定应用默认模型和阶段覆盖；
- 通过环境变量或系统密钥存储提供 Credential；
- 执行配置校验和 Provider 连接测试；
- 决定是否启用预配置 Fallback；
- 升级 ProductWoc、迁移配置和执行发布检查。

模型配置不是网页功能，也不通过普通业务 API 暴露。

### 3.2 网页用户

网页用户只负责：

- 创建规划请求；
- 回答真正阻塞的澄清问题；
- 查看摘要、全文、Diff、模型来源标签和生成状态；
- 要求修改、重新生成、审批、退回或取消；
- 确认预配置 Fallback 是否用于本次失败的 Stage Run；
- 进入 Development，查看 Patch、Evidence 和执行 Gate；
- 导出规划文档和脱敏证据。

网页用户不得：

- 新建、修改或删除 Model Profile；
- 输入或查看 API Key、Credential Ref 的内部名称和完整 Endpoint；
- 覆盖某个项目、阶段或 Run 的模型；
- 绕过开发者配置的隐私、能力、预算、工具和 Fallback 策略；
- 通过 Web 触发远程部署、生产写入或 ProductFac 调用。

### 3.3 模型 Provider

模型 Provider 是可替换的外部端口，不是 ProductWoc 的事实源。第一版支持：

- `ollama`：Ollama-compatible 本地模型优先；
- `openai_compatible`：由开发者配置的兼容 Endpoint；
- `deterministic`：仅用于测试、Fixture、演示和离线 Gate。

## 4. ProductFac 隔离与独立运行边界

### 4.1 强制隔离规则

- Runtime Manifest、源码、配置和启动脚本不得引用 ProductFac 包或路径；
- 不读取 ProductFac Cookie、Token、用户、Workspace、Project 或数据库；
- 不调用 ProductFac HTTP/API、消息队列、Artifact、Telemetry 或身份服务；
- 不依赖 ProductFac Git checkout、环境变量、Migration 或部署状态；
- Planning 和 Development 的权威状态由 ProductWoc 本地原子 Checkpoint 持有；
- ProductFac 兼容 Fixture 只能作为静态测试数据，不能进入 Runtime import graph；
- GitHub 只承担源码、Issue、CI 和 Release，不承担应用运行依赖；
- 项目不内置远程部署、生产发布或云资源创建工作流。

### 4.2 独立启动契约

干净环境只需要：

```text
Node.js 24
pnpm 11
ProductWoc 仓库
开发者维护的 ProductWoc 配置
至少一个可用模型 Endpoint（确定性测试模式除外）
```

启动前执行配置校验。真实运行没有可用模型时，Web 显示“服务尚未由开发者完成模型配置”，不得让网页用户填写 Key，也不得静默生成确定性模板。

默认 HTTP 服务继续绑定 `127.0.0.1`。在身份与传输安全方案单独评审前，阶段 4 不扩大到公网监听。

## 5. 开发者端模型配置设计

### 5.1 配置来源

阶段 4 使用服务端配置文件与环境变量：

- 非秘密配置：`productwoc.config.json` 或 `PRODUCT_WOC_CONFIG_PATH` 指向的文件；
- Credential：由环境变量或后续可选的系统 Keychain 解析；
- 示例文件：只包含无效占位值和 Credential Ref，不包含真实密钥；
- 浏览器 API：只返回脱敏后的当前 Stage Model 标签和可用状态。

配置文件至少包含：

```ts
interface ProductWocRuntimeConfigV1 {
  schemaVersion: "1";
  profiles: readonly ModelProfile[];
  applicationDefaultProfileId: string;
  stageOverrides: readonly StageModelOverride[];
  fallbackPolicy: "pause" | "confirm_preconfigured";
}
```

### 5.2 分阶段模型 Scope

沿用阶段 3 已冻结的七个 Scope：

```text
planning.discovery
planning.project_spec
planning.technical_design
planning.execution_plan
development.implementation
development.review
development.repair
```

典型配置允许：

- Discovery 使用速度快、成本低的模型；
- PRD / Project Spec 使用产品分析模型；
- Technical Design 使用架构能力更强的模型；
- Execution Plan 使用擅长任务拆分与追踪的模型；
- Implementation 使用代码模型；
- Review 使用独立审查模型；
- Repair 使用擅长错误定位和小范围修复的模型。

### 5.3 路由优先级

阶段 4 的运行时选择顺序为：

```text
已锁定 Model Run Snapshot（进行中的 Run）
  ↓
开发者配置的 Stage Override（新 Run）
  ↓
开发者配置的 Application Default Profile（新 Run）
```

网页请求不能增加更高优先级的模型覆盖。若未来需要项目级策略，也必须由开发者端配置并通过新的 ADR 引入，不能由网页用户临时修改。

### 5.4 快照、变更和 Fallback

- 每次模型调用前创建不可变 `ModelRunSnapshot`；
- Snapshot 记录 Profile ID、Provider 类型、模型名、参数、Prompt Version、Schema Version、配置 Hash、Tool Policy Version 和 Context Hash；
- Snapshot 不记录完整 Endpoint、Credential Ref 名称或 Credential 值；
- 开发者修改配置只影响后续 Model Run，不热切换进行中的调用；
- 规划阶段更换模型后重新生成新文档版本，并按既有失效图使下游文档或 Development Run 失效；
- 开发阶段更换模型后必须创建新 Agent Run，旧 Patch 和 Evidence 不自动继承；
- Provider 失败默认暂停；只有开发者预配置 Fallback 时，网页用户才能确认是否使用该 Fallback；
- Authentication、Schema 和安全策略失败不自动 Fallback。

## 6. 里程碑总览

| 里程碑 | 建议工期 | 主要结果 |
|---|---:|---|
| P4-00 范围纠偏与契约基线 | 1–2 天 | 独立边界、角色权限、配置 Schema、Gate G4 清单 |
| P4-01 开发者配置加载与诊断 | 2–4 天 | 配置文件、环境变量解析、CLI 校验、脱敏 View |
| P4-02 真实 Provider 与统一适配层 | 3–5 天 | Ollama/OpenAI-compatible、连接测试、错误脱敏 |
| P4-03 真实 Planning 生成链路 | 4–6 天 | Discovery、澄清、三类文档、Schema Repair |
| P4-04 Planning Web 产品化 | 3–5 天 | 生成进度、正文、Diff、修改、审批、导出 |
| P4-05 Development 分阶段模型接入 | 4–6 天 | Implementation/Review/Repair 使用锁定模型 |
| P4-06 持久化、安全与恢复 | 3–5 天 | 配置 Hash、Checkpoint、无密钥、失败恢复 |
| P4-07 Eval、独立验收与 Gate G4 | 4–6 天 | 真实冒烟、浏览器 E2E、文档、`v0.2.0` 准备 |

单人串行预计 4–6 周。真实模型响应的不确定性不能通过降低 Schema、安全或审批标准来换取进度。

当前进度：P4-00 与 P4-01 已完成，分别记录于
`docs/p4-00-gate-p4-a-report.md` 和 `docs/p4-01-gate-p4-b-report.md`；下一里程碑
为 P4-02。P4-02 负责真实 Provider 适配和连接探测，不得提前把未校验的模型
输出写入 Planning 权威状态。

## 7. P4-00：范围纠偏与契约基线

### 7.1 工作项

- 新增 ADR 022，部分取代 ADR 012、013、019 中的网页用户模型配置决策；
- 明确定义 Developer/Operator、Web User 和 Provider 三类边界；
- 定义 `ProductWocRuntimeConfigV1`、`StageModelOverride` 和脱敏 `ModelAvailabilityView`；
- 将七个模型 Scope 作为跨 Planning/Development 的唯一枚举；
- 冻结“不配置真实模型就不生成真实计划”的失败关闭行为；
- 扩展 ProductFac 隔离检查到配置加载、Web 路由和 Provider Registry；
- 建立 Gate G4 验收矩阵和 Fixture 目录；
- 在 README 和 Known Limitations 明确 `v0.1.0` 的确定性基线属性。

### 7.2 Exit Gate P4-A

- 新旧决策的取代关系明确且没有两套配置权限定义；
- Contract Fixture 覆盖有效、未知字段、重复 Profile、未知 Stage、缺少默认模型和 Credential Ref 泄漏；
- Web 契约不存在写入 Model Policy 的命令；
- `pnpm isolation:check` 继续通过。

## 8. P4-01：开发者配置加载与诊断

### 8.1 工作项

- 实现配置路径发现、版本校验和原子读取；
- 实现 Profile、Stage Override、Fallback Policy 和能力声明校验；
- 在 Adapter 边界解析 Endpoint/Credential 环境变量；
- 新增开发者 CLI：`config validate`、`models list`、`models test`；
- 启动时生成配置 Hash 和只读配置快照；
- Web 仅接收 `configured/unavailable/degraded`、Stage 标签和脱敏模型名；
- 删除或关闭网页中的模型编辑入口；
- 配置缺失或无效时阻断生成，同时保留历史只读访问。

### 8.2 Exit Gate P4-B

- 开发者无需修改源码即可配置默认模型和七个阶段覆盖；
- 网页用户不能通过 UI 或 HTTP 修改配置；
- Credential 值和内部 Ref 不出现在 API、日志、Checkpoint 或导出中；
- 配置错误包含可操作的开发者诊断，但不向网页用户泄漏秘密。

## 9. P4-02：真实 Provider 与统一适配层

### 9.1 工作项

- 复用现有 Development Provider 契约能力，提取或桥接共享 HTTP Transport；
- 为 Planning `PlanningModelProvider` 接入 Ollama-compatible 和 OpenAI-compatible Adapter；
- 支持结构化输出、超时、有限重试、取消和最大响应大小；
- 对 Endpoint、Header、Credential、请求和错误摘要执行脱敏；
- 在调用前完成 Structured Output、Tool Calling、Context Window、Vision 和 `localOnly` 能力协商；
- Deterministic Provider 改为显式测试模式，普通启动不得默认选择；
- CI 使用注入 Transport 和离线 Fixture；真实 Endpoint 只进入开发者显式冒烟测试。

### 9.2 Exit Gate P4-C

- 三类 Provider 通过同一行为契约；
- Ollama 和至少一个 OpenAI-compatible Endpoint 完成真实连接冒烟；
- Provider 不可用、鉴权失败、超时、限流、非法 JSON 和 Schema 不匹配均保持状态不推进；
- 离线 CI 不要求任何模型密钥。

## 10. P4-03：真实 Planning 生成链路

### 10.1 工作项

- Discovery 使用 `planning.discovery` 路由生成需求理解；
- 只提出 1–3 个真正阻塞的问题，并新增网页回答命令与 Decision Log；
- Project Spec、Technical Design、Execution Plan 分别使用对应 Stage Scope；
- 为每个 Stage 定义 Prompt Version、最小上下文、输出 Schema 和最大两次 Repair；
- 禁止 Provider 内容覆盖用户要求、审批、工具策略或权威状态；
- 生成结果先保存为 Candidate Artifact，经 Schema 和领域校验后才能成为文档版本；
- 修订反馈形成新版本，保留 Diff、Hash、作者模型快照和下游失效记录；
- 不允许在真实 Provider 失败时回退到通用确定性模板。

### 10.2 Exit Gate P4-D

- 至少五类不同产品想法生成具有明显业务针对性的输出；
- 三类文档满足 Requirement、Acceptance、Design 和 Task 追踪关系；
- 不同 Stage Override 实际命中不同 Profile，并留下正确 Snapshot；
- Schema Repair 超限后进入可恢复的用户操作状态；
- 三次审批仍是进入 Development 的唯一合法路径。

## 11. P4-04：Planning Web 产品化

### 11.1 工作项

- 展示服务是否已由开发者完成模型配置；
- 增加 Discovery 澄清问答界面；
- 展示排队、生成、校验、修复、待审批、失败和恢复状态；
- 在主页面直接展示文档正文，不再只把正文隐藏在 Dialog；
- 保留摘要、全文、版本、结构化 Diff、Hash 和模型来源标签；
- 支持修改反馈、重新生成、退回、取消和刷新恢复；
- 支持导出三份 Markdown、Decision Log 和脱敏 Evidence；
- Web 不出现 Provider、Endpoint、API Key、Credential Ref 或模型编辑表单；
- 增加键盘、窄屏、错误提示和长文档可访问性测试。

### 11.2 Exit Gate P4-E

- 新网页用户无需配置模型即可完成完整规划流程；
- 页面能够清晰区分“未配置”“正在生成”“等待审批”和“生成失败”；
- 所有模型配置写 API 均不存在或失败关闭；
- 浏览器 E2E 覆盖正常流程、修订、恢复、Provider 失败和导出。

## 12. P4-05：Development 分阶段模型接入

### 12.1 工作项

- Development Run 从同一开发者 Runtime Config 读取模型策略；
- Implementation、Review、Repair 分别解析自己的 Stage Override；
- 每个 Agent Run 锁定 Profile、Context、Prompt、Tool Policy 和 Workspace Hash；
- 模型只生成结构化 Change Proposal 和候选 Patch；
- Review 模型不能替代测试 Evidence 或用户 Gate；
- Repair 继续受次数、路径、命令和变更范围预算约束；
- 阶段模型变化触发新 Agent Run 和下游 Evidence 复核；
- Development Web 只显示脱敏模型来源和锁定状态，不提供模型配置入口。

### 12.2 Exit Gate P4-F

- Implementation/Review/Repair 可以由三个不同 Profile 执行；
- 默认继承和阶段覆盖均命中预期路由；
- 模型无法直接写文件、扩大命令权限、跳过验证或确认 Gate；
- Provider 错误不会留下半应用 Patch 或错误完成状态。

## 13. P4-06：持久化、安全与恢复

### 13.1 工作项

- Checkpoint 保存配置 Hash 和 Snapshot ID，不保存配置正文和 Credential；
- 配置变更、进程中断和 Provider 未知完成状态进入显式恢复审计；
- 保留历史只读能力，不因当前 Provider 不可用而丢失已生成文档；
- 对 Prompt、响应候选、错误、SSE、日志和导出执行统一脱敏；
- 限制请求体、响应体、文档长度、并发调用和 Repair 次数；
- 扩展 Prompt Injection、恶意参考内容、路径、命令和秘密泄漏 Fixture；
- 验证原子文件替换、权限模式、重放和 Stale Writer 冲突。

### 13.2 Exit Gate P4-G

- 重启后从最后确定边界恢复，不重复模型调用或审批；
- 配置切换不会改变历史 Snapshot；
- 仓库、`.product-woc`、日志、API 响应和导出扫描均无 Credential；
- ProductFac 隔离、Workspace 边界和命令策略回归全部通过。

## 14. P4-07：Eval、独立验收与 Gate G4

### 14.1 必须执行的验收场景

1. 从干净 Clone 安装并在没有 ProductFac 的环境启动；
2. 开发者配置一个默认 Profile，网页用户完成全流程；
3. 为 PRD、Technical Design 和 Development 配置不同模型并验证命中；
4. 使用 Ollama 完成一次真实规划；
5. 使用 OpenAI-compatible Endpoint 完成一次真实规划；
6. 回答澄清问题后，Decision Log 和 Project Spec 正确引用答案；
7. 修订 Project Spec 后，下游设计、计划和 Development 资格正确失效；
8. Provider 超时、鉴权失败和非法输出不会推进状态；
9. 服务重启后恢复同一 Checkpoint，并能继续审批；
10. 网页用户无法查看或修改模型配置；
11. Development 的 Implementation/Review/Repair 使用各自锁定 Snapshot；
12. 三份 Markdown 和脱敏 Evidence 可成功导出；
13. 无网络、无密钥模式下全部确定性 CI Gate 继续通过；
14. Runtime import、环境变量和启动路径不包含 ProductFac 依赖。

### 14.2 Gate G4

Gate G4 必须同时满足：

- `pnpm check` 全部通过；
- 新增 `pnpm p4:gate` 覆盖配置、Provider、Planning、Development、Web 和安全回归；
- 真实 Provider 冒烟报告通过，但真实凭据不进入 CI Artifact；
- 浏览器桌面和窄屏端到端验收通过；
- ProductFac 独立运行检查在干净 Clone 通过；
- 配置和数据迁移文档完成；
- README 快速开始明确区分开发者配置步骤和网页用户使用步骤；
- Known Limitations、Security 和 Release Policy 已更新；
- `v0.2.0` 由仓库所有者在审核后手动发布。

### 14.3 Gate G4 验收矩阵

| 关注面 | 自动化目标 | 最终人工或真实环境证据 |
|---|---|---|
| ProductFac 隔离 | Runtime import、Manifest、环境变量、Endpoint 和启动路径扫描 | 干净 Clone、无 ProductFac 环境独立启动 |
| 开发者配置 | Schema、迁移、配置 Hash、七阶段路由与秘密泄漏测试 | 开发者只改配置和环境变量完成启动 |
| Provider | 统一契约、错误分类、超时、取消、限流与脱敏 Fixture | Ollama 和 OpenAI-compatible 各一次真实冒烟 |
| Planning | 三文档 Schema、追踪、Repair、审批和失效回归 | 五类产品想法的业务针对性审阅 |
| Development | Implementation、Review、Repair 路由和 Snapshot 回归 | 不同阶段 Profile 命中证据 |
| Web 与恢复 | HTTP 写边界、E2E、窄屏、刷新、重启和导出回归 | 桌面与窄屏完整流程验收 |
| 发布安全 | 无密钥 CI、仓库与导出扫描、Release Hygiene | 所有者审核并手动发布 `v0.2.0` |

## 15. 实施顺序与停止条件

严格按 P4-00 → P4-07 推进。每个里程碑必须先通过自己的 Exit Gate，再开始下一阶段。

出现以下情况必须停止推进并修复：

- 为完成功能重新依赖 ProductFac；
- 需要网页用户输入或查看模型密钥；
- 真实 Provider 失败时静默使用 Deterministic 模板；
- 模型选择无法形成可复现 Snapshot；
- 模型能够绕过审批、Schema、Workspace、命令或 Evidence 规则；
- Checkpoint、日志或导出中出现凭据；
- 当前阶段失败却通过人工说明跳过 Gate。

## 16. 阶段完成定义

阶段 4 只有在以下条件全部成立时完成：

- ProductWoc 独立完成 Planning → Development 全流程；
- 开发者完成一次模型配置后，网页用户无需任何模型知识即可使用；
- 七个阶段 Scope 的默认继承和覆盖行为均有自动化证据；
- 真实模型输出具有业务针对性，并通过 Schema、追踪和审批约束；
- 确定性离线 Gate、真实 Provider 冒烟和浏览器验收同时通过；
- ProductFac 隔离和无凭据边界可执行验证；
- `v0.2.0` 发布材料准备完成。
