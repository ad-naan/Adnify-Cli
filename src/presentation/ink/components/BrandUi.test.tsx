import { describe, expect, test } from 'bun:test'
import { renderToString } from 'ink'
import { terminalTextWidth } from '../terminalText'
import { MascotGlyph } from './MascotGlyph'

describe('otter brand UI', () => {
  test('renders a compact otter with whiskers and a waterline', () => {
    const output = renderToString(<MascotGlyph />, { columns: 24 })

    expect(output).toContain('•ᴥ•')
    expect(output).toContain('≈╰┬╯≈')
  })

  test('keeps every large mascot frame within a narrow terminal', () => {
    const output = renderToString(<MascotGlyph large />, { columns: 24 })
    const lines = output.split('\n')

    expect(lines).toHaveLength(5)
    expect(lines.every((line) => terminalTextWidth(line) <= 24)).toBe(true)
    expect(output).toContain('ᴥ')
    expect(output).toContain('≈≈')
  })
})
