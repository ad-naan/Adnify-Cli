/**
 * 工具审批的领域语言。
 * 这里只描述「一次操作意图」与「用户的决定」，不涉及任何 IO 或终端细节。
 */

export type ToolRiskLevel = 'safe' | 'careful' | 'dangerous'

export type ToolApprovalDecision = 'approved' | 'denied' | 'always-approved'

/** 一次待审批的工具操作意图，同时供策略判断与终端展示使用。 */
export interface ToolActionIntent {
  toolId: string
  riskLevel: ToolRiskLevel
  /** 面向用户的动作摘要，例如 `write src/a.ts` 或 `bun test`。 */
  summary: string
  /** 受影响的工作区相对路径，只读类操作可以为空。 */
  targetPath?: string
  /**
   * 改动预览（统一 diff 文本），仅写入类操作提供。
   * 让用户在批准前看到「将要发生什么」—— 此时改动还没落盘，git diff 看不到。
   */
  preview?: string
}

export function isApprovedDecision(decision: ToolApprovalDecision): boolean {
  return decision === 'approved' || decision === 'always-approved'
}
