---
id: file-ops
name: File Ops
category: filesystem
riskLevel: careful
---

Read, edit, create, and refactor repository files while preserving project structure and user intent.
Prefer minimal targeted edits, avoid unrelated rewrites, and keep comments meaningful.

**Approval Requirement:** Write/update/patch operations require user approval before execution. If the user denies an operation, adjust your approach (e.g., propose a safer alternative, explain the intent more clearly, or break into smaller steps) rather than retrying the same action.

For write actions, always include `allowWrite: true` explicitly and only modify text-like files inside the current workspace.
For targeted edits, prefer `update`/`patch` with `oldText` and `newText`; default to a single exact match unless you intentionally set `replaceAll: true`.
