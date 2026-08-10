import { Box, Text, useStdout } from 'ink'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import { memo, useEffect, useMemo } from 'react'
import {
  parseCliTranscriptMarkup,
  type CliTranscriptTone,
} from '../../../application/support/CliTranscriptMarkup'
import type { ConversationMessage } from '../../../domain/session/entities/ConversationMessage'
import { adnifyTheme } from '../theme'
import { sliceVisibleRows } from '../hooks/viewportScrollMath'
import { ActivityPulse } from './ActivityPulse'
import { Panel } from './Panel'

export interface ConversationViewportProps {
  messages: ConversationMessage[]
  streamingText?: string
  viewportRows: number
  /** 距底部的行数偏移，0 表示跟随最新内容。 */
  scrollOffset?: number
  /** 报告内容总行数，让上层知道还能往上翻多少。 */
  onTotalRowsChange?: (totalRows: number) => void
  animateStreamingIndicator?: boolean
  i18n: AppI18n
}

interface TextViewportRow {
  kind: 'text'
  key: string
  content: string
  contentColor: string
  indent?: number
  prefix?: string
  prefixColor?: string
  backgroundColor?: string
  bold?: boolean
}

interface SpacerViewportRow {
  kind: 'spacer'
  key: string
}

interface StreamingHeaderViewportRow {
  kind: 'streaming-header'
  key: string
  label: string
}

type ViewportRow = TextViewportRow | SpacerViewportRow | StreamingHeaderViewportRow

const PANEL_HORIZONTAL_CHROME = 8
const MIN_CONTENT_WIDTH = 24

function resolveToneColor(tone: CliTranscriptTone): string {
  switch (tone) {
    case 'info':
      return adnifyTheme.info
    case 'success':
      return adnifyTheme.success
    case 'warning':
      return adnifyTheme.warm
    case 'danger':
      return adnifyTheme.danger
    default:
      return adnifyTheme.borderActive
  }
}

function getCharacterWidth(character: string): number {
  if (character === '\t') {
    return 2
  }

  const codePoint = character.codePointAt(0)
  if (!codePoint) {
    return 1
  }

  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  ) {
    return 2
  }

  return 1
}

function getDisplayWidth(content: string): number {
  let width = 0

  for (const character of content) {
    width += getCharacterWidth(character)
  }

  return width
}

function wrapContent(content: string, maxWidth: number): string[] {
  // 按终端显示宽度折行，尽量减少中英文混排时的高度跳动。
  const wrappedLines: string[] = []
  const normalizedLines = content.replace(/\r\n/g, '\n').split('\n')

  for (const line of normalizedLines) {
    const normalizedLine = line.replace(/\t/g, '  ')

    if (!normalizedLine) {
      wrappedLines.push('')
      continue
    }

    let currentLine = ''
    let currentWidth = 0

    for (const character of normalizedLine) {
      const characterWidth = getCharacterWidth(character)

      if (currentLine && currentWidth + characterWidth > maxWidth) {
        wrappedLines.push(currentLine)
        currentLine = character
        currentWidth = characterWidth
        continue
      }

      currentLine += character
      currentWidth += characterWidth
    }

    wrappedLines.push(currentLine || '')
  }

  return wrappedLines.length > 0 ? wrappedLines : ['']
}

function appendWrappedRows(
  rows: ViewportRow[],
  options: {
    keyPrefix: string
    content: string
    contentColor: string
    contentWidth: number
    indent?: number
    prefix?: string
    prefixColor?: string
    linePrefix?: string
    linePrefixColor?: string
  },
) {
  const baseIndent = options.indent ?? 0
  const prefixPadding = options.prefix ? getDisplayWidth(options.prefix) + 1 : 0
  const linePrefixPadding = options.linePrefix ? getDisplayWidth(options.linePrefix) + 1 : 0
  
  // Use the maximum padding required by either the first line prefix or subsequent line prefixes
  const maxPrefixPadding = Math.max(prefixPadding, linePrefixPadding)
  const availableContentWidth = Math.max(8, options.contentWidth - baseIndent - maxPrefixPadding)
  
  const lines = wrapContent(options.content, availableContentWidth)

  lines.forEach((line, index) => {
    rows.push({
      kind: 'text',
      key: `${options.keyPrefix}-${index}`,
      content: line || ' ',
      contentColor: options.contentColor,
      // Calculate indent carefully to ensure the text content aligns vertically
      indent: index === 0 
        ? baseIndent 
        : baseIndent + (prefixPadding - linePrefixPadding),
      prefix: index === 0 ? options.prefix : options.linePrefix,
      prefixColor: index === 0 ? options.prefixColor : options.linePrefixColor,
    })
  })
}

function appendMessageRows(
  rows: ViewportRow[],
  message: ConversationMessage,
  i18n: AppI18n,
  contentWidth: number,
) {
  const structured = parseCliTranscriptMarkup(message.content)

  if (structured) {
    switch (structured.kind) {
      case 'command-input':
        appendWrappedRows(rows, {
          keyPrefix: `${message.id}-command-input`,
          prefix: ':',
          prefixColor: adnifyTheme.brandStrong,
          content: structured.content.replace(/^[:/]/, ''),
          contentColor: adnifyTheme.brand,
          contentWidth,
        })
        return
      case 'command-output': {
        const accentColor = resolveToneColor(structured.tone)

        appendWrappedRows(rows, {
          keyPrefix: `${message.id}-command-output-title`,
          prefix: '>',
          prefixColor: accentColor,
          content: structured.title ?? i18n.t('conversation.output'),
          contentColor: accentColor,
          contentWidth,
        })
        appendWrappedRows(rows, {
          keyPrefix: `${message.id}-command-output-body`,
          prefix: '│',
          prefixColor: adnifyTheme.borderMuted,
          linePrefix: '│',
          linePrefixColor: adnifyTheme.borderMuted,
          content: structured.content,
          contentColor: adnifyTheme.textSecondary,
          contentWidth,
          indent: 2,
        })
        return
      }
      case 'notice': {
        const accentColor = resolveToneColor(structured.tone)

        appendWrappedRows(rows, {
          keyPrefix: `${message.id}-notice-title`,
          prefix: '~',
          prefixColor: accentColor,
          content: structured.title ?? i18n.t('conversation.notice'),
          contentColor: accentColor,
          contentWidth,
        })
        appendWrappedRows(rows, {
          keyPrefix: `${message.id}-notice-body`,
          prefix: '│',
          prefixColor: accentColor,
          linePrefix: '│',
          linePrefixColor: accentColor,
          content: structured.content,
          contentColor: adnifyTheme.textMuted,
          contentWidth,
          indent: 2,
        })
        return
      }
    }
  }

  switch (message.role) {
    case 'assistant':
      rows.push({
        kind: 'text',
        key: `${message.id}-assistant-header`,
        prefix: 'adnify',
        prefixColor: adnifyTheme.brand,
        content: i18n.t('conversation.response'),
        contentColor: adnifyTheme.textDim,
      })
      appendWrappedRows(rows, {
        keyPrefix: `${message.id}-assistant-body`,
        prefix: '│',
        prefixColor: adnifyTheme.borderActive,
        linePrefix: '│',
        linePrefixColor: adnifyTheme.borderActive,
        content: message.content,
        contentColor: adnifyTheme.textPrimary,
        contentWidth,
        indent: 1,
      })
      return
    case 'user':
      appendWrappedRows(rows, {
        keyPrefix: `${message.id}-user`,
        prefix: '❯',
        prefixColor: adnifyTheme.user,
        content: message.content,
        contentColor: adnifyTheme.textPrimary,
        contentWidth,
      })
      return
    case 'system':
    default:
      appendWrappedRows(rows, {
        keyPrefix: `${message.id}-system-title`,
        prefix: '*',
        prefixColor: adnifyTheme.textDim,
        content: i18n.t('conversation.notice'),
        contentColor: adnifyTheme.textSecondary,
        contentWidth,
      })
      appendWrappedRows(rows, {
        keyPrefix: `${message.id}-system-body`,
        prefix: '│',
        prefixColor: adnifyTheme.borderMuted,
        linePrefix: '│',
        linePrefixColor: adnifyTheme.borderMuted,
        content: message.content,
        contentColor: adnifyTheme.textMuted,
        contentWidth,
        indent: 2,
      })
  }
}

function buildMessageRows(
  messages: ConversationMessage[],
  i18n: AppI18n,
  contentWidth: number,
  hasStreaming: boolean,
): ViewportRow[] {
  const rows: ViewportRow[] = []

  messages.forEach((message, index) => {
    appendMessageRows(rows, message, i18n, contentWidth)

    if (index < messages.length - 1 || hasStreaming) {
      rows.push({ kind: 'spacer', key: `${message.id}-spacer` })
    }
  })

  return rows
}

function buildStreamingRows(
  streamingText: string,
  i18n: AppI18n,
  contentWidth: number,
): ViewportRow[] {
  if (!streamingText) return []

  const rows: ViewportRow[] = []
  rows.push({
    kind: 'streaming-header',
    key: 'streaming-header',
    label: i18n.t('conversation.thinking'),
  })
  appendWrappedRows(rows, {
    keyPrefix: 'streaming-body',
    content: streamingText,
    contentColor: adnifyTheme.textPrimary,
    contentWidth,
    indent: 2,
  })
  return rows
}

function renderViewportRow(row: ViewportRow, animateStreamingIndicator: boolean) {
  if (row.kind === 'spacer') {
    return <Text key={row.key}>{' '}</Text>
  }

  if (row.kind === 'streaming-header') {
    return (
      <Box key={row.key} width="100%" gap={1}>
        <Text color={adnifyTheme.brand} bold>adnify</Text>
        <ActivityPulse
          active
          animated={animateStreamingIndicator}
          color={adnifyTheme.brandSoft}
          idleFrame="·  "
          variant="dots"
        />
        <Text color={adnifyTheme.textDim}>{row.label}</Text>
      </Box>
    )
  }

  return (
    <Box key={row.key} width="100%" marginLeft={row.indent ?? 0} gap={1}>
      {row.prefix ? (
        <Text color={row.prefixColor ?? adnifyTheme.textSecondary}>{row.prefix}</Text>
      ) : null}
      <Text
        color={row.contentColor}
        backgroundColor={row.backgroundColor}
        bold={row.bold}
        wrap="truncate-end"
      >
        {row.content}
      </Text>
    </Box>
  )
}

/**
 * 内容超出视口时，顶部要占掉一行做提示条，正文只剩下面这么多。
 *
 * 滚动上限必须按这个高度算 —— 按整个视口高度算会差出一行，
 * 最顶上那行内容会永远翻不到。
 */
export function conversationBodyRows(viewportRows: number): number {
  return Math.max(1, viewportRows - 1)
}

/**
 * 顶部提示条：上面藏了多少行，以及是否已经落后于最新内容。
 *
 * 这一行是「内容被藏起来了」与「内容丢了」的唯一区别，所以宁可退化也不能不显示。
 * 窄终端放不下完整文案时退到短版本，只有连短版本都放不下才用裸省略号。
 */
function buildHiddenAboveLabel(
  hiddenAbove: number,
  hiddenBelow: number,
  contentWidth: number,
  i18n: AppI18n,
): string {
  // 往上翻之后新内容还在往下堆，不提示的话用户会以为界面卡住了。
  if (hiddenBelow > 0) {
    const scrolled = i18n.t('conversation.scrollPosition', {
      above: hiddenAbove,
      below: hiddenBelow,
    })
    if (scrolled.length <= contentWidth) {
      return scrolled
    }

    const shortScrolled = i18n.t('conversation.scrollPositionShort', {
      above: hiddenAbove,
      below: hiddenBelow,
    })
    return shortScrolled.length <= contentWidth ? shortScrolled : '…'
  }

  if (hiddenAbove <= 0) {
    return i18n.t('conversation.scrollTop')
  }

  const full = hiddenAbove === 1
    ? i18n.t('conversation.scrollHiddenOne')
    : i18n.t('conversation.scrollHidden', { count: hiddenAbove })
  if (full.length <= contentWidth) {
    return full
  }

  const short = i18n.t('conversation.scrollHiddenShort', { count: hiddenAbove })
  return short.length <= contentWidth ? short : '…'
}

export const ConversationViewport = memo(function ConversationViewport(
  props: ConversationViewportProps,
) {
  const { stdout } = useStdout()
  const terminalColumns = stdout?.columns ?? 80
  const contentWidth = useMemo(
    () => Math.max(MIN_CONTENT_WIDTH, terminalColumns - PANEL_HORIZONTAL_CHROME),
    [terminalColumns],
  )
  const messageRows = useMemo(
    () => buildMessageRows(props.messages, props.i18n, contentWidth, Boolean(props.streamingText)),
    [contentWidth, props.i18n, props.messages, props.streamingText],
  )
  const streamingRows = useMemo(
    () => buildStreamingRows(props.streamingText ?? '', props.i18n, contentWidth),
    [contentWidth, props.i18n, props.streamingText],
  )
  const viewportRows = useMemo(
    () => [...messageRows, ...streamingRows],
    [messageRows, streamingRows],
  )
  const scrollOffset = props.scrollOffset ?? 0

  // 行数是在这里才算出来的（依赖终端宽度和换行），上层要靠它决定能翻多远。
  const { onTotalRowsChange } = props
  useEffect(() => {
    onTotalRowsChange?.(viewportRows.length)
  }, [onTotalRowsChange, viewportRows.length])
  const visibleRows = useMemo(() => {
    // 只渲染当前这一屏。offset 从底部起算，0 就是贴着最新内容。
    if (viewportRows.length <= props.viewportRows) {
      return viewportRows
    }

    // 顶部留一行给提示条，告诉用户上面还藏着多少内容 ——
    // 会话区没有终端原生 scrollback，不说清楚就等同于内容凭空消失。
    const bodyRows = conversationBodyRows(props.viewportRows)
    const body = sliceVisibleRows(viewportRows, scrollOffset, bodyRows)
    const hiddenAbove = viewportRows.length - scrollOffset - body.length

    return [
      {
        kind: 'text',
        key: 'viewport-overflow-indicator',
        content: buildHiddenAboveLabel(hiddenAbove, scrollOffset, contentWidth, props.i18n),
        contentColor: adnifyTheme.textDim,
      } satisfies TextViewportRow,
      ...body,
    ]
  }, [contentWidth, props.i18n, props.viewportRows, scrollOffset, viewportRows])
  const fillerCount = Math.max(0, props.viewportRows - visibleRows.length)

  return (
    <Panel
      title={props.i18n.t('conversation.panelSession')}
      accent="muted"
    >
      <Box height={props.viewportRows} flexDirection="column" overflowY="hidden">
        {visibleRows.map((row) =>
          renderViewportRow(row, Boolean(props.animateStreamingIndicator)),
        )}
        {Array.from({ length: fillerCount }, (_, index) => (
          <Text key={`viewport-filler-${index}`}>{' '}</Text>
        ))}
      </Box>
    </Panel>
  )
})
