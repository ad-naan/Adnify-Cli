import { Box, Text } from 'ink'
import { memo } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import { adnifyTheme } from '../theme'
import { ActivityPulse } from './ActivityPulse'
import type { CommandSuggestionItem } from './CommandSuggestionList'
import { CommandSuggestionList } from './CommandSuggestionList'
import { NativeInputLine } from './NativeInputLine'

export interface InputDockProps {
  value: string
  cursor: number
  busy: boolean
  animateBusyIndicator?: boolean
  mode: AssistantMode
  modelLabel: string
  configInitPrompt?: string
  toolApprovalPrompt?: string
  commandSuggestions: CommandSuggestionItem[]
  selectedSuggestionIndex: number
  isSuggestionOpen: boolean
  i18n: AppI18n
}

/** 提示块的两种语气：配置向导偏中性，工具审批偏警示。 */
type PromptTone = 'config' | 'approval'

function resolvePromptLineColor(line: string, tone: PromptTone): string {
  // 缩进两格的是明细行，顶格的是标题与操作说明，需要更强的对比。
  if (line.startsWith('  ')) {
    return tone === 'approval' ? adnifyTheme.textSecondary : adnifyTheme.info
  }

  if (line.toLowerCase().includes('error')) {
    return adnifyTheme.danger
  }

  return tone === 'approval' ? adnifyTheme.warm : adnifyTheme.textSecondary
}

interface PromptBlockProps {
  lines: string[]
  tone: PromptTone
  keyPrefix: string
}

function PromptBlock(props: PromptBlockProps) {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={props.tone === 'approval' ? adnifyTheme.borderWarm : adnifyTheme.borderMuted}
      paddingX={1}
    >
      {props.lines.map((line, index) => (
        <Text key={`${props.keyPrefix}-${index}`} color={resolvePromptLineColor(line, props.tone)}>
          {line || ' '}
        </Text>
      ))}
    </Box>
  )
}

export const InputDock = memo(function InputDock(props: InputDockProps) {
  // 审批优先于配置向导：它只在执行中途弹出，此时必须压住其他面板。
  const isApprovalActive = Boolean(props.toolApprovalPrompt)
  const isConfigActive = Boolean(props.configInitPrompt)
  const approvalPromptLines = props.toolApprovalPrompt?.split('\n') ?? []
  const configPromptLines = props.configInitPrompt?.split('\n') ?? []
  return (
    <Box
      width="100%"
      flexDirection="column"
      borderStyle="round"
      borderColor={isApprovalActive ? adnifyTheme.borderWarm : props.busy ? adnifyTheme.borderActive : adnifyTheme.borderMuted}
      paddingX={1}
    >
      {isApprovalActive ? (
        <PromptBlock lines={approvalPromptLines} tone="approval" keyPrefix="approval-prompt" />
      ) : isConfigActive ? (
        <PromptBlock lines={configPromptLines} tone="config" keyPrefix="config-prompt" />
      ) : null}

      <Box width="100%" gap={1} alignItems="center">
        <Text color={props.busy ? adnifyTheme.brandSoft : adnifyTheme.success} bold>
          {props.busy ? '◉' : '❯'}
        </Text>
        <NativeInputLine
          value={props.value}
          cursor={props.cursor}
          placeholder={props.i18n.t('input.placeholder')}
          active={!props.busy && !isApprovalActive}
        />
        {props.busy ? (
          <ActivityPulse
            active
            animated={Boolean(props.animateBusyIndicator)}
            color={adnifyTheme.brandSoft}
            idleFrame="·"
            variant="dots"
          />
        ) : null}
      </Box>

      {props.isSuggestionOpen ? (
        <Box flexDirection="column" marginTop={1}>
          <CommandSuggestionList
            items={props.commandSuggestions}
            selectedIndex={props.selectedSuggestionIndex}
          />
          <Box justifyContent="space-between">
            <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintSuggestions')}</Text>
            <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintDefault')}</Text>
          </Box>
        </Box>
      ) : isApprovalActive ? (
        <Text color={adnifyTheme.warm}>{props.i18n.t('approval.instruction')}</Text>
      ) : isConfigActive ? (
        <Text color={adnifyTheme.textDim}>{props.i18n.t('input.hintConfigInit')}</Text>
      ) : null}
    </Box>
  )
})
