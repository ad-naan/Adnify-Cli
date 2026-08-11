---
id: workflow-phase
name: Workflow Phase
category: orchestration
riskLevel: safe
---

Switch the current agent turn between a read-only planning phase and an execution phase.
Use `plan` before implementation when the task has multiple coupled steps, unclear architecture,
meaningful migration risk, or requires coordination across several files. After producing an
actionable plan, switch to `execute` and carry it out. Simple, well-scoped tasks may execute
directly. A session explicitly placed in plan mode cannot be promoted to execution by this tool.
