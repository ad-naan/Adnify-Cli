# Changelog

All notable changes to Adnify CLI are documented in this file.

## 0.1.1 - 2026-08-25

### Added

- `multi-patch` action for `file-ops`: atomic multi-hunk edits — all hunks are validated in memory first; any failure rejects the whole batch, and the disk is only written once when everything succeeds.
- Windows console UTF-8 alignment at startup: stdin/stdout/stderr and the console code page switch to 65001, with silent fallback when unavailable.
- Storage & configuration guide (`docs/storage-configuration.md`, bilingual): data directory layout, `settings.json`, data-root resolution order, `config.json` reference, and environment variable mapping.

### Improved

- Unknown tool errors now echo the real available tool list (including the `mcp__` prefix hint), letting the model self-correct in one round.
- `:sessions` / `:resume` candidate titles are truncated by visible column width (CJK-aware), and the current session is annotated.
- Terminal rendering regression fixes: color-code-dependent assertions now go through `stripTerminalAnsi`; `366 pass / 0 fail` across 52 test files.

## 0.1.0 - 2026-08-11

### Added

- Unified keyboard-driven choice tabs for settings, approvals, and multi-step user questions.
- Adaptive plan-to-execution workflow with persistent plan documents.
- Multi-agent orchestration with isolated Git worktrees.
- Risk-aware permission modes and runtime control for autonomous operations.
- Immediate user-message rendering, execution feedback, and smoother terminal animations.

### Improved

- Context-window accounting and compaction behavior for long coding sessions.
- Provider and model configuration, language switching, and interactive command discovery.
- Release verification, npm trusted publishing, and package metadata validation.
