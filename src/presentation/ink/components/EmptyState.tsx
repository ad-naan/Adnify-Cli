import { Box, Text, useWindowSize } from 'ink'
import type { SessionListItem } from '../../../application/dto/SessionListItem'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import type { PackageManagerName } from '../../../domain/workspace/entities/WorkspaceContext'
import { memo, useMemo } from 'react'
import { adnifyTheme } from '../theme'
import { MascotGlyph } from './MascotGlyph'
import { RecentSessionsList } from './RecentSessionsList'

export interface EmptyStateProps {
  assistantName: string
  author: string
  tagline: string
  description: string
  workspaceName: string
  packageManager: PackageManagerName
  isGitRepository: boolean
  mode: AssistantMode
  modelLabel: string
  busy?: boolean
  animateBrand?: boolean
  commands: string[]
  currentSessionId: string
  recentSessions: SessionListItem[]
  i18n: AppI18n
}

function resolveModeColor(mode: AssistantMode): string {
  if (mode === 'agent') return adnifyTheme.brandStrong
  if (mode === 'plan') return adnifyTheme.warm
  return adnifyTheme.success
}

function QuickCommandItem(props: { command: string }) {
  return (
    <Box gap={1}>
      <Text color={adnifyTheme.brandSoft}>❯</Text>
      <Text color={adnifyTheme.textPrimary}>{props.command}</Text>
    </Box>
  )
}

export const EmptyState = memo(function EmptyState(props: EmptyStateProps) {
  const { columns, rows } = useWindowSize()
  const compact = columns < 82
  const short = rows < 23
  const cardWidth = Math.max(38, Math.min(96, columns - 6))
  const dividerWidth = Math.max(24, cardWidth - 6)
  const quickCommands = useMemo(() => {
    const preferred = [':help', ':mode agent', ':sessions']
      .map((prefix) => props.commands.find((command) => command.startsWith(prefix)))
      .filter((command): command is string => Boolean(command))
    return (preferred.length >= 3 ? preferred : props.commands).slice(0, 3)
  }, [props.commands])
  const gitLabel = props.i18n.t(
    props.isGitRepository ? 'header.meta.gitTracked' : 'header.meta.gitDetached',
  )

  return (
    <Box width="100%" height="100%" justifyContent="center" alignItems="center" paddingX={1}>
      <Box
        width={cardWidth}
        flexDirection="column"
        borderStyle="round"
        borderColor={adnifyTheme.borderMuted}
        paddingX={2}
      >
        <Box
          width="100%"
          flexDirection={compact ? 'column' : 'row'}
          alignItems="center"
          justifyContent="center"
          gap={compact ? 0 : 3}
        >
          <MascotGlyph active={props.busy} animated={props.animateBrand} large={!short} />
          <Box flexDirection="column" alignItems={compact ? 'center' : 'flex-start'} minWidth={1}>
            <Box gap={1}>
              <Text color={adnifyTheme.brandSoft} bold>{props.assistantName}</Text>
              <Text color={adnifyTheme.textDim}>{props.i18n.t('common.by')} {props.author}</Text>
            </Box>
            <Text color={adnifyTheme.textSecondary}>{props.tagline}</Text>
            {!short ? <Text color={adnifyTheme.textMuted} wrap="wrap">{props.description}</Text> : null}
            <Box gap={1}>
              <Text color={resolveModeColor(props.mode)} bold>◇ {props.mode.toUpperCase()}</Text>
              <Text color={adnifyTheme.borderMuted}>·</Text>
              <Text color={adnifyTheme.textMuted} wrap="truncate-end">{props.modelLabel}</Text>
            </Box>
          </Box>
        </Box>

        <Text color={adnifyTheme.borderMuted}>{'─'.repeat(dividerWidth)}</Text>

        <Box width="100%" flexDirection={compact ? 'column' : 'row'} gap={compact ? 1 : 4}>
          <Box flexDirection="column" flexGrow={1} minWidth={1}>
            <Text color={adnifyTheme.brandSoft} bold>{props.i18n.t('empty.panelQuickStart')}</Text>
            {quickCommands.map((command) => <QuickCommandItem key={command} command={command} />)}
            <Text color={adnifyTheme.textDim}>{props.i18n.t('empty.hint')}</Text>
          </Box>

          <Box flexDirection="column" flexGrow={1} minWidth={1}>
            <Box justifyContent="space-between">
              <Text color={adnifyTheme.textDim}>{props.i18n.t('header.meta.workspace')}</Text>
              <Text color={adnifyTheme.textSecondary} wrap="truncate-middle">{props.workspaceName}</Text>
            </Box>
            <Box justifyContent="space-between">
              <Text color={adnifyTheme.textDim}>{props.packageManager}</Text>
              <Text color={props.isGitRepository ? adnifyTheme.success : adnifyTheme.warm}>{gitLabel}</Text>
            </Box>
            {!short ? (
              <RecentSessionsList
                sessions={props.recentSessions}
                currentSessionId={props.currentSessionId}
                i18n={props.i18n}
                layout="stack"
                limit={2}
              />
            ) : null}
          </Box>
        </Box>
      </Box>
    </Box>
  )
})
