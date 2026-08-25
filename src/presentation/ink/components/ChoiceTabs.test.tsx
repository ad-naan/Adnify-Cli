import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { ChoiceTabs } from './ChoiceTabs'
import { stripTerminalAnsi } from '../terminalText'

// 环境带 TTY 颜色支持时 renderToString 会输出 ANSI 色码;断言一律针对纯文本。
function renderPlainText(node: React.ReactNode, options?: { columns: number }): string {
  return stripTerminalAnsi(renderToString(node, options))
}

describe('ChoiceTabs', () => {
  test('renders compact options and marks the keyboard-selected row', () => {
    const output = renderPlainText(
      <ChoiceTabs
        items={[
          { id: 'manual', label: 'Manual', description: 'Ask every time' },
          { id: 'auto', label: 'Auto', description: 'High risk only' },
        ]}
        selectedIndex={1}
      />,
      { columns: 100 },
    )

    expect(output).toContain('○ Manual  Ask every time')
    expect(output).toContain('● Auto  High risk only')
  })

  test('windows long option lists around the selection', () => {
    const output = renderPlainText(
      <ChoiceTabs
        items={[
          { id: '4', label: 'Option 4', description: '' },
          { id: '5', label: 'Option 5', description: '' },
          { id: '6', label: 'Option 6', description: '' },
          { id: '7', label: 'Option 7', description: '' },
          { id: '8', label: 'Option 8', description: '' },
          { id: '9', label: 'Option 9', description: '' },
        ]}
        selectedIndex={3}
      />,
      { columns: 50 },
    )

    // 6 项、窗口 5、选中第 4 项(index 3)→ start = 3-2 = 1,居中显示 Option 5..9
    expect(output).toContain('↑ 1')
    expect(output).toContain('● Option 7')
    expect(output).toContain('Option 5')
    expect(output).toContain('Option 9')
    expect(output).not.toContain('Option 4')
    expect(output).not.toContain('Option 1')
  })
})
