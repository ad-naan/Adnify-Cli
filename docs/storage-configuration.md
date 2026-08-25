# Storage & Configuration Reference

Adnify-Cli is a local-first tool: every byte it persists — sessions, model config, project memory, file checkpoints — stays on your disk. This document explains where each kind of data lives, how configuration is resolved, and how to move everything to a custom location.

## Data Directory Layout

All application data lives under a single data root:

```
<dataRoot>/
├── config.json          # Model config, extra providers, MCP servers
├── sessions/
│   └── <sessionId>.json # One file per conversation session
└── memories/
    └── <workspace>.json # Per-workspace project memory (:memory)
```

The data root is **not** where settings about storage itself live — see [Settings file](#settings-file) below.

### Default data root per platform

| Platform | Data root |
|---|---|
| **Windows** | `%LOCALAPPDATA%\Adnify-Cli` |
| **macOS** | `~/Library/Application Support/Adnify-Cli` |
| **Linux** | `$XDG_DATA_HOME/adnify-cli` (default `~/.local/share/adnify-cli`) |

### Workspace-local data

File-level write checkpoints live **inside the workspace** at `.adnify/checkpoints/`, independent of the data root. They do not require Git and record the originating session, tool, and tool input for each snapshot. Plan documents written in Plan mode go to `.adnify/plans/`.

## Settings File

A small JSON file describes "where should the data root be":

| Platform | Path |
|---|---|
| **Windows** | `%APPDATA%\Adnify-Cli\settings.json` |
| **macOS** | `~/Library/Application Support/Adnify-Cli/settings.json` |
| **Linux** | `$XDG_CONFIG_HOME/adnify-cli/settings.json` |

Shape:

```json
{
  "dataDirectory": "D:/MyData/Adnify-Cli",
  "locale": "zh-CN",
  "animationLevel": "full",
  "permissionMode": "workspace"
}
```

`dataDirectory` is only honored when `ADNIFY_HOME` is not set — the environment variable always wins (see resolution order below).

## Data Root Resolution Order

When Adnify-Cli starts, the data root is resolved in this order:

1. **`ADNIFY_HOME`** environment variable — highest priority, overrides everything
2. **`settings.json` → `dataDirectory`** — set via `:storage set <path>`
3. **Platform default** — the paths in the table above

The effective source is reported by `:storage` as `env` / `settings` / `default`.

## config.json

The main configuration file at `<dataRoot>/config.json`:

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

Notes:

- Numeric fields are clamped to the ranges shown; invalid values fall back to defaults rather than failing startup.
- `providers` entries require both `apiKey` and `baseUrl` to be listed; otherwise they are skipped.
- `mcpServers` entries require `command`; `args` / `env` are optional. Tools arrive as `mcp__<server>__<tool>`.

## Environment Variables

Environment variables override `config.json` fields (model-related only):

| Variable | Overrides | Notes |
|---|---|---|
| `ADNIFY_PROVIDER` | `model.provider` | Must be one of the four providers |
| `ADNIFY_API_KEY` | `model.apiKey` | |
| `ADNIFY_BASE_URL` | `model.baseUrl` | |
| `ADNIFY_MODEL` | `model.model` | |
| `ADNIFY_CONTEXT_WINDOW_TOKENS` | `model.contextWindowTokens` | |
| `ADNIFY_LOCALE` | `settings.json` `locale` | `zh-CN` or `en` |
| `ADNIFY_ANIMATION_LEVEL` | UI animation | `off` / `minimal` / `full` |
| `ADNIFY_HOME` | Data root entirely | Beats `:storage set` |

## Command Reference

```
:storage              # Show effective data root, config path, sessions dir, source
:storage set <path>   # Move data root (migrates config.json and sessions/)
:storage reset        # Back to platform default
:config init          # Interactive setup panel (provider, model, key, base URL)
:config set <field> <value>
:config clear api-key
:language <zh-CN|en>
:permissions <manual|workspace|auto|plan>
```

## Privacy

No telemetry, no crash reporting, no cloud sync. The only network traffic is:

1. Requests to your configured model endpoint (your API key, your provider)
2. `web-search` / `web-fetch` tool calls when the model uses them (DuckDuckGo / the target URL)

Everything else — sessions, memory, checkpoints, settings — never leaves the machine.
