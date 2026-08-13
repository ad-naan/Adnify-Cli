---
id: runtime-control
name: Runtime Control
category: orchestration
riskLevel: careful
---

Inspect or change CLI runtime settings on the user's behalf. Supports session assistant mode,
tool permission mode, language, animation level, switching among already configured providers and
models, and session-scoped execution budgets. Propose a runtime budget only when task complexity,
latency, or repeated failures justify it; include only fields that need changing. Every AI-proposed
budget change pauses for keyboard approval and never changes the user's persisted defaults. Never
request, reveal, or echo API keys.
When the user asks for implementation while the session or permission mode is explicitly `plan`,
call `begin-execution` instead of telling the user to type a command. The host presents one keyboard
approval and, when accepted, moves the session to agent execution with workspace permissions.
