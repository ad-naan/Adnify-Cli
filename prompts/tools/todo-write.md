---
id: todo-write
name: Todo Write
category: workspace
riskLevel: safe
---

Track a multi-step task as a live checklist shown to the user. Send the COMPLETE todo list every
call — it is a declarative overwrite, not an append — so include unchanged items each time. Each item
has `content` (imperative, e.g. "Add pagination to /users") and `status` (`pending`, `in_progress`,
or `completed`). Keep exactly one item `in_progress` while you work it, mark it `completed`
immediately when done, then start the next. Use this for tasks with three or more distinct steps or
when the user gives a list; skip it for trivial single-step work. This tool only updates the
checklist — it does not perform the steps.
