import { Box, Text, useWindowSize } from 'ink'
import { memo } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import type { PackageManagerName } from '../../../domain/workspace/entities/WorkspaceContext'
import { adnifyTheme } from '../theme'
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

function modeColor(mode: AssistantMode): string {
  if (mode === 'agent') return adnifyTheme.brandStrong
  if (mode === 'plan') return adnifyTheme.warm
  return adnifyTheme.success
}

/** Two-level brand header contained by one quiet frame. */
export const HeaderBar = memo(function HeaderBar(props: HeaderBarProps) {
  const { columns } = useWindowSize()
  const showPackage = columns >= 74
  const showControls = columns >= 112
  const gitLabel = props.i18n.t(
    props.isGitRepository ? 'header.meta.gitTracked' : 'header.meta.gitDetached',
  )

  return (
    <Box
      width="100%"
      flexDirection="column"
      borderStyle="round"
      borderColor={props.busy ? adnifyTheme.borderActive : adnifyTheme.borderMuted}
      paddingX={1}
      flexShrink={0}
    >
      <Box width="100%" justifyContent="space-between" alignItems="flex-start">
        <Wordmark
          appName={props.appName}
          author={props.author}
          tagline={props.tagline}
          busy={props.busy}
          animateMascot={props.animateBrand}
          i18n={props.i18n}
        />
        <Box flexDirection="column" alignItems="flex-end" flexShrink={0} marginLeft={2}>
          <Text color={modeColor(props.mode)} bold>
            {props.busy ? '●' : '◇'} {props.mode.toUpperCase()}
          </Text>
          <Text color={adnifyTheme.textMuted} wrap="truncate-end">{props.modelLabel}</Text>
        </Box>
      </Box>

      <Box width="100%" justifyContent="space-between" marginTop={1}>
        <Box gap={1} minWidth={1}>
          <Text color={adnifyTheme.textDim}>{props.i18n.t('header.meta.workspace')}</Text>
          <Text color={adnifyTheme.textSecondary} wrap="truncate-middle">{props.workspaceName}</Text>
          {showPackage && props.packageManager ? (
            <>
              <Text color={adnifyTheme.borderMuted}>·</Text>
              <Text color={adnifyTheme.textDim}>{props.packageManager}</Text>
            </>
          ) : null}
          {showPackage && props.isGitRepository !== undefined ? (
            <>
              <Text color={adnifyTheme.borderMuted}>·</Text>
              <Text color={props.isGitRepository ? adnifyTheme.success : adnifyTheme.warm}>{gitLabel}</Text>
            </>
          ) : null}
        </Box>
        {showControls ? <Text color={adnifyTheme.textDim}>{props.i18n.t('conversation.hintControls')}</Text> : null}
      </Box>
    </Box>
  )
})
