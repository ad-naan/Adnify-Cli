---
id: runtime-control
name: Runtime Control
category: orchestration
riskLevel: careful
---

Inspect or change CLI runtime settings on the user's behalf. Supports session assistant mode,
tool permission mode, language, animation level, and switching among already configured providers
and models. Low-risk preference changes run directly. Capability increases and model changes are
classified by the host and may pause for keyboard approval. Never request, reveal, or echo API keys.
When the user asks for implementation while the session or permission mode is explicitly `plan`,
call `begin-execution` instead of telling the user to type a command. The host presents one keyboard
approval and, when accepted, moves the session to agent execution with workspace permissions.
