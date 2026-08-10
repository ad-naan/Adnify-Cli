

# Adnify-Cli

> **Command AI Into Real Work.**
>
> A branded AI coding terminal built for real-world engineering delivery.

`Adnify-Cli` is a CLI AI programming assistant built on `Bun + TypeScript + Ink`. It doesn't just port web-based chat into the terminal; instead, it integrates sessions, commands, configuration, recovery, persistence, and future Agent capabilities into a stable, clear, and sustainably evolving engineering workspace.

The project currently uses a DDD (Domain-Driven Design) layered architecture as its skeleton, emphasizing:

- **High Performance:** Stable terminal rendering with streaming output that minimizes jitter and re-renders.
- **Loose Coupling:** Clear responsibilities across domain, application, infrastructure, and presentation layers.
- **High Cohesion:** Sessions, configuration, storage, prompts, and command systems can evolve independently.
- **High Reusability:** Ports, use cases, Prompt Packs, storage parsers, and UI components are all reusable.
- **Extensibility:** Clear entry points are reserved for future tool calling, Agent orchestration, multi-turn execution, and plugin capabilities.

## Project Positioning

Adnify-Cli aims to be not just "a CLI that can chat," but "a true AI engineering assistant that works alongside you in the terminal."

It will gradually possess these capabilities:

- Acts like a product, not just a script.
- Acts like a development workspace, not just a Q&A window.
- Acts like a long-term collaborator, not just a one-off generator.

## Current Capabilities

The current repository has implemented or supports the following foundational features:

- Basic `Bun + TypeScript + Ink` project is runnable.
- DDD-style layered directory structure is set up:
  - `domain`
  - `application`
  - `infrastructure`
  - `presentation`
- Supports three working modes: `chat / agent / plan`.
- Supports a local command system with a command suggestion panel.
- Supports streaming response output.
- Supports session persistence via files.
- Supports automatic recovery of the most recent session per workspace.
- Supports session management commands: `:session / :sessions / :resume`.
- Supports `:config` series commands for model configuration.
- Supports `:storage` series commands for managing data directories.
- Supports runtime model configuration switching.
- Supports bilingual (Chinese/English) internationalization infrastructure.
- Supports Prompt Pack-driven system prompts, mode prompts, tool definitions, and command definitions.
- Supports closed-loop tool calling with eight built-in tools (`workspace-read / search-index / glob-search / file-ops / shell-runner / web-search / web-fetch / task`) plus dynamically discovered MCP tools; progress and results flow back into the session area.
- Supports risk grading and interactive approval: Execution pauses and waits for user confirmation before writing files or running verification commands.
- Supports cross-session workspace memory through `:memory`.
- Supports Git checkpoints (`:checkpoint` / `:undo`) and file-level restore points (`:restore`).
- Uses an original terminal otter mascot and river-inspired palette instead of a generic robot mark.
- Supports a `Ctrl+O` fullscreen transcript: regular conversations collapse verbose tool details, while transcript mode expands the full audit trail.
- Long conversations support `PgUp / PgDn`; scrolling away pauses follow mode and `Esc` returns to the latest content first.
- Input interaction has been optimized to match a `cc`-style flow:
  - `Esc` prioritizes aborting execution or closing temporary panels.
  - `Tab / Enter` fills in the command in the command panel first, without direct execution.
  - Supports input history browsing.

## Terminal Interaction

- `Ctrl+O`: Open or close the fullscreen transcript.
- `PgUp / PgDn`: Scroll long conversations one viewport at a time.
- `Esc`: Abort active work first, return to the latest content while browsing history, or close transcript mode when already at the bottom.
- The regular conversation shows compact tool summaries; transcript mode exposes complete inputs, outputs, and elapsed time.
- Approval and configuration prompts automatically leave transcript mode so required actions remain visible.

## Tech Stack

- Runtime: `bun`
- Language: `TypeScript`
- Terminal UI: [Ink](https://github.com/vadimdemedes/ink)
- Architecture: DDD-style layered architecture

## Quick Start

Install dependencies:

```bash
bun install
```

Run in development mode:

```bash
bun run dev
```

Build:

```bash
bun run build
```

Test:

```bash
bun test
```

Type check:

```bash
bunx tsc --noEmit
```

Run tests, type checking, and the production build together before delivery:

```bash
bun run verify
```

## Configuration Methods

Adnify-Cli currently supports two configuration sources:

- Environment variables
- Local configuration files

Primary environment variables:

- `ADNIFY_PROVIDER`
- `ADNIFY_API_KEY`
- `ADNIFY_BASE_URL`
- `ADNIFY_MODEL`
- `ADNIFY_LOCALE`
- `ADNIFY_HOME`

Where:

- `ADNIFY_LOCALE` specifies the interface language; currently supports `zh-CN` and `en`.
- `ADNIFY_HOME` directly specifies the application's data directory.

When `ADNIFY_HOME` is set, it takes precedence over locally saved custom storage paths.

### Recommended Configuration Commands

It is recommended to use CLI commands for configuration rather than embedding the configuration process into the session stream:

- `:config`
- `:config init`
- `:config set provider <value>`
- `:config set model <value>`
- `:config set api-key <value>`
- `:config set base-url <value>`
- `:config clear api-key`

` :config init` currently enters a temporary input panel configuration mode, rather than writing the entire configuration conversation into the session area.

## Data Storage Design

This is a crucial capability in the current version.

Adnify-Cli already supports:

- File-based configuration storage
- File-based session storage
- Custom data directories
- Cross-platform default path resolution
- Storage directory migration

### Default Paths

Windows:

- settings: `%APPDATA%\Adnify-Cli\settings.json`
- data: `%LOCALAPPDATA%\Adnify-Cli`

macOS:

- settings/data root: `~/Library/Application Support/Adnify-Cli`

Linux:

- settings: `$XDG_CONFIG_HOME/adnify-cli` or `~/.config/adnify-cli`
- data: `$XDG_DATA_HOME/adnify-cli` or `~/.local/share/adnify-cli`

### Current Data Contents

The data directory currently contains:

- `config.json`
- `sessions/<sessionId>.json`
- `memories/<workspace>.json`

File-level write snapshots are stored in `.adnify/checkpoints/` inside the workspace and do not require Git.

### Custom Data Directory

Supported via two methods:

1. Set the `ADNIFY_HOME` environment variable.
2. Save via CLI command to `settings.json`.

Related commands:

- `:storage`
- `:storage set <path>`
- `:storage reset`

When `:storage set <path>` is executed, the CLI will attempt to migrate the existing `config.json` and `sessions/` to the new directory.

The goal of this design is:

- Windows users are not forced to store all data on the C drive.
- Users have explicit control.
- Falls back to system standard directories if not configured.
- Consistent behavior across Linux, macOS, and Windows.

## Session Behavior

The current session system exhibits the following behaviors:

- Each workspace maintains its own session history.
- On startup, it prioritizes restoring the most recent session for the current workspace.
- If the current workspace has no session history, a new session is automatically created.
- After the first real prompt is submitted, the session title is auto-generated based on the content.
- Supports viewing and restoring recent sessions.

Related commands:

- `:session`
- `:sessions`
- `:resume [index|id]`
- `:clear`

## Local Commands

Currently built-in commands include:

- `:help`
- `:mode chat`
- `:mode agent`
- `:mode plan`
- `:workspace`
- `:status`
- `:tools`
- `:doctor`
- `:diff`
- `:review`
- `:model [provider] [model]`
- `:config`
- `:config init`
- `:config set provider [value]`
- `:config set model [value]`
- `:config set api-key [value]`
- `:config set base-url [value]`
- `:config clear api-key`
- `:session`
- `:sessions`
- `:resume [index|id]`
- `:memory [content]`
- `:memory list`
- `:memory clear`
- `:checkpoint [message]`
- `:undo`
- `:restore [id|index]`
- `:skill [name|list]`
- `:mcp`
- `:context`
- `:storage`
- `:storage set [path]`
- `:storage reset`
- `:clear`
- `:exit`

## Tool Calling and Approval

The model can invoke eight built-in tools plus tools discovered from configured MCP servers:

| Tool | Capability | Risk |
|---|---|---|
| `workspace-read` | Read workspace summary | safe |
| `search-index` | Code search based on ripgrep (falls back to built-in scanning if rg is unavailable) | safe |
| `glob-search` | Match workspace files with glob patterns | safe |
| `file-ops` | `read` / `list` / `write` / `update` / `patch` | Read operations: safe, Write operations: careful |
| `shell-runner` | Whitelist command execution | Read-only search: safe, Verification commands: careful |
| `web-search` | Public web search through DuckDuckGo without an API key | careful |
| `web-fetch` | Fetch and extract text from an HTTP(S) URL | careful |
| `task` | Dispatch up to eight parallel subtasks and stream their progress | careful |
| `mcp__<server>__<tool>` | Invoke a tool exposed by a connected MCP server | careful |

`shell-runner` only allows the following commands; all others are rejected:

- No approval required: `rg`, `grep`, `find`, `cat`, `head`, `tail`, `wc`, `sort`, `uniq`, and read-only Git commands.
- Approval required: project validation commands, package installation, and supported mutating Git commands.

### Approval Mechanism

File writes and verification command executions are not decided by the model alone. Execution pauses before actual disk writes/execution, triggering an approval panel in the terminal that displays the tool name, risk level, operation summary, and target path, waiting for key input:

- `y` — Approve this instance
- `n` — Reject; the rejection reason is returned to the model as the tool result, prompting the model to adjust its approach rather than retrying
- `a` — Always allow this tool within the current session

Pressing `Esc` while the approval panel is suspended will abort the current round of execution and reject all pending approvals, preventing hangs.

The rationale behind this design: `allowWrite: true` in tool descriptions is merely a self-declaration by the model. The model could bypass it with a few extra keystrokes, so it is not a permission boundary. The true boundary must rest on user keystrokes.

## Prompt Pack

Markdown files in the `prompts/` directory drive the following:

- Assistant identity
- System prompts
- Mode prompts
- Tool definitions
- Local command definitions

This means the prompt system is not hardcoded into the core logic but exists as a maintainable, replaceable, and iterative resource set.

This is crucial for future evolution, as it enables us to:

- More easily implement branded role expressions.
- More easily split prompts across different modes.
- More easily manage tool definition versions.

## Directory Structure

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

## Architecture Overview

### `src/domain`

Core domain models, aggregate roots, value objects, and domain behaviors.

### `src/application`

Use case orchestration, port definitions, DTOs, internationalization, and application-layer support logic.

### `src/infrastructure`

Model gateway, configuration read/write, storage implementation, prompt loading, logging, and workspace detection.

### `src/presentation`

Ink UI, interaction controllers, terminal layout, input processing, and view components.

## Development Guidelines

The repository includes a `.rules/` directory to constrain collaboration methods, architectural boundaries, and delivery quality during the vibecoding process.

- [.rules/README.md](./.rules/README.md)
- [.rules/00-core.md](./.rules/00-core.md)
- [.rules/10-architecture.md](./.rules/10-architecture.md)
- [.rules/20-coding-style.md](./.rules/20-coding-style.md)
- [.rules/30-delivery-workflow.md](./.rules/30-delivery-workflow.md)
- [.rules/40-ai-collaboration.md](./.rules/40-ai-collaboration.md)

## Current Progress Assessment

Roughly divided by milestones:

- `M1` Session persistence and startup recovery: Complete
- `M2` Tool calling and Agent capabilities: Complete; eight built-in tools, dynamic MCP tools, and an Agent loop limit of 20 rounds
- `M3` Approval / Permissions / UI polish: Core capabilities are implemented; terminal regression and productization remain in progress

## Next Phase Priorities

Directions worth continuing to push forward:

- Run real-terminal regression checks for long-session scrolling, approval, abort, and resume flows.
- Continue improving the sessions list and command window.
- Add more failure-path coverage for Web, indexing, startup recovery, and MCP.
- Represent tool-call history with native `tool` role messages.
- Complete product screenshots, configuration documentation, and the release workflow.

## Project Information

- Project: `Adnify-Cli`
- Author: `adnaan`
- Package Manager: `bun`
- Terminal UI: `Ink`
