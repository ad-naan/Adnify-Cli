import { Box, Text, useStdout } from 'ink'
import type { SessionListItem } from '../../../application/dto/SessionListItem'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import type { PackageManagerName } from '../../../domain/workspace/entities/WorkspaceContext'
import { memo } from 'react'
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

function ModeBadge(props: { mode: AssistantMode; busy?: boolean }) {
  const color =
    props.mode === 'agent'
      ? adnifyTheme.brandStrong
      : props.mode === 'plan'
        ? adnifyTheme.warm
        : adnifyTheme.success

  return (
    <Text color={color} bold>
      {props.busy ? '● ' : '◇ '}{props.mode.toUpperCase()}
    </Text>
  )
}

function MetaRow(props: { label: string; value: string; color?: string }) {
  return (
    <Box width="100%" justifyContent="space-between">
      <Text color={adnifyTheme.textDim}>{props.label}</Text>
      <Text color={props.color ?? adnifyTheme.textSecondary}>{props.value}</Text>
    </Box>
  )
}

function QuickCommandItem(props: { command: string }) {
  return (
    <Box gap={1}>
      <Text color={adnifyTheme.brandSoft} bold>
        ❯
      </Text>
      <Text color={adnifyTheme.textPrimary}>{props.command}</Text>
    </Box>
  )
}

export const EmptyState = memo(function EmptyState(props: EmptyStateProps) {
  const { stdout } = useStdout()
  const compact = (stdout?.columns ?? 100) < 88
  const gitLabel = props.i18n.t(
    props.isGitRepository ? 'header.meta.gitTracked' : 'header.meta.gitDetached',
  )
  const gitColor = props.isGitRepository ? adnifyTheme.success : adnifyTheme.warm

  return (
    <Box
      width="100%"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
    >
      <Box flexDirection="column" alignItems="center">
        <MascotGlyph active={props.busy} animated={props.animateBrand} large />
        <Box flexDirection="column" alignItems="center">
          <Box gap={1}>
            <Text color={adnifyTheme.brandSoft} bold>
              {props.assistantName}
            </Text>
            <Text color={adnifyTheme.textDim}>
              {props.i18n.t('common.by')} {props.author}
            </Text>
          </Box>
          <Text color={adnifyTheme.textSecondary}>{props.tagline}</Text>
          <Box marginTop={1}>
            <Text color={adnifyTheme.textMuted}>{props.description}</Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={adnifyTheme.borderMuted}>{'─'.repeat(compact ? 36 : 68)}</Text>
      </Box>

      <Box
        width="100%"
        flexDirection={compact ? 'column' : 'row'}
        marginTop={1}
        gap={compact ? 1 : 4}
      >
        <Box flexDirection="column" flexGrow={1}>
          <Box justifyContent="space-between" alignItems="center" marginBottom={1}>
            <Text color={adnifyTheme.textDim}>{props.i18n.t('empty.panelSession')}</Text>
            <ModeBadge mode={props.mode} busy={props.busy} />
          </Box>

          <MetaRow label={props.i18n.t('header.meta.workspace')} value={props.workspaceName} />
          <MetaRow
            label={props.i18n.t('header.meta.package')}
            value={props.packageManager}
            color={adnifyTheme.brandSoft}
          />
          <MetaRow label={props.i18n.t('header.meta.git')} value={gitLabel} color={gitColor} />
          <MetaRow label="Model" value={props.modelLabel} color={adnifyTheme.textMuted} />
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          <Text color={adnifyTheme.brandSoft}>{props.i18n.t('empty.panelQuickStart')}</Text>
          {props.commands.slice(0, 4).map((command) => (
            <QuickCommandItem key={command} command={command} />
          ))}

          <Box marginTop={1} flexDirection="column">
          <RecentSessionsList
            sessions={props.recentSessions}
            currentSessionId={props.currentSessionId}
            i18n={props.i18n}
            layout="stack"
            limit={3}
          />
          </Box>
        </Box>
      </Box>

      <Box marginTop={1} justifyContent="center">
        <Text color={adnifyTheme.textDim}>{props.i18n.t('status.hintControls')}</Text>
      </Box>
    </Box>
  )
})
