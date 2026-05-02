# Prompt Pack

`Adnify-Cli` 的系统提示词、工具定义和本地命令说明统一维护在这个目录里。

## 目录约定

- `assistant/profile.md`
  - 助手品牌身份、维护者、默认模式和产品简介
- `system/core.md`
  - 所有模式共享的核心系统提示词
- `system/modes/*.md`
  - 按模式拆分的行为约束
- `tools/*.md`
  - 每个工具一份文档，包含元信息和职责说明
- `commands/local-commands.md`
  - 本地命令清单与入口说明

## 设计原则

1. 长提示词优先放在 Markdown，不把大段 prompt 直接硬编码到 TypeScript。
2. 代码层只负责加载、校验和组装，不负责维护大段文案。
3. 每个工具定义都是独立文档，方便后续继续扩展协议和执行策略。
4. 模式提示词和核心提示词分离，避免一个巨大的 system prompt 难以维护。

## Frontmatter 规范

工具和助手 profile 文件使用极简 frontmatter：

```md
---
id: shell-runner
name: Shell Runner
category: terminal
riskLevel: dangerous
---
```

当前实现只支持简单的 `key: value` 结构。
