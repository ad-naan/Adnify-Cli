<div align="center">

# 🦦 Adnify-Cli

**你的终端。你的模型。你的代码。**

一个跑在终端里的 AI 编程搭档——不是聊天框搬进终端，而是真正能读你的代码、改你的文件、跑你的命令，同时每一步都等你点头。

本地运行，数据不出你的机器。支持 OpenAI / Anthropic / Google / 任意 OpenAI 兼容接口，不绑定任何平台。

[📚 English Documentation](./README.md)

[快速开始](#-快速开始) · [为什么选 Adnify-Cli](#-为什么选-adnify-cli) · [工具与审批](#️-工具与审批) · [配置](#-配置) · [架构](#-架构)

<img src="https://raw.githubusercontent.com/ad-naan/Adnify-Cli/main/assets/main.png#gh-light-mode-only" alt="Adnify-Cli 终端界面" width="100%" />
<img src="https://raw.githubusercontent.com/ad-naan/Adnify-Cli/main/assets/main-dark.png#gh-dark-mode-only" alt="Adnify-Cli 终端界面" width="100%" />

</div>

---

## 🔑 为什么选 Adnify-Cli

| 你关心的 | Adnify-Cli 怎么做 |
|---|---|
| **隐私** | 本地运行，API Key 和会话数据只存在你的磁盘上，不经过任何中间服务器 |
| **不绑定平台** | OpenAI、Anthropic、Google、Ollama、DeepSeek、零一万物……只要是 OpenAI 兼容接口就能接 |
| **AI 别乱动我代码** | 每次写文件、跑命令前都会弹出审批面板，你按 `y` 才落盘，按 `n` 直接拒绝 |
| **改坏了能撤销** | `:undo` 一键回滚，文件级快照不依赖 Git——就算没仓库也能恢复 |
| **别每次从头解释项目** | `:memory` 跨会话记住项目约定、架构决策、踩过的坑，下次自动带上 |
| **token 别偷偷用完** | `:context` 实时显示消息数、token 估算和健康度，上下文快炸了会告诉你 |
| **工具不够用** | 内置 8 个工具 + MCP 协议支持，接你自己的工具服务器无限扩展 |
| **提示词想自己改** | 所有系统提示词、工具定义都是 `prompts/` 目录下的 Markdown，改文件就能定制 |
| **中文体验** | 中英双语界面，`Ctrl+O` 全屏审计记录，`PgUp/PgDn` 滚动长会话 |

---

## ✨ 功能特性

### 三种工作模式

| 模式 | 说明 |
|---|---|
| **Chat** | 日常问答与代码讨论 |
| **Agent** | 多轮工具调用，自动读写文件、执行命令、搜索代码，最多 20 轮自主循环 |
| **Plan** | 先规划再执行，适合复杂任务 |

### 核心能力

- **流式响应** — 实时输出，终端渲染稳定低抖动
- **会话持久化** — 每个工作区独立保存，启动自动恢复上次会话，关了终端不丢上下文
- **工具调用闭环** — 8 个内置工具 + 动态 MCP 工具，过程与结果实时回流会话区
- **风险分级审批** — 写文件和执行命令前暂停等待用户确认，模型说了不算，你说了算
- **跨会话项目记忆** — `:memory` 保存项目知识，后续会话自动注入
- **检查点与撤销** — `:checkpoint` / `:undo` / `:restore`，文件级快照不依赖 Git
- **上下文窗口诊断** — `:context` 实时查看消息数、token 估算和健康度
- **中英双语** — 界面语言自由切换
- **Prompt Pack** — 系统提示词、工具定义、命令定义全在 `prompts/` 下，改文件就能定制
- **原生 tool calling** — 优先使用 provider 原生函数调用，不支持时自动回退到文本解析
- **全屏审计记录** — `Ctrl+O` 展开完整的工具输入、输出和耗时，普通视图折叠噪音

---

## 🎮 终端交互

| 按键 | 行为 |
|---|---|
| `Ctrl+O` | 打开 / 关闭全屏会话记录 |
| `PgUp / PgDn` | 按屏滚动长会话 |
| `Esc` | 执行中优先中止；浏览历史时回到底部；底部时退出全屏记录 |
| `Tab / Enter` | 命令面板中先填入命令，不直接执行 |

- 普通会话只展示工具摘要，完整输入、输出和耗时在全屏记录中查看
- 审批或配置向导出现时自动退出全屏记录，保证关键操作始终可见

---

## 🛠️ 工具与审批

### 内置工具

| 工具 | 能力 | 风险 |
|---|---|---|
| `workspace-read` | 读取工作区摘要 | 🟢 safe |
| `search-index` | 基于 ripgrep 的代码检索（无 rg 时回退到内置扫描） | 🟢 safe |
| `glob-search` | 基于通配符的文件匹配 | 🟢 safe |
| `file-ops` | `read` / `list` / `write` / `update` / `patch` | 🟢 读取 safe · 🟡 写入 careful |
| `shell-runner` | 白名单命令执行 | 🟢 只读 safe · 🟡 验证类 careful |
| `web-search` | 基于 DuckDuckGo 的公开网络搜索（无需 API key） | 🟡 careful |
| `web-fetch` | 获取并提取 URL 页面的文本内容 | 🟡 careful |
| `task` | 并行派发最多 8 个子任务，进度回传会话区 | 🟡 careful |
| `mcp__*` | 调用已连接 MCP 服务器提供的工具 | 🟡 careful |

### 审批机制

写入文件和执行验证命令不由模型自行决定。执行会在真正落盘 / 执行前暂停，终端弹出审批面板，展示工具名、风险级别、操作摘要和目标路径：

| 按键 | 行为 |
|---|---|
| `y` | 批准这一次 |
| `n` | 拒绝；拒绝原因回给模型，模型据此调整方案 |
| `a` | 本次会话内始终允许该工具 |

> 工具描述里的 `allowWrite: true` 只是模型的自我声明，模型多打几个字就能绕过——真正的权限边界必须落在用户按键上。

---

## ⚡ 快速开始

### 安装

```bash
# 通过 npm 全局安装
npm install -g adnify-cli

# 更新已有安装
npm install -g adnify-cli@latest

# 运行
adnify
```

> 需要 Node.js 20 或更高版本。Bun 仅用于本地开发。

### 开发

```bash
# 安装依赖
bun install

# 开发运行
bun run dev

# 构建
bun run build

# 测试
bun test

# 提交前验证（测试 + 类型检查 + 构建）
bun run verify
```

---

## ⚙️ 配置

### 环境变量

| 变量 | 说明 |
|---|---|
| `ADNIFY_PROVIDER` | 模型提供商 |
| `ADNIFY_API_KEY` | API 密钥 |
| `ADNIFY_BASE_URL` | 自定义 API 地址 |
| `ADNIFY_MODEL` | 模型名称 |
| `ADNIFY_LOCALE` | 界面语言，支持 `zh-CN` 和 `en` |
| `ADNIFY_ANIMATION_LEVEL` | 动效级别，支持 `off`、`minimal` 和 `full`（默认） |
| `ADNIFY_HOME` | 应用数据目录（优先级最高） |

### 推荐配置命令

```
:config
:config init
:config set provider <value> [model]
:config set model <value>
:config set api-key <value>
:config set base-url <value>
:config clear api-key
:language <zh-CN|en>
:animation <off|minimal|full>
```

`:config init` 会进入临时输入面板配置模式；供应商和模型支持上下键选择、回车确认，也保留数字快捷选择。配置对话不会写进会话区。

---

## 💾 数据存储

**所有数据只存在你的本地磁盘上**——会话记录、配置、记忆，没有任何云同步，没有任何遥测。

### 默认路径

| 平台 | 路径 |
|---|---|
| **Windows** | `%APPDATA%\Adnify-Cli\settings.json` · `%LOCALAPPDATA%\Adnify-Cli` |
| **macOS** | `~/Library/Application Support/Adnify-Cli` |
| **Linux** | `$XDG_CONFIG_HOME/adnify-cli` · `$XDG_DATA_HOME/adnify-cli` |

### 数据目录结构

```
Adnify-Cli/
├── config.json
├── sessions/
│   └── <sessionId>.json
└── memories/
    └── <workspace>.json
```

文件级写入快照存放在工作区的 `.adnify/checkpoints/`，不依赖 Git。

### 自定义数据目录

不想放 C 盘？随便迁：

```
:storage              # 查看当前数据目录
:storage set <path>   # 迁移到新目录（自动迁移 config 和 sessions）
:storage reset        # 重置为系统默认路径
```

---

## 📋 命令一览

### 会话与记忆

```
:session              # 当前会话信息
:sessions             # 列出所有会话
:resume [index|id]    # 恢复指定会话
:memory [content]     # 保存项目记忆
:memory list          # 查看记忆
:memory clear         # 清空记忆
:context              # 上下文窗口诊断
:clear                # 清空当前会话
:exit                 # 退出
```

### 模式与工具

```
:mode chat | agent | plan
:workspace            # 当前工作区信息
:status               # 运行状态
:tools                # 可用工具列表
:model [provider] [model]
```

### 检查点与撤销

```
:checkpoint [message] # 创建检查点
:undo                 # 撤销最近检查点
:restore [id|index]   # 恢复文件级快照
```

### 其他

```
:help                 # 帮助
:doctor               # 环境诊断
:diff                 # 查看变更
:review               # 代码审查
:mcp                  # MCP 服务器管理
:skill [name|list]    # 技能管理
```

---

## 🏗️ 架构

### 技术栈

| 层 | 选型 |
|---|---|
| Runtime | Bun |
| Language | TypeScript |
| Terminal UI | [Ink](https://github.com/vadimdemedes/ink) + React |
| AI SDK | [Vercel AI SDK](https://sdk.vercel.ai/) |
| Architecture | DDD 风格分层架构 |

### 分层结构

```
src/
├── domain/            # 领域模型、聚合根、值对象、领域行为
├── application/       # 用例编排、端口定义、DTO、国际化
├── infrastructure/    # 模型网关、配置读写、存储、Prompt 加载、工具执行
└── presentation/      # Ink UI、交互控制器、终端布局、视图组件
```

### 设计原则

- **高性能** — 终端渲染稳定，流式输出减少抖动与重复渲染
- **低耦合** — 领域、应用、基础设施、展示层职责清晰
- **高内聚** — 会话、配置、存储、提示词、命令系统各自独立演进
- **高复用** — 端口、用例、Prompt Pack、存储解析和 UI 组件均可复用
- **可扩展** — 为后续 Agent 编排、多轮执行和插件能力预留清晰入口

### 开发规范

仓库内置 `.rules/` 目录，约束协作方式、架构边界和交付质量：

- [.rules/README.md](./.rules/README.md)
- [.rules/00-core.md](./.rules/00-core.md)
- [.rules/10-architecture.md](./.rules/10-architecture.md)
- [.rules/20-coding-style.md](./.rules/20-coding-style.md)
- [.rules/30-delivery-workflow.md](./.rules/30-delivery-workflow.md)
- [.rules/40-ai-collaboration.md](./.rules/40-ai-collaboration.md)

---

## 📈 里程碑

| 代号 | 目标 | 状态 |
|---|---|---|
| **M1** | 会话持久化与启动恢复 | ✅ 已完成 |
| **M2** | 工具调用与 Agent 能力（8 内置工具 + MCP + 20 轮 Agent 循环） | ✅ 已完成 |
| **M3** | 审批 / 权限 / UI 打磨与产品化收口 | 🔨 进行中 |

---

## 📄 License

[MIT](./LICENSE) © 2026 adnaan

---

<div align="center">

Made with 🦦 by **adnaan**

</div>
