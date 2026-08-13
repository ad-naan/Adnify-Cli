import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { createAppI18n } from '../../../application/i18n/AppI18n'
import { createCliCommandOutputContent, createCliNoticeContent } from '../../../application/support/CliTranscriptMarkup'
import { ConversationMessage } from '../../../domain/session/entities/ConversationMessage'
import { ConversationViewport } from './ConversationViewport'

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
    const output = renderToString(
      <ConversationViewport messages={[userMessage]} busy viewportRows={12} i18n={i18n} />,
      { columns: 80 },
    )

    expect(output).toContain('please inspect the repository')
    expect(output).toContain('analyzing and working')
  })

  test('collapses verbose tool output in the regular conversation', () => {
    const output = renderToString(
      <ConversationViewport messages={[toolMessage]} viewportRows={12} i18n={i18n} />,
      { columns: 80 },
    )

    expect(output).toContain('✓ shell-runner 20ms · Ctrl+E expand')
    expect(output).toContain('more · Ctrl+E expand')
    expect(output).not.toContain('completed')
    expect(output).not.toContain('elapsed:')
    expect(output).not.toContain('line-4')
  })

  test('shows complete tool output in transcript mode', () => {
    const output = renderToString(
      <ConversationViewport
        messages={[toolMessage]}
        viewportRows={12}
        expandedDetails
        i18n={i18n}
      />,
      { columns: 80 },
    )

    expect(output).toContain('line-4')
    expect(output).toContain('Ctrl+E collapse')
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

    const compact = renderToString(
      <ConversationViewport messages={[call]} viewportRows={12} i18n={i18n} />,
      { columns: 80 },
    )
    const expanded = renderToString(
      <ConversationViewport messages={[call]} viewportRows={12} expandedDetails i18n={i18n} />,
      { columns: 80 },
    )

    expect(compact).toContain('› workspace-read')
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

    const output = renderToString(
      <ConversationViewport
        messages={[toolMessage, secondTool]}
        viewportRows={20}
        expandedToolMessageIds={['tool-output']}
        selectedToolMessageId="tool-output"
        i18n={i18n}
      />,
      { columns: 90 },
    )

    expect(output).toContain('› ✓ shell-runner 20ms · Ctrl+E collapse')
    expect(output).toContain('line-4')
    expect(output).toContain('✓ workspace-read 3ms · Ctrl+E expand')
    expect(output).not.toContain('other-4')
  })
})
