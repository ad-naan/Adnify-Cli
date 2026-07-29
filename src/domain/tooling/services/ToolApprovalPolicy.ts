import type { ToolActionIntent } from '../value-objects/ToolApproval'

/**
 * 审批策略：给定一次操作意图，判断是否必须先取得用户同意。
 * 纯决策，不涉及 IO —— 便于单测，也保证「什么算危险」只有一处定义。
 */
export function requiresApproval(intent: ToolActionIntent): boolean {
  return intent.riskLevel !== 'safe'
}

/** file-ops 各动作的风险级别；未知动作按最严处理，避免新动作默默绕过审批。 */
export function classifyFileOpsRisk(action: string): 'safe' | 'careful' {
  return action === 'read' || action === 'list' ? 'safe' : 'careful'
}
