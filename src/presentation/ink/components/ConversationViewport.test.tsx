import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { createAppI18n } from '../../../application/i18n/AppI18n'
import { createCliCommandOutputContent } from '../../../application/support/CliTranscriptMarkup'
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

    expect(output).toContain('more lines hidden')
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
    expect(output).not.toContain('more lines hidden')
  })
})
