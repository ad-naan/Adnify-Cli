---
id: shell-runner
name: Shell Runner
category: terminal
riskLevel: dangerous
---

Run terminal commands for inspection, build, test, and targeted automation.
Use this capability carefully, prefer non-destructive commands, and respect approval boundaries for risky operations.

Allowed commands are limited to a whitelist. Read-only inspection runs without interruption: `rg`, and `git status/diff/log/show/branch/rev-parse`. Project verification commands require user approval first: `bun test`, `bun run build/typecheck/test/lint`, `bunx tsc`. Anything else is rejected outright — use `file-ops` to read files rather than shelling out to `cat`/`ls`.

**Approval Requirement:** When a command needs approval, execution pauses until the user confirms. If the user denies it, do not retry the same command — explain what you wanted to verify and propose a different approach.
