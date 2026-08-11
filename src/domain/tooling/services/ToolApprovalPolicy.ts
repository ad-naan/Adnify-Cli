import type { ToolActionIntent } from '../value-objects/ToolApproval'
import type { PermissionMode } from '../../../application/dto/UiPreferences'

export type ToolAuthorization = 'allow' | 'ask' | 'deny'

/**
 * 审批策略：给定一次操作意图，判断是否必须先取得用户同意。
 * 纯决策，不涉及 IO —— 便于单测，也保证「什么算危险」只有一处定义。
 */
export function requiresApproval(intent: ToolActionIntent): boolean {
  return intent.riskLevel !== 'safe'
}

/**
 * Resolve an operation against the active permission mode.
 * Protected and out-of-workspace targets never become silently writable.
 */
export function resolveToolAuthorization(
  intent: ToolActionIntent,
  mode: PermissionMode,
): ToolAuthorization {
  const scope = intent.scope ?? 'workspace'

  if (mode === 'plan') {
    if (intent.mutates || intent.kind === 'write' || intent.kind === 'git' || intent.kind === 'install') {
      return 'deny'
    }
    return scope === 'workspace' && intent.riskLevel === 'safe' ? 'allow' : 'ask'
  }

  if (scope === 'outside' || scope === 'protected') return 'ask'
  if (intent.riskLevel === 'safe') return 'allow'
  if (intent.riskLevel === 'dangerous') return 'ask'
  if (mode === 'manual') return 'ask'

  if (mode === 'workspace') {
    return intent.kind === 'write' ||
      intent.kind === 'verification' ||
      intent.kind === 'orchestration'
      ? 'allow'
      : 'ask'
  }

  // auto: known careful operations inside the workspace run autonomously.
  return 'allow'
}

/** file-ops 各动作的风险级别；未知动作按最严处理，避免新动作默默绕过审批。 */
export function classifyFileOpsRisk(action: string): 'safe' | 'careful' {
  return action === 'read' || action === 'list' ? 'safe' : 'careful'
}
