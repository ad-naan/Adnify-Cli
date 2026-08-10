import { Box, Text, useStdout } from 'ink'
import { memo } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import type { PackageManagerName } from '../../../domain/workspace/entities/WorkspaceContext'
import { adnifyTheme } from '../theme'
import { ActivityPulse } from './ActivityPulse'
import { Wordmark } from './Wordmark'

export interface HeaderBarProps {
  appName: string
  author?: string
  tagline: string
  workspaceName: string
  packageManager?: PackageManagerName
  isGitRepository?: boolean
  mode: AssistantMode
  modelLabel: string
  busy?: boolean
  animateBrand?: boolean
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

function MetaPill(props: { label: string; value: string; color?: string }) {
  return (
    <Text>
      <Text color={adnifyTheme.textDim}>{props.label}</Text>
      <Text color={props.color ?? adnifyTheme.textSecondary}>{props.value}</Text>
    </Text>
  )
}

export const HeaderBar = memo(function HeaderBar(props: HeaderBarProps) {
  const { stdout } = useStdout()
  const compact = (stdout?.columns ?? 100) < 82
  const gitLabel = props.i18n.t(
    props.isGitRepository ? 'header.meta.gitTracked' : 'header.meta.gitDetached',
  )
  const gitColor = props.isGitRepository ? adnifyTheme.success : adnifyTheme.warm

  return (
    <Box width="100%" flexDirection="column" paddingX={1}>
      <Box width="100%" justifyContent="space-between" alignItems="flex-start">
        <Box flexDirection="column" flexGrow={1} marginRight={2}>
          <Wordmark
            appName={props.appName}
            author={props.author}
            tagline={props.tagline}
            busy={props.busy}
            animateMascot={props.animateBrand}
            i18n={props.i18n}
          />

          <Box gap={1} marginTop={1}>
            <ActivityPulse
              active={props.busy}
              animated={props.animateBrand}
              color={adnifyTheme.brandSoft}
              idleFrame="·  "
              variant="dots"
            />
            <MetaPill label={props.i18n.t('header.meta.workspace')} value={props.workspaceName} />
            {!compact && props.packageManager ? (
              <MetaPill
                label={props.i18n.t('header.meta.package')}
                value={props.packageManager}
                color={adnifyTheme.brandSoft}
              />
            ) : null}
            {!compact && props.isGitRepository !== undefined ? (
              <MetaPill label={props.i18n.t('header.meta.git')} value={gitLabel} color={gitColor} />
            ) : null}
            {!compact ? <Text color={adnifyTheme.borderMuted}>─</Text> : null}
            {!compact ? (
              <Text color={adnifyTheme.textDim}>{props.i18n.t('conversation.hintControls')}</Text>
            ) : null}
          </Box>
        </Box>

        <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
          <ModeBadge mode={props.mode} busy={props.busy} />
          <Text color={adnifyTheme.textMuted} wrap="truncate-end">
            {props.modelLabel}
          </Text>
        </Box>
      </Box>
      <Text color={props.busy ? adnifyTheme.borderActive : adnifyTheme.borderMuted}>
        {'─'.repeat(compact ? 28 : 48)}
      </Text>
    </Box>
  )
})
