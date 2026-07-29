# Adnify-Cli Rules

这个目录用于约束 `Adnify-Cli` 的开发方式，尤其用于 `vibecoding` 场景下的稳定协作。

目标不是限制创造力，而是防止以下问题反复出现：

- 一时灵感驱动下的随意加层、乱改目录、耦合失控
- 为了“先跑起来”而把业务规则写进 UI、脚本或工具层
- AI 连续多轮修改后产生重复代码、无用抽象和风格漂移
- 注释、命名、测试和文档不统一，导致后续维护成本激增

## 规则文件

- [00-core.md](./00-core.md)
  核心协作原则与总约束
- [10-architecture.md](./10-architecture.md)
  DDD 分层、目录边界、依赖方向与模块拆分规范
- [20-coding-style.md](./20-coding-style.md)
  TypeScript、Bun、Ink、命名、注释、复用与禁止事项
- [30-delivery-workflow.md](./30-delivery-workflow.md)
  Vibecoding 的实施流程、提交流程、验证要求与变更边界
- [40-ai-collaboration.md](./40-ai-collaboration.md)
  面向 AI / 代理协作的直接执行规则

## 使用方式

每次开始新功能、重构或接入 AI 能力前，先检查：

1. 这次修改属于哪个边界上下文。
2. 这次修改是否破坏依赖方向。
3. 这次是否增加了重复抽象或无用中间层。
4. 这次是否有最小验证与必要文档更新。

如果新需求与这些规则冲突，优先更新规则，再改代码，避免“规则失效但没人维护”。

## 建议执行顺序

如果是人类开发者先读：

1. `00-core.md`
2. `10-architecture.md`
3. `20-coding-style.md`
4. `30-delivery-workflow.md`

如果是 AI / 编码代理先读：

1. `40-ai-collaboration.md`
2. `10-architecture.md`
3. `20-coding-style.md`
4. `30-delivery-workflow.md`
