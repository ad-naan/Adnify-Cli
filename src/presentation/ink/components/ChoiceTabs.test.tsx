import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { ChoiceTabs } from './ChoiceTabs'

describe('ChoiceTabs', () => {
  test('renders all options and marks the keyboard-selected tab', () => {
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

    expect(output).toContain('Manual · Ask every time')
    expect(output).toContain('› Auto · High risk only')
  })
})
