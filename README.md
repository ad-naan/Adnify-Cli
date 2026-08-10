# Adnify-Cli

> **Command AI Into Real Work.**
>
> 面向真实工程交付的品牌化 AI 编程终端。

`Adnify-Cli` 是一个基于 `Bun + TypeScript + Ink` 构建的 CLI AI 编程助手。它不是把网页聊天简单搬进终端，而是把会话、命令、配置、恢复、持久化和后续 Agent 能力整合成一套稳定、清晰、可持续演进的工程工作台。

项目当前以 DDD 分层架构为骨架，强调：

- 高性能：终端渲染稳定，流式输出尽量减少抖动与重复渲染。
- 低耦合：领域、应用、基础设施、展示层职责清晰。
- 高内聚：会话、配置、存储、提示词、命令系统各自可独立演进。
- 高复用：端口、用例、Prompt Pack、存储解析和 UI 组件都可复用。
- 可扩展：为后续工具调用、Agent 编排、多轮执行和插件能力预留清晰入口。

## 项目定位

Adnify-Cli 想做的不是“一个能聊天的 CLI”，而是“一个真正能陪你在终端里持续工作的 AI 工程助手”。

它会逐步具备这些能力：

- 像产品，而不只是脚本。
- 像开发工作台，而不只是问答窗口。
- 像长期协作者，而不只是一次性生成器。

## 当前能力

当前仓库已经完成或具备以下基础能力：

- Bun + TypeScript + Ink 基础工程可运行。
- DDD 风格分层目录结构已经搭好：
  - `domain`
  - `application`
  - `infrastructure`
  - `presentation`
- 支持 `chat / agent / plan` 三种工作模式。
- 支持本地命令系统与命令建议面板。
- 支持流式响应输出。
- 支持会话文件化持久化。
- 支持按工作区自动恢复最近会话。
- 支持 `:session / :sessions / :resume` 会话管理命令。
- 支持 `:config` 系列命令进行模型配置。
- 支持 `:storage` 系列命令管理数据目录。
- 支持运行时切换模型配置。
- 支持中英双语国际化基础设施。
- 支持 Prompt Pack 驱动的系统提示词、模式提示词、工具定义和命令定义。
- 支持工具调用闭环：内置 `workspace-read / search-index / glob-search / file-ops / shell-runner / web-search / web-fetch / task` 八个工具，并可动态接入 MCP 工具；工具过程、进度与结果会回流到会话区。
- 支持风险分级与交互式审批：写文件与执行验证命令前会暂停并等待用户确认。
- 支持跨会话项目记忆：`:memory <content>` 保存项目知识，后续会话自动注入。
- 支持 git 检查点：`:checkpoint` 一键提交当前工作状态，`:undo` 撤销最近检查点。
- 支持上下文窗口诊断：`:context` 查看消息数、token 估算和健康度。
- 输入交互已做过一轮接近 `cc` 风格的优化：
  - `Esc` 优先中止执行或关闭临时面板
  - `Tab / Enter` 在命令面板中先填入命令，不直接执行
  - 支持输入历史浏览

## 技术栈

- Runtime: `bun`
- Language: `TypeScript`
- Terminal UI: [Ink](https://github.com/vadimdemedes/ink)
- Architecture: DDD-style layered architecture

## 快速开始

安装依赖：

```bash
bun install
```

开发运行：

```bash
bun run dev
```

构建：

```bash
bun run build
```

测试：

```bash
bun test
```

类型检查：

```bash
bunx tsc --noEmit
```

提交前一次性验证测试、类型和构建：

```bash
bun run verify
```

## 配置方式

Adnify-Cli 当前支持两类配置来源：

- 环境变量
- 本地配置文件

主要环境变量：

- `ADNIFY_PROVIDER`
- `ADNIFY_API_KEY`
- `ADNIFY_BASE_URL`
- `ADNIFY_MODEL`
- `ADNIFY_LOCALE`
- `ADNIFY_HOME`

其中：

- `ADNIFY_LOCALE` 用于指定界面语言，当前支持 `zh-CN` 和 `en`
- `ADNIFY_HOME` 用于直接指定整个应用的数据目录

当设置了 `ADNIFY_HOME` 时，会优先于本地保存的自定义存储路径。

### 推荐配置命令

推荐优先使用 CLI 命令配置，而不是把配置过程塞进会话流里：

- `:config`
- `:config init`
- `:config set provider <value>`
- `:config set model <value>`
- `:config set api-key <value>`
- `:config set base-url <value>`
- `:config clear api-key`

` :config init` 当前会进入一个临时的输入面板配置模式，而不是把整段配置对话写进会话区。

## 数据存储设计

这是当前版本很重要的一部分能力。

Adnify-Cli 已支持：

- 文件化配置存储
- 文件化会话存储
- 自定义数据目录
- 跨平台默认路径解析
- 存储目录迁移

### 默认路径

Windows：

- settings: `%APPDATA%\Adnify-Cli\settings.json`
- data: `%LOCALAPPDATA%\Adnify-Cli`

macOS：

- settings/data root: `~/Library/Application Support/Adnify-Cli`

Linux：

- settings: `$XDG_CONFIG_HOME/adnify-cli` 或 `~/.config/adnify-cli`
- data: `$XDG_DATA_HOME/adnify-cli` 或 `~/.local/share/adnify-cli`

### 当前数据内容

数据目录当前包含：

- `config.json`
- `sessions/<sessionId>.json`
- `memories/<workspace>.json`

文件级写入快照存放在工作区的 `.adnify/checkpoints/`，不依赖 Git。

### 自定义数据目录

支持两种方式：

1. 设置环境变量 `ADNIFY_HOME`
2. 通过 CLI 命令保存到 `settings.json`

相关命令：

- `:storage`
- `:storage set <path>`
- `:storage reset`

当执行 `:storage set <path>` 时，CLI 会尝试把现有 `config.json` 和 `sessions/` 迁移到新目录。

这部分设计的目标是：

- Windows 用户不必被迫把所有数据都放在 C 盘
- 用户有显式控制权
- 未配置时仍能回退到系统标准目录
- Linux / macOS / Windows 三端行为保持一致

## 会话行为

当前会话系统具备这些行为：

- 每个工作区拥有自己的会话历史。
- 启动时优先恢复当前工作区最近一次会话。
- 如果当前工作区没有历史会话，则自动创建新会话。
- 第一条真实 prompt 提交后，会话标题会根据内容自动生成。
- 支持最近会话查看与恢复。

相关命令：

- `:session`
- `:sessions`
- `:resume [index|id]`
- `:memory [content]`
- `:memory list`
- `:memory clear`
- `:checkpoint [message]`
- `:undo`
- `:context`
- `:clear`
- `:exit`

## 工具调用与审批

模型可以调用八个内置工具，以及配置文件中已连接 MCP 服务器暴露的动态工具：

| 工具 | 能力 | 风险 |
|---|---|---|
| `workspace-read` | 读取工作区摘要 | safe |
| `search-index` | 基于 ripgrep 的代码检索（无 rg 时回退到内置扫描） | safe |
| `glob-search` | 基于通配符的文件匹配 | safe |
| `file-ops` | `read` / `list` / `write` / `update` / `patch` | 读取类 safe，写入类 careful |
| `shell-runner` | 白名单命令执行 | 只读检索 safe，验证类命令 careful |
| `web-search` | 基于 DuckDuckGo 的公开网络搜索（无需 API key） | careful |
| `web-fetch` | 获取并提取 URL 页面的文本内容 | careful |
| `task` | 并行派发最多 8 个子任务，并将进度回传会话区 | careful |
| `mcp__<server>__<tool>` | 调用已连接 MCP 服务器提供的工具 | careful |

`shell-runner` 只放行以下命令，其余一律拒绝：

- 无需审批：`rg`、`grep`、`find`、`cat`、`head`、`tail`、`wc`、`sort`、`uniq`、`git status/diff/log/show/branch/rev-parse/remote/tag/ls-files/blame/shortlog/describe`
- 需要审批：`bun test`、`bun run build/typecheck/test/lint/check/dev/start`、`bunx tsc/eslint/prettier/vitest`、`npm/pnpm/yarn run <script>/install/ci`、`npx tsc/eslint/prettier/vitest/jest`、`tsc`、`git add/commit/stash/checkout/reset/restore`

### 审批机制

写入文件和执行验证命令不由模型自行决定。执行会在真正落盘/执行前暂停，终端弹出审批面板，展示工具名、风险级别、操作摘要和目标路径，等待按键：

- `y` — 批准这一次
- `n` — 拒绝；拒绝原因会作为工具结果回给模型，模型据此调整方案而不是重试
- `a` — 本次会话内始终允许该工具

审批面板挂起时按 `Esc` 会中止当轮执行并拒绝所有待决审批，不会卡住。

这么设计的原因是：工具描述里的 `allowWrite: true` 只是模型的自我声明，模型多打几个字就能绕过，它不是权限边界。真正的边界必须落在用户按键上。

## Prompt Pack

`prompts/` 目录下的 Markdown 文件用于驱动以下内容：

- 助手身份
- 系统提示词
- 模式提示词
- 工具定义
- 本地命令定义

这意味着提示词系统不是硬编码在核心逻辑里，而是作为一套可维护、可替换、可迭代的资源存在。

这对后续演进很重要，因为它能让我们：

- 更容易做品牌化角色表达
- 更容易做不同模式下的提示词拆分
- 更容易做工具定义的版本化管理

## 目录结构

```text
Adnify-Cli/
|-- .rules/
|-- prompts/
|-- src/
|   |-- application/
|   |-- domain/
|   |-- infrastructure/
|   |-- presentation/
|   `-- main.tsx
|-- package.json
|-- tsconfig.json
|-- todolist.md
`-- README.md
```

## 架构说明

### `src/domain`

核心领域模型、聚合根、值对象和领域行为。

### `src/application`

用例编排、端口定义、DTO、国际化和应用层支持逻辑。

### `src/infrastructure`

模型网关、配置读写、存储实现、Prompt 加载、日志与工作区探测。

### `src/presentation`

Ink UI、交互控制器、终端布局、输入处理和视图组件。

## 开发规范

仓库内置 `.rules/` 目录，用来约束 vibecoding 过程中的协作方式、架构边界和交付质量。

- [.rules/README.md](./.rules/README.md)
- [.rules/00-core.md](./.rules/00-core.md)
- [.rules/10-architecture.md](./.rules/10-architecture.md)
- [.rules/20-coding-style.md](./.rules/20-coding-style.md)
- [.rules/30-delivery-workflow.md](./.rules/30-delivery-workflow.md)
- [.rules/40-ai-collaboration.md](./.rules/40-ai-collaboration.md)

## 当前进度判断

如果按里程碑粗略划分：

- `M1` 会话持久化与启动恢复：已完成
- `M2` 工具调用与 Agent 能力：已完成；支持八个内置工具、动态 MCP 工具和最多 20 轮 Agent 循环
- `M3` 审批 / 权限 / UI 打磨：核心能力已落地，继续做终端回归与产品化收口

## 下一阶段重点

接下来更值得继续推进的方向：

- 做一轮真实终端回归，覆盖长会话滚动、审批、中止与恢复
- 继续优化 sessions 列表和命令视窗的展示逻辑
- 为 Web、索引、启动恢复和 MCP 补充更多异常路径测试
- 将工具调用历史升级为真正的 `tool` 角色消息
- 完善产品截图、配置专题文档与发布流程

## 项目信息

- Project: `Adnify-Cli`
- Author: `adnaan`
- Package Manager: `bun`
- Terminal UI: `Ink`
