import { useCallback, useEffect, useState } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { ToolApprovalController } from '../../../application/ports/ToolApprovalPort'
import type {
  ToolActionIntent,
  ToolApprovalDecision,
} from '../../../domain/tooling/value-objects/ToolApproval'

export interface ToolApprovalState {
  isActive: boolean
  promptText: string
  errorText: string
  /** 处理审批面板上的按键；返回一句状态文案用于写入会话区，null 表示输入无效。 */
  handleInput: (input: string) => string | null
  /** 中止时清空待决审批，避免执行流挂死。 */
  denyAll: () => void
}

/**
 * 终端侧的工具审批面板。
 * 只做「展示待决意图 + 把按键翻译成决定」，真正的等待发生在适配器持有的 promise 里。
 */
export function useToolApproval(
  controller: ToolApprovalController | null,
  i18n: AppI18n,
): ToolApprovalState {
  const [pending, setPending] = useState<ToolActionIntent | null>(null)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    if (!controller) {
      return
    }

    controller.setObserver((intent) => {
      setPending(intent)
      setErrorText('')
    })
  }, [controller])

  const handleInput = useCallback(
    (input: string): string | null => {
      if (!controller || !pending) {
        return null
      }

      const decision = parseDecision(input)
      if (!decision) {
        setErrorText(i18n.t('approval.choiceError'))
        return null
      }

      setErrorText('')
      if (!controller.resolvePending(decision)) {
        return null
      }

      return describeDecision(decision, pending, i18n)
    },
    [controller, i18n, pending],
  )

  const denyAll = useCallback(() => {
    controller?.denyAllPending()
    setErrorText('')
  }, [controller])

  return {
    isActive: pending !== null,
    promptText: pending ? buildPromptText(pending, i18n) : '',
    errorText,
    handleInput,
    denyAll,
  }
}

function parseDecision(input: string): ToolApprovalDecision | null {
  switch (input.trim().toLowerCase()) {
    case 'y':
      return 'approved'
    case 'n':
      return 'denied'
    case 'a':
      return 'always-approved'
    default:
      return null
  }
}

function buildPromptText(intent: ToolActionIntent, i18n: AppI18n): string {
  const lines = [
    i18n.t('approval.title', { tool: intent.toolId }),
    `  ${intent.summary}`,
    `  ${i18n.t('approval.riskLabel', { value: i18n.t(`tool.risk.${intent.riskLevel}`) })}`,
  ]

  if (intent.targetPath) {
    lines.push(`  ${i18n.t('approval.targetLabel', { value: intent.targetPath })}`)
  }

  lines.push('', i18n.t('approval.instruction'))
  return lines.join('\n')
}

function describeDecision(
  decision: ToolApprovalDecision,
  intent: ToolActionIntent,
  i18n: AppI18n,
): string {
  switch (decision) {
    case 'approved':
      return i18n.t('approval.approvedStatus', { summary: intent.summary })
    case 'always-approved':
      return i18n.t('approval.alwaysApprovedStatus', { tool: intent.toolId })
    case 'denied':
      return i18n.t('approval.deniedStatus', { summary: intent.summary })
  }
}
