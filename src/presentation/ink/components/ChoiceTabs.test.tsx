import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { ChoiceTabs } from './ChoiceTabs'

describe('ChoiceTabs', () => {
  test('renders compact options and marks the keyboard-selected row', () => {
    const output = renderToString(
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
    const output = renderToString(
      <ChoiceTabs
        items={Array.from({ length: 9 }, (_, index) => ({ id: `${index}`, label: `Option ${index + 1}` }))}
        selectedIndex={6}
      />,
      { columns: 50 },
    )

    expect(output).toContain('↑ 4')
    expect(output).toContain('● Option 7')
    expect(output).not.toContain('Option 1')
  })
})
