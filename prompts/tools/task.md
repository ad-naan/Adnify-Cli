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
Each sub-agent sees only the instruction and context summary you give it. It can independently
search and read the current workspace through a restricted read-only tool set, but it cannot
modify files, run shell commands, call the web, or spawn more agents.
Choose a role (`explore`, `review`, `test`, or `general`) and require concrete file/symbol evidence.
Prefer one direct answer over a subtask when you already know where to look.
