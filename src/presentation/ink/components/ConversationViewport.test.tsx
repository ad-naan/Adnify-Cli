import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { createAppI18n } from '../../../application/i18n/AppI18n'
import { createCliCommandOutputContent, createCliNoticeContent } from '../../../application/support/CliTranscriptMarkup'
import { ConversationMessage } from '../../../domain/session/entities/ConversationMessage'
import { ConversationViewport } from './ConversationViewport'
import { stripTerminalAnsi } from '../terminalText'

// 环境带 TTY 颜色支持时 renderToString 会输出 ANSI 色码;断言一律针对纯文本。
function renderPlainText(node: React.ReactNode, options?: { columns: number }): string {
  return stripTerminalAnsi(renderToString(node, options))
}

const i18n = createAppI18n('en')
const toolMessage = new ConversationMessage({
  id: 'tool-output',
  role: 'system',
  createdAt: new Date('2026-08-10T00:00:00.000Z'),
  content: createCliCommandOutputContent(
    ['completed', 'elapsed: 20ms', 'line-1', 'line-2', 'line-3', 'line-4'].join('\n'),
    { title: 'tools · shell-runner', tone: 'success' },
  ),
})

describe('ConversationViewport detail levels', () => {
  test('shows an execution indicator before the first streaming token', () => {
    const userMessage = new ConversationMessage({
      id: 'user-pending',
      role: 'user',
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      content: 'please inspect the repository',
    })
    const output = renderPlainText(
      <ConversationViewport messages={[userMessage]} busy viewportRows={12} i18n={i18n} />,
      { columns: 80 },
    )

    expect(output).toContain('please inspect the repository')
    expect(output).toContain('analyzing and working')
  })

  test('collapses verbose tool output in the regular conversation', () => {
    const output = renderPlainText(
      <ConversationViewport messages={[toolMessage]} viewportRows={12} i18n={i18n} />,
      { columns: 80 },
    )

    expect(output).toContain('▸ shell-runner 20ms · 4 lines')
    expect(output).not.toContain('completed')
    expect(output).not.toContain('elapsed:')
    expect(output).not.toContain('line-4')
  })

  test('shows complete tool output in transcript mode', () => {
    const output = renderPlainText(
      <ConversationViewport
        messages={[toolMessage]}
        viewportRows={12}
        expandedDetails
        i18n={i18n}
      />,
      { columns: 80 },
    )

    expect(output).toContain('line-4')
    expect(output).toContain('▾ shell-runner 20ms · 4 lines')
    expect(output).not.toContain('more lines hidden')
  })

  test('keeps tool input compact until details are expanded', () => {
    const call = new ConversationMessage({
      id: 'tool-call',
      role: 'system',
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      content: createCliNoticeContent(
        'Executing request.\ntool: workspace-read\ninput: {"depth":2}',
        { title: 'tools · workspace-read', tone: 'info' },
      ),
    })

    const compact = renderPlainText(
      <ConversationViewport messages={[call]} viewportRows={12} i18n={i18n} />,
      { columns: 80 },
    )
    const expanded = renderPlainText(
      <ConversationViewport messages={[call]} viewportRows={12} expandedDetails i18n={i18n} />,
      { columns: 80 },
    )

    expect(compact).toContain('▸ workspace-read')
    expect(compact).not.toContain('"depth"')
    expect(expanded).toContain('input: {"depth":2}')
  })

  test('expands and selects only the requested tool message', () => {
    const secondTool = new ConversationMessage({
      id: 'second-tool',
      role: 'system',
      createdAt: new Date('2026-08-10T00:00:01.000Z'),
      content: createCliCommandOutputContent(
        ['completed', 'elapsed: 3ms', 'other-1', 'other-2', 'other-3', 'other-4'].join('\n'),
        { title: 'tools · workspace-read', tone: 'success' },
      ),
    })

    const output = renderPlainText(
      <ConversationViewport
        messages={[toolMessage, secondTool]}
        viewportRows={20}
        expandedToolMessageIds={['tool-output']}
        selectedToolMessageId="tool-output"
        i18n={i18n}
      />,
      { columns: 90 },
    )

    expect(output).toContain('▾ shell-runner 20ms · 4 lines')
    expect(output).toContain('line-4')
    expect(output).toContain('▸ workspace-read 3ms · 4 lines')
    expect(output).not.toContain('other-4')
  })

  test('renders assistant messages without repeated brand labels or tree rails', () => {
    const assistant = new ConversationMessage({
      id: 'assistant',
      role: 'assistant',
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      content: 'First line\nSecond line',
    })
    const output = renderPlainText(
      <ConversationViewport messages={[assistant]} viewportRows={6} i18n={i18n} />,
      { columns: 80 },
    )

    expect(output).toContain('First line')
    expect(output).toContain('Second line')
    expect(output).not.toContain('otter')
    expect(output).not.toContain('│ First line')
  })

  test('merges a completed tool request and result into one visual row', () => {
    const call = new ConversationMessage({
      id: 'call', role: 'system', createdAt: new Date(),
      content: createCliNoticeContent('tool: shell-runner\ninput: {}', { title: 'tools · shell-runner', tone: 'info' }),
    })
    const output = renderPlainText(
      <ConversationViewport messages={[call, toolMessage]} viewportRows={8} i18n={i18n} />,
      { columns: 80 },
    )

    expect(output.match(/shell-runner/g)).toHaveLength(1)
    expect(output).not.toContain('○')
  })

  test('renders basic markdown without leaking source markers', () => {
    const assistant = new ConversationMessage({
      id: 'markdown', role: 'assistant', createdAt: new Date(),
      content: '## Project\n\nThis is **important**.\n\n> **Your terminal.**',
    })
    const output = renderPlainText(
      <ConversationViewport messages={[assistant]} viewportRows={10} i18n={i18n} />,
      { columns: 80 },
    )

    expect(output).toContain('Project')
    expect(output).toContain('This is important.')
    expect(output).toContain('│ Your terminal.')
    expect(output).not.toContain('##')
    expect(output).not.toContain('**')
  })
})
