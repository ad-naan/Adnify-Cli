# 存储与配置参考

Adnify-Cli 是本地优先的工具:它持久化的每一个字节——会话、模型配置、项目记忆、文件检查点——都留在你的磁盘上。本文说明各类数据的存放位置、配置解析规则,以及如何把全部数据迁到自定义目录。

## 数据目录结构

所有应用数据都位于同一个数据根目录下:

```
<dataRoot>/
├── config.json          # 模型配置、附加 provider、MCP 服务器
├── sessions/
│   └── <sessionId>.json # 每个会话一个文件
└── memories/
    └── <workspace>.json # 每个工作区一份项目记忆(:memory)
```

数据根目录本身的位置由「设置文件」描述,见下文。

### 各平台默认数据根目录

| 平台 | 数据根目录 |
|---|---|
| **Windows** | `%LOCALAPPDATA%\Adnify-Cli` |
| **macOS** | `~/Library/Application Support/Adnify-Cli` |
| **Linux** | `$XDG_DATA_HOME/adnify-cli`(默认 `~/.local/share/adnify-cli`) |

### 工作区内的数据

文件级写入检查点存放在**工作区内**的 `.adnify/checkpoints/`,与数据根目录无关,不依赖 Git;每份快照记录了产生它的会话、工具与工具输入,恢复点可追溯到具体的 agent 执行。Plan 模式下写的规划文档位于 `.adnify/plans/`。

## 设置文件

一个很小的 JSON 文件,描述「数据根目录应该在哪」:

| 平台 | 路径 |
|---|---|
| **Windows** | `%APPDATA%\Adnify-Cli\settings.json` |
| **macOS** | `~/Library/Application Support/Adnify-Cli/settings.json` |
| **Linux** | `$XDG_CONFIG_HOME/adnify-cli/settings.json` |

结构:

```json
{
  "dataDirectory": "D:/MyData/Adnify-Cli",
  "locale": "zh-CN",
  "animationLevel": "full",
  "permissionMode": "workspace"
}
```

仅当未设置 `ADNIFY_HOME` 时 `dataDirectory` 才生效——环境变量永远优先(见下方解析顺序)。

## 数据根目录解析顺序

启动时按以下顺序解析:

1. **`ADNIFY_HOME`** 环境变量——最高优先级,覆盖一切
2. **`settings.json` 的 `dataDirectory`**——通过 `:storage set <path>` 设置
3. **平台默认路径**——见上表

`:storage` 会把实际生效来源显示为 `env` / `settings` / `default`。

## config.json

位于 `<dataRoot>/config.json` 的主配置文件:

```jsonc
{
  "model": {
    "provider": "openai-compatible",   // openai-compatible | openai-responses | anthropic | google
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "maxTokens": 4096,                 // 1 – 200000
    "contextWindowTokens": 128000,     // 4096 – 2000000
    "temperature": 0.7,                // 0 – 2
    "timeoutMs": 60000                 // 1000 – 600000
  },
  "providers": {
    "work-deepseek": {
      "provider": "openai-compatible",
      "apiKey": "sk-...",
      "baseUrl": "https://api.deepseek.com/v1",
      "models": ["deepseek-chat", "deepseek-reasoner"]
    }
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": { "SOME_VAR": "value" }
    }
  }
}
```

要点:

- 数值字段会钳制到所示区间;非法值回退默认值,不会阻断启动。
- `providers` 条目必须同时有 `apiKey` 和 `baseUrl` 才会被列出,否则跳过。
- `mcpServers` 条目必须提供 `command`;`args` / `env` 可选。工具以 `mcp__<server>__<tool>` 形式出现。

## 环境变量

环境变量覆盖 `config.json` 的对应字段(仅模型相关):

| 变量 | 覆盖目标 | 说明 |
|---|---|---|
| `ADNIFY_PROVIDER` | `model.provider` | 必须是四种 provider 之一 |
| `ADNIFY_API_KEY` | `model.apiKey` | |
| `ADNIFY_BASE_URL` | `model.baseUrl` | |
| `ADNIFY_MODEL` | `model.model` | |
| `ADNIFY_CONTEXT_WINDOW_TOKENS` | `model.contextWindowTokens` | |
| `ADNIFY_LOCALE` | `settings.json` 的 `locale` | `zh-CN` 或 `en` |
| `ADNIFY_ANIMATION_LEVEL` | 界面动效 | `off` / `minimal` / `full` |
| `ADNIFY_HOME` | 整个数据根目录 | 优先于 `:storage set` |

## 命令速查

```
:storage              # 查看生效的数据根目录、config 路径、sessions 目录与来源
:storage set <path>   # 迁移数据根目录(自动迁移 config.json 与 sessions/)
:storage reset        # 恢复平台默认
:config init          # 交互式配置面板(provider、模型、密钥、base URL)
:config set <字段> <值>
:config clear api-key
:language <zh-CN|en>
:permissions <manual|workspace|auto|plan>
```

## 隐私

没有遥测、没有崩溃上报、没有云同步。唯一的网络流量是:

1. 发往你配置的模型端点的请求(你的 API key,你的 provider)
2. 模型使用 `web-search` / `web-fetch` 工具时的访问(DuckDuckGo / 目标 URL)

其余一切——会话、记忆、检查点、设置——永远不离开本机。
