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
- [x] 迁移到原生 tool calling（provider function calling），XML 文本解析降级为回退路径
- [x] 工具输入契约收敛为单一来源（`toolInputSchemas.ts`，JSON Schema）
- [x] 新增 `task` 工具：并行派发子代理，接入审批与进度回传
- [x] 子代理开放受限只读工具（搜索、目录、文件读取），支持专职角色、优先级调度和取消
- [x] 自动加载 `.adnify/instructions.md`、`AGENTS.md` 与 `.rules/*.md` 项目指令
- [x] 原生工具调用使用标准 assistant/tool 角色与 `toolCallId` 回填；文本协议仅作为兼容回退
- [x] 成功修改文件后强制进入验证闭环，结束前至少尝试测试、类型检查、lint 或构建
- [x] 子代理新增 `implement` 专职角色，输出可由主代理统一审批、落盘和验证的精确实现方案
- [x] 文件检查点关联 session/tool/input 执行来源，恢复记录可追踪
- [x] 新增 `bun run eval:agent` coding-agent 确定性评测基线与 live-model 评分表
- [x] 审批决策升级为 allow/ask/deny，支持 manual/workspace/auto/plan 权限模式
- [x] 保护路径和工作区外绝对路径永不静默放行，越界访问进入明确审批
- [x] 设置、审批、权限与模型提问统一使用底部 ChoiceTabs 方向键交互
- [x] 新增 `ask-user` 多步选项卡工具，结构化答案回填 Agent 工具链
- [x] 新增 AI 自适应 plan→execute 工作阶段，规划阶段由宿主强制只读
- [x] 新增 `runtime-control`，AI 可按风险自主操作模式、语言、动效、权限和已配置模型
- [x] `implement` 子代理使用 disposable git worktree 修改和验证，结束后回传 patch
- [x] 文件级检查点（`:restore`），独立于 git 检查点
- [x] 写入 diff 预览与命令风险展开
- [x] 工具执行超时改为可暂停的 deadline，审批等待不再计入耗时

### 待继续

- [ ] 考虑把 `file-ops` 进一步扩展为更结构化的 patch 方案
- [ ] 继续提升模型选择工具与组合工具的稳定性
- [ ] 子代理仍不能执行测试或修改文件；未来若增加写入型 worker，需先设计独立工作树和审批汇合点
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
- [x] 原创水獭终端品牌形象与河流主题配色
- [x] `Ctrl+O` 全屏会话记录与 `PgUp/PgDn` 长会话滚动
- [x] 普通会话折叠工具噪音，全屏记录展开完整审计细节

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

### 2026-08-11

**稳定性细节打磨**

- 终端宽度统一按可见列计算，忽略 ANSI 控制序列，并正确处理 CJK 与组合字符；修复水獭窄终端和欢迎卡片的跨平台回归测试
- 会话滚动提示改用终端可见宽度判断，避免中文提示在窄终端溢出
- 文件写入检查点仅保留成功落盘的操作；验证或写入失败时自动丢弃无效快照
- 记忆存储支持首次调用直接清空，拒绝空白记忆，并避免调用方通过 `list()` 返回值绕过持久化修改缓存
- 当前测试状态：`263 pass / 0 fail`（37 个文件），类型检查与生产构建通过

### 2026-08-10

**交付收口**

- 修复 Ink 7 `Key` 类型不支持 `home/end` 导致的类型检查失败；保留可用的 PageUp/PageDown 与 Esc 滚动交互
- 新增 `bun run verify`，统一执行完整测试、TypeScript 类型检查和生产构建
- 新增 GitHub Actions 验证工作流，在 push 与 pull request 时执行锁文件安装和 `bun run verify`
- 为 `glob-search`、`search-index`、`web-search`、`web-fetch` 补充文件系统与网络边界测试
- 为 MCP 补充真实 stdio 子进程集成测试，覆盖握手、工具发现、调用、注册中心路由与关闭
- 同步中英文 README 的工具、命令、存储、Agent 轮次和里程碑描述
- 当前测试状态：`263 pass / 0 fail`（37 个文件），类型检查与生产构建通过

**水獭品牌与终端交互重构**

- 将通用机器人字形替换为原创水獭：圆耳、浅色口鼻、胡须、胸前小爪和动态水面尾波构成固定识别特征
- 主题改为深河水背景、青绿色交互强调和暖棕色水獭毛色，语义色继续独立表达成功、警告与危险
- 去掉头部与会话区的多层嵌套边框，改为轻量品牌头、无边框会话流、聚焦输入框和单行状态区
- 欢迎页根据终端宽度在双栏与单栏间切换，窄终端自动隐藏次要快捷键提示
- 新增 `Ctrl+O` 全屏会话记录；支持 `PgUp/PgDn` 滚动，审批与配置出现时自动退出以保持关键操作可见
- 普通会话将冗长工具过程折叠为摘要，全屏记录展示完整工具输入、输出和耗时
- 修复中文 locale 被错误解析为英文的问题，并增加中英文与水獭静态渲染回归测试
- 修复同一毫秒内连续文件检查点排序不稳定导致的偶发测试失败；目标用例连续运行 10 次通过

**原生 tool calling 迁移**

- `ModelStreamChunk` 新增 `toolCall` / `usedNativeTools`，`ModelRequest` 新增 `tools`
- `AiSdkGateway` 从 `.textStream` 换到 `.fullStream` —— `textStream` 会丢弃所有 tool-call part，
  只加 `tools` 而不换流会表现为「模型什么都没输出」
- 工具声明**不带 `execute`**：执行留在 `LocalToolExecutor`，否则 SDK 自动执行会绕过审批面板
- 回退探测：捕获 4xx `APICallError` 后标记该 provider 不支持原生，重跑一次不带 `tools` 的请求；
  5xx 不降级（那是服务端故障，改用文本解析只会把问题盖住）。探测结果按 provider+baseUrl+model 缓存
- `ResponseCache<string>` → `ResponseCache<CachedResponse>`：修掉「命中缓存只重放文本、
  tool call 被静默丢弃」的 bug，表现为同样的问题第二次问就不执行工具了
- XML 协议散文改为条件注入：确认原生可用后不再注入，回退模式下仍然注入
- 新建 `toolInputSchemas.ts`，把散落在系统提示散文和各 handler 解析函数里的输入契约
  收敛成一份 JSON Schema（schema 以 handler 实际解析逻辑为准，不以散文为准）
- `StreamingToolCallParser`（11 个测试）与 `ToolCallMarkup`（2 个）全部保留 —— 回退路径仍依赖它们

**`task` 工具（子代理派发）**

- 新增 `prompts/tools/task.md` + `taskHandler.ts`，最多 8 个子任务、并发默认 3（上限 4）
- 子代理使用受限只读工具集：`workspace-read`、`search-index`、`glob-search`、
  `file-ops` 的 `read/list`。协议 schema 和执行前校验双重禁止写入，也不开放 shell、web、MCP
  或 `task`，因此不能绕过审批或递归派发更多子代理
- 支持 `explore` / `review` / `test` / `general` 专职角色；高优先级任务先调度，单个 worker
  最多 8 轮只读工具调用，取消时未启动任务直接标记为 cancelled
- 派发前必须审批，预览里列出每个子任务标题；拿不到编排器（没配 API key）时直接失败，
  不弹审批 —— 弹了也只是让用户批准一件做不成的事
- 全部子任务失败时返回 `ok: false`，避免模型把一堆错误信息当成调研结论往下走；
  部分成功仍算成功
- `createRuntime` 注入的是「取当前 gateway」的闭包而非实例：executor 比 gateway 先构造，
  且 gateway 会随 `:model` 切换被替换，存实例会让 task 一直用旧模型的网关

**修掉两个超时 bug**

- 工具执行超时（30s）此前把**审批等待也算了进去**：用户在面板上想满 30 秒，
  一个已经批准的写入就会以超时失败告终。新增 `ToolExecutionDeadline`，
  `pause()` / `resume()` 让计时只在真正干活时流逝
- 原先的 `setTimeout` 从不清理，每次工具调用都留一个定时器把事件循环按住；
  现在 `finally` 里 `dispose()`
- `task` 预算单独放大到 10 分钟：一次批次要串起若干次完整模型往返，
  沿用 30s 的话任何真实派发都会在第一个子任务答完前被杀掉（单次请求已由 gateway 的
  `timeoutMs` 各自兜住，批次不会无限悬着）

**子任务进度上屏**

- `ToolExecutionRequest` 新增可选 `onProgress`；工具执行是「一次调用返回一个结果」的模型，
  中途没有向界面推送的通道，派 4 个子代理时界面会静默几十秒
- 新增 `ToolProgressChannel`：回调里没法 yield，所以事件先进队列，
  `drain()` 一边等执行结束一边把事件吐给 generator。排空队列**先于**判断是否结束 ——
  反过来会漏掉最后一批事件（最后一个子任务完成与整体完成几乎同时发生）

**当前测试状态：`239 pass / 0 fail`（30 个文件）**

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
