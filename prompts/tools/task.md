---
id: task
name: Task
category: orchestration
riskLevel: careful
---

Delegate independent read-and-reason subtasks to parallel sub-agents, each running in its own
isolated context, then collect their answers.
Use this when a question fans out across several unrelated areas and you only need each
conclusion, not the intermediate reading.
Each sub-agent sees only the instruction and context summary you give it — it cannot see this
conversation, and it cannot call tools or read files, so put every fact it needs into the
instruction itself.
Prefer one direct answer over a subtask when you already know where to look.
