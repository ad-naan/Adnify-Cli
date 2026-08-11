import { Box, Text, useWindowSize } from 'ink'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import { memo } from 'react'
import { adnifyTheme } from '../theme'

export interface StatusDockProps {
  statusLine: string
  isBusy: boolean
  isConfigured: boolean
  workspaceName: string
  isGitRepository: boolean
  mode: AssistantMode
  modelLabel: string
  contextPercent: number
  approxTokens: number
  contextWindowTokens: number
  i18n: AppI18n
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`
  return `${Math.round(tokens / 1_000)}k`
}

export const StatusDock = memo(function StatusDock(props: StatusDockProps) {
  const { columns } = useWindowSize()
  const showSessionMeta = columns >= 64
  const showWorkspace = columns >= 82
  const readinessLabel = props.isConfigured
    ? props.i18n.t('status.configured')
    : props.i18n.t('status.setupRequired')
  const readinessColor = props.isConfigured ? adnifyTheme.success : adnifyTheme.warm
  const contextColor =
    props.contextPercent >= 90
      ? adnifyTheme.danger
      : props.contextPercent >= 75
        ? adnifyTheme.warm
        : adnifyTheme.textMuted
  const showStatusMessage =
    props.isBusy ||
    !props.isConfigured ||
    /(?:error|fail|abort|denied|错误|失败|中止|拒绝|配置)/i.test(props.statusLine)

  return (
    <Box width="100%" justifyContent="space-between" paddingX={1}>
      <Box gap={1} flexGrow={1} minWidth={1}>
        <Text color={props.isBusy ? adnifyTheme.brand : readinessColor} bold>
          {props.isBusy ? '●' : '◇'}
        </Text>
        <Text color={adnifyTheme.textMuted} wrap="truncate-end">
          {showStatusMessage
            ? props.statusLine
            : `${props.workspaceName} · ${props.isGitRepository ? 'git' : 'no-git'}${columns >= 96 ? ' · ↑↓ history · PgUp/PgDn scroll' : ''}`}
        </Text>
      </Box>
      <Box gap={1} flexShrink={0} marginLeft={2}>
        {showWorkspace && showStatusMessage ? <Text color={adnifyTheme.textDim}>{props.workspaceName}</Text> : null}
        {showSessionMeta ? (
          <>
            <Text color={adnifyTheme.borderMuted}>│</Text>
            <Text color={adnifyTheme.textSecondary}>{props.mode}</Text>
            <Text color={adnifyTheme.textDim} wrap="truncate-end">{props.modelLabel}</Text>
            <Text color={adnifyTheme.borderMuted}>│</Text>
            <Text color={contextColor}>
              ctx {props.contextPercent}% · {formatTokenCount(props.approxTokens)}/{formatTokenCount(props.contextWindowTokens)}
            </Text>
          </>
        ) : null}
        {!showSessionMeta ? <Text color={readinessColor}>{readinessLabel}</Text> : null}
      </Box>
    </Box>
  )
})
