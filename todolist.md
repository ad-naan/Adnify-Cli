# Adnify-Cli 任务清单

## 角色分工

- 开发者 A：Agent、工具执行、模型能力、工具编排
- 开发者 B：持久化、启动恢复、文档、交互体验、终端 UI

---

## 里程碑

| 代号 | 目标 | 当前状态 |
|------|------|----------|
| M1 | 会话可持久化到本地，退出重开后可恢复工作区最近会话 | 已完成 |
| M2 | 模型可调用工具，工具过程与结果可回到会话流中 | 已完成 |
| M3 | 多轮工具协作、权限控制、稳定 UI 与完整协作链路 | 核心能力已落地，持续增强中 |

---

## A 线：Agent 与工具

### 已完成

- [x] 建立 `prompts/` 驱动的工具目录加载机制
- [x] 接入最小可用工具调用协议
- [x] `ModelAssistantResponder` 支持多轮工具执行闭环
- [x] `workspace-read` 工具可执行
- [x] `search-index` 工具可执行
- [x] `shell-runner` 工具可执行，且限制为只读命令
- [x] `file-ops` 支持 `read`
- [x] `file-ops` 支持 `list`
- [x] `file-ops` 支持 `write`
- [x] `file-ops` 支持 `update`
- [x] `file-ops` 支持 `patch`
- [x] 文件写入必须显式声明 `allowWrite: true`
- [x] 工具执行过程与结果已写入会话流，可在终端会话区看到
- [x] 已补齐工具执行相关单元测试
- [x] 设计工具权限与审批机制（domain 策略 + application 端口 + infrastructure 待决适配器）
- [x] 为高风险工具补更清晰的风险分级与执行策略
- [x] 拆分 `LocalToolExecutor`，退回到只做调度 + 审批闸门
- [x] `shell-runner` 白名单扩展到项目验证命令，并纳入审批

### 当前能力边界

- `shell-runner` 白名单：
- 无需审批（只读）：`rg`、`git status/diff/log/show/branch/rev-parse`
- 需要审批（会跑构建/测试）：`bun test`、`bun run build/typecheck/test/lint`、`bunx tsc`
- 其余命令一律拒绝
- `file-ops` 当前仅允许工作区内文本类文件
- `file-ops` 的 `write/update/patch` 需要用户审批；`allowWrite: true` 降级为模型侧意图声明，不再是权限边界
- `update/patch` 默认要求单次精确命中，避免误改多处
- 如需全量替换，必须显式声明 `replaceAll: true`
- 审批按键：`y` 批准一次 / `n` 拒绝（原因回给模型）/ `a` 本会话始终允许该工具；`Esc` 中止并拒绝全部待决

- [x] 扩展权限策略：按路径或命令粒度的持久化允许规则
- [x] `shell-runner` 白名单全面扩展（npm/pnpm/yarn/npx/grep/find/cat/git mutation）
- [x] 新增 `glob-search`、`web-search`、`web-fetch` 三个工具
- [x] `maxAgentTurns` 提升到 20 轮
- [x] 新增跨会话记忆系统（`:memory`）
- [x] 新增 git 检查点系统（`:checkpoint` / `:undo`）
- [x] 新增上下文窗口诊断（`:context`）
- [x] 系统提示词全面增强

### 待继续

- [ ] 考虑把 `file-ops` 进一步扩展为更结构化的 patch 方案
- [ ] 继续提升模型选择工具与组合工具的稳定性
- [ ] 评估是否迁移到更原生的模型工具调用方案（native tool calling）
- [ ] 补更完整的产品化 README 展示内容与截图

---

## B 线：持久化与体验

### 已完成

- [x] 会话文件化持久化
- [x] 启动时按工作区恢复最近会话
- [x] `createRuntime` 与启动流程接通
- [x] `:session`
- [x] `:sessions` / `:resume`
- [x] 自定义数据目录与跨平台存储路径解析
- [x] `:storage` / `:storage set` / `:storage reset`
- [x] `:config` 命令式配置链路
- [x] 运行时切换模型配置
- [x] 中英文国际化基础设施
- [x] 输入历史
- [x] `Esc` 中止当前执行，而不是退出程序
- [x] 命令建议回车先填充，不直接执行
- [x] 会话区固定高度视窗基础能力
- [x] 工具执行事件进入会话流，可见化调试体验

### 待继续

- [ ] 继续清理终端中个别文本的编码与展示细节
- [ ] 再优化 `sessions` 展示逻辑，使其更贴近目标交互
- [ ] 做一轮终端渲染稳定性回归检查
- [ ] 补更完整的产品化 README 展示内容与截图
- [ ] 视情况补一份存储与配置专题文档

---

## 推荐合并顺序

1. M2 已收口，审批边界已落地。
2. 继续打磨终端 UI、会话区、sessions 展示与动效稳定性。
3. 最后将更细粒度权限、记忆、插件等能力并入更完整的 M3。

---

## 容易冲突的文件

- `src/infrastructure/bootstrap/createRuntime.ts`
- `src/presentation/ink/hooks/useCliController.ts`
- `src/infrastructure/llm/ModelAssistantResponder.ts`
- `src/infrastructure/tooling/LocalToolExecutor.ts`
- `src/infrastructure/tooling/handlers/`

如果多人同时修改这些文件，建议先对齐边界再合并。

---

## 当前建议

### 对开发者 A

- 审批闸门已落地，下一步是更细粒度的权限规则（按路径 / 按命令持久化）
- 在现有 `file-ops` 能力稳定后，再考虑更复杂的补丁协议

### 对开发者 B

- 继续控制终端渲染稳定性，避免重复渲染、抖动、信息冗余
- 逐步提升会话区与命令区的品牌化表现，但稳定性优先

---

## 进度勾选

- [x] M1
- [x] M2
- [ ] M3

---

## 最近更新

### 2026-08-03

- 新增 3 个工具 handler：`glob-search`、`web-fetch`、`web-search`（无需外部 API key）
- `maxAgentTurns` 从 4 提升到 20，模型可执行更长链路的自主任务
- `TEXT_EXTENSIONS` 从 16 扩展到 70+ 种（支持 .py .go .rs .vue .svelte .sql .graphql .svg 等）
- `MAX_FILE_READ_CHARS` 从 12K 提升到 50K，`MAX_FILE_WRITE_CHARS` 从 80K 提升到 200K
- Shell 白名单大幅扩展：新增 grep/find/cat/head/tail/wc、npm/pnpm/yarn、npx、git add/commit/stash/checkout/reset/restore
- 系统提示词全面更新：新增 7 个工具的调用格式说明、扩展后的 shell 白名单、Agent Discipline 指南
- 新增 `:memory`/`:memory list`/`:memory clear` — 跨会话项目记忆系统
  - 记忆存储在工作区独立的 JSON 文件中（`<dataRoot>/memories/<workspace>.json`）
  - 记忆内容注入系统提示词，模型自动利用历史上下文
- 新增 `:checkpoint [message]` — 一键 git 检查点（git add -A + git commit）
- 新增 `:undo` — 撤销最近的检查点提交（git reset --soft HEAD~1）
- 新增 `:context` — 上下文窗口诊断（消息数、字符数、近似 token 数、健康度检查）
- 新增 `MemoryStore` 基础设施类，支持 workspace-scoped 记忆持久化
- 修复 5 个失败测试：ApplyCliCommandUseCase diagnostic 硬编码路径、ModelAssistantResponder 测试适配新审批架构
- 修复 `classifyShellCommand.ts` 重复类型声明
- 修复 `globSearchHandler.ts` 类型安全比较

### 2026-07-29

- 修复测试中硬编码的旧绝对路径，改为位置无关（`process.cwd()` / `mkdtemp`）
- 拆分 `LocalToolExecutor`（622 行 → 调度层 + `handlers/` + `classifyShellCommand` + `toolPathGuard`）
- 新增审批链路：`ToolApprovalPolicy`（domain 纯策略）→ `ToolApprovalPort`（application）→ `PendingToolApprovalAdapter`（infrastructure 待决队列）→ `useToolApproval`（Ink）
- 写入类 `file-ops` 与验证类命令执行前暂停等待用户 `y/n/a`；拒绝原因作为工具结果回给模型
- `Esc` 中止时一并拒绝待决审批，避免 generator 挂起导致 `isBusy` 卡死
- `shell-runner` 白名单扩展：`bun test`、`bun run build/typecheck/test/lint`、`bunx tsc`
- 当前测试状态：`71 pass / 0 fail`

### 2026-04-21

- 完成工具执行过程可见化，工具开始与结果可写入会话流
- `file-ops` 新增 `write`，并要求显式 `allowWrite: true`
- `file-ops` 新增 `update/patch`，支持定点替换与全量替换
- 当前测试状态：`47 pass / 0 fail`
