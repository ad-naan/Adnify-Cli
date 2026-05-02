import { Box, Text } from 'ink'
import { memo } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import { adnifyTheme } from '../theme'
import { ActivityPulse } from './ActivityPulse'
import type { CommandSuggestionItem } from './CommandSuggestionList'
import { CommandSuggestionList } from './CommandSuggestionList'
import { InputCursor } from './InputCursor'
import { Panel } from './Panel'

export interface InputDockProps {
  value: string
  busy: boolean
  animateBusyIndicator?: boolean
  mode: AssistantMode
  modelLabel: string
  configInitPrompt?: string
  approvalPrompt?: string
  commandSuggestions: CommandSuggestionItem[]
  selectedSuggestionIndex: number
  isSuggestionOpen: boolean
  i18n: AppI18n
}

export const InputDock = memo(function InputDock(props: InputDockProps) {
  const isConfigActive = Boolean(props.configInitPrompt)
  const isApprovalActive = Boolean(props.approvalPrompt)
  const configPromptLines = props.configInitPrompt?.split('\n') ?? []
  const approvalPromptLines = props.approvalPrompt?.split('\n') ?? []
  const panelSubtitle = props.isSuggestionOpen
    ? `${props.commandSuggestions.length} commands`
    : isApprovalActive
      ? approvalPromptLines[0] ?? props.modelLabel
      : props.modelLabel

  return (
    <Panel
      title={
        isApprovalActive
          ? props.i18n.t('input.panelApproval')
          : isConfigActive
          ? props.i18n.t('input.panelSetup')
          : props.isSuggestionOpen
            ? props.i18n.t('input.panelCommands')
            : props.i18n.t('input.panelConsole')
      }
      subtitle={panelSubtitle}
      accent={props.busy ? 'brand' : 'muted'}
    >
      <Box width="100%" justifyContent="space-between" alignItems="center">
        <Box gap={1} alignItems="center">
          <ActivityPulse
            active={props.busy}
            animated={Boolean(props.busy && props.animateBusyIndicator)}
            color={props.busy ? adnifyTheme.brandStrong : adnifyTheme.textDim}
            idleFrame=".. "
          />
          <Text color={adnifyTheme.textDim}>{props.i18n.t('input.labelInput')}</Text>
        </Box>

        <Box gap={1}>
          <Text color={adnifyTheme.textDim}>
            {isApprovalActive
              ? props.i18n.t('input.labelApprovalMode')
              : isConfigActive
                ? props.i18n.t('input.labelSetupMode')
                : props.mode}
          </Text>
          {props.isSuggestionOpen ? (
            <Text color={adnifyTheme.brand}>{props.i18n.t('input.labelPalette')}</Text>
          ) : null}
        </Box>
      </Box>

      {isApprovalActive ? (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={adnifyTheme.warm}
          paddingX={1}
        >
          {approvalPromptLines.map((line, index) => (
            <Text
              key={`approval-prompt-${index}`}
              color={index === 0 ? adnifyTheme.warm : adnifyTheme.textSecondary}
            >
              {line || ' '}
            </Text>
          ))}
        </Box>
      ) : isConfigActive ? (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={adnifyTheme.borderMuted}
          paddingX={1}
        >
          {configPromptLines.map((line, index) => (
            <Text
              key={`config-prompt-${index}`}
              color={
                line.startsWith('  ')
                  ? adnifyTheme.info
                  : line.toLowerCase().includes('error')
                    ? adnifyTheme.danger
                    : adnifyTheme.textSecondary
              }
            >
              {line || ' '}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1} paddingX={1}>
        <Box gap={1}>
          <Text color={props.busy ? adnifyTheme.brand : adnifyTheme.success}>{props.busy ? '⠋' : '❯'}</Text>
          {props.value ? (
            <Box>
              <Text color={adnifyTheme.textPrimary}>{props.value}</Text>
              <InputCursor visible={!props.busy} busy={props.busy} />
            </Box>
          ) : props.busy ? (
            <Text color={adnifyTheme.textDim}>{' '}</Text>
          ) : (
            <Box>
              <Text color={adnifyTheme.textDim}>{props.i18n.t('input.placeholder')}</Text>
              <InputCursor visible busy={props.busy} />
            </Box>
          )}
        </Box>
      </Box>

      {props.isSuggestionOpen ? (
        <Box flexDirection="column" marginTop={1}>
          <CommandSuggestionList
            items={props.commandSuggestions}
            selectedIndex={props.selectedSuggestionIndex}
          />
          <Box marginTop={1} justifyContent="space-between">
            <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintSuggestions')}</Text>
            <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintDefault')}</Text>
          </Box>
        </Box>
      ) : isApprovalActive ? (
        <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintApproval')}</Text>
      ) : isConfigActive ? (
        <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintConfigInit')}</Text>
      ) : !props.busy ? (
        <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintDefault')}</Text>
      ) : null}
    </Panel>
  )
})
