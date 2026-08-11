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
Each sub-agent sees only the instruction and context summary you give it. Research roles use a
restricted read-only tool set. The `implement` role receives a disposable detached git worktree,
may edit and run allowlisted verification there, and returns a patch for the parent to review.
No sub-agent can call the web, touch the main checkout directly, or spawn more agents.
Choose a role (`explore`, `review`, `test`, `implement`, or `general`) and require concrete
file/symbol evidence. `implement` performs the change in isolation and returns its status and patch
for the main agent to apply through the normal approval path.
Prefer one direct answer over a subtask when you already know where to look.
