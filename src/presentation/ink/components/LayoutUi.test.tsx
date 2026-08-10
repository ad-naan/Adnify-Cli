import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { createAppI18n } from '../../../application/i18n/AppI18n'
import { EmptyState } from './EmptyState'
import { HeaderBar } from './HeaderBar'

const i18n = createAppI18n('zh-CN')

describe('framed CLI layout', () => {
  test('keeps the two-level brand header inside one border', () => {
    const output = renderToString(
      <HeaderBar
        appName="Adnify-Cli"
        author="Adnify Team"
        tagline="冷静执行，精准掌控你的代码库。"
        workspaceName="Adnify-Cli"
        packageManager="bun"
        isGitRepository
        mode="plan"
        modelLabel="openai-compatible / gpt-4o-mini"
        i18n={i18n}
      />,
      { columns: 120 },
    )

    expect(output).toContain('╭')
    expect(output).toContain('╰')
    expect(output).toContain('•ᴥ•')
    expect(output).toContain('PLAN')
  })

  test('contains empty-state content in a centered card', () => {
    const output = renderToString(
      <EmptyState
        assistantName="Adnify-Cli"
        author="Adnify Team"
        tagline="冷静执行，精准掌控你的代码库。"
        description="一位面向终端的 AI 编程搭档。"
        workspaceName="Adnify-Cli"
        packageManager="bun"
        isGitRepository
        mode="plan"
        modelLabel="openai-compatible / gpt-4o-mini"
        commands={[':help', ':mode agent', ':sessions']}
        currentSessionId="session-1"
        recentSessions={[]}
        i18n={i18n}
      />,
      { columns: 120 },
    )

    const nonEmptyLines = output.split('\n').filter((line) => line.trim())
    expect(output).toContain('快速开始')
    expect(output).toContain(':sessions')
    expect(nonEmptyLines.every((line) => line.length <= 120)).toBe(true)
  })
})
