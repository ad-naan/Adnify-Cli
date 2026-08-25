import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { TaskDock } from './TaskDock'
import { createAppI18n } from '../../../application/i18n/AppI18n'
import { stripTerminalAnsi } from '../terminalText'

const i18n = createAppI18n('en')

// 环境带 TTY 颜色支持时 renderToString 会输出 ANSI 色码;断言一律针对纯文本。
function renderPlainText(node: React.ReactNode, options?: { columns: number }): string {
  return stripTerminalAnsi(renderToString(node, options))
}

describe('TaskDock', () => {
  test('renders a single checklist with completed and running tasks', () => {
    const output = renderPlainText(
      <TaskDock i18n={i18n} tasks={[
        { id: '1', title: 'Inspect messages', status: 'completed' },
        { id: '2', title: 'Fix layout', status: 'running' },
      ]} />,
      { columns: 60 },
    )

    expect(output).toContain('Tasks 1/2')
    expect(output).toContain('✓ Inspect messages')
    expect(output).toContain('◉ Fix layout')
  })

  test('renders nothing after the controller clears a completed batch', () => {
    expect(renderToString(<TaskDock i18n={i18n} tasks={[]} />, { columns: 60 })).toBe('')
  })
})
