import { test, expect, describe } from 'bun:test'
import { StreamingToolCallParser } from './StreamingToolCallParser'

describe('StreamingToolCallParser', () => {
  test('streams regular text immediately', () => {
    const parser = new StreamingToolCallParser()
    const result1 = parser.push('Hello, ')
    const result2 = parser.push('world!')

    expect(result1.text).toBe('Hello, ')
    expect(result1.toolCallStarted).toBe(false)
    expect(result2.text).toBe('world!')

    const flush = parser.flush()
    expect(flush.text).toBe('')
    expect(flush.toolCall).toBeNull()
  })

  test('holds back partial opening tag prefix', () => {
    const parser = new StreamingToolCallParser()

    // "Hello <a" — the "<a" could be the start of "<adnify_tool_call"
    const result = parser.push('Hello <a')

    // "Hello " should be safe, "<a" should be held
    expect(result.text).toBe('Hello ')
    expect(result.toolCallStarted).toBe(false)

    // Stream more chars that confirm it's NOT a tool call
    const result2 = parser.push('pple')
    expect(result2.text).toBe('<apple')
  })

  test('detects tool call opening tag', () => {
    const parser = new StreamingToolCallParser()

    // Stream the opening tag piece by piece
    const r0 = parser.push('Here is the result: ')
    expect(r0.text).toBe('Here is the result: ')

    const r1 = parser.push('<adn')
    // "<adn" is a valid prefix of "<adnify_tool_call", so it gets held back
    expect(r1.text).toBe('')

    const r2 = parser.push('ify_tool_call name="file-ops">')
    // Opening tag completed → tool call mode entered
    expect(r2.toolCallStarted).toBe(true)

    // Flush without closing tag → parseToolCallMarkup returns null → emit as text
    const flush = parser.flush()
    expect(flush.toolCall).toBeNull()
    expect(flush.text).toContain('adnify_tool_call')
  })

  test('handles complete tool call in one push', () => {
    const parser = new StreamingToolCallParser()

    const markup = '<adnify_tool_call name="file-ops">{"action":"read","path":"src/main.ts"}</adnify_tool_call>'
    const result = parser.push(`Some text first ${markup}`)

    expect(result.text).toBe('Some text first ')
    expect(result.toolCallStarted).toBe(true)

    const flush = parser.flush()
    expect(flush.toolCall).not.toBeNull()
    expect(flush.toolCall!.name).toBe('file-ops')
    expect(flush.text).toBe('')
  })

  test('parses complete tool call across multiple pushes', () => {
    const parser = new StreamingToolCallParser()

    parser.push('Working on it...\n')
    parser.push('<adnify_tool_call name="shell-runner">')
    parser.push('{"argv":["rg","test","src"]}')
    parser.push('</adnify_tool_call>')

    const flush = parser.flush()
    expect(flush.toolCall).not.toBeNull()
    expect(flush.toolCall!.name).toBe('shell-runner')
    expect(flush.toolCall!.input).toBe('{"argv":["rg","test","src"]}')
  })

  test('flushes held buffer as text when not a tool call', () => {
    const parser = new StreamingToolCallParser()

    // "text <b" — "<b" isn't a prefix of "<adnify_tool_call" so it's emitted immediately
    const r1 = parser.push('text <b')
    expect(r1.text).toBe('text <b')

    // ">" is just text
    const r2 = parser.push('>')
    expect(r2.text).toBe('>')

    const flush = parser.flush()
    expect(flush.text).toBe('')
    expect(flush.toolCall).toBeNull()
  })

  test('does not hold back non-tag angle brackets', () => {
    const parser = new StreamingToolCallParser()
    const result = parser.push('Use <T> for generics')

    // "<T>" can't be a prefix of "<adnify_tool_call" after the T
    // But wait — "<" IS a prefix. "<T" is NOT a prefix of "<a...".
    // So after seeing "<T", the longest suffix overlap with "<adnify..." is 0.
    // Actually "<T" — checking: does "<adnify_tool_call" start with "<T"? No.
    // Does it start with "T"? No. So holdBack = 0.
    // But wait — after "<T", the buffer is "Use <T>". The suffix "<" appears at position 4.
    // No — we check suffix of the ENTIRE buffer. The longest suffix that is a prefix of OPENING_TAG.
    // "<" IS a prefix of "<adnify_tool_call". So "<" at the end won't be held because the last char is ">".
    // Suffix ">" — is "<adnify_tool_call" starting with ">"? No.
    // Suffix "T>" — No. Suffix "<T>" — No. So holdBack = 0. All text emitted.
    expect(result.text).toBe('Use <T> for generics')
  })

  test('handles multiple sequential uses with reset', () => {
    const parser = new StreamingToolCallParser()

    parser.push('<adnify_tool_call name="x">y</adnify_tool_call>')
    parser.flush()

    parser.reset()

    const result = parser.push('New text')
    expect(result.text).toBe('New text')
  })

  test('emits text before tool call when they appear in same push', () => {
    const parser = new StreamingToolCallParser()
    const result = parser.push('I will read the file now.\n<adnify_tool_call name="file-ops">{"action":"read"}</adnify_tool_call>')

    expect(result.text).toBe('I will read the file now.\n')
    expect(result.toolCallStarted).toBe(true)

    const flush = parser.flush()
    expect(flush.toolCall).not.toBeNull()
    expect(flush.toolCall!.name).toBe('file-ops')
  })

  test('handles malformed tool call gracefully', () => {
    const parser = new StreamingToolCallParser()

    // Opening tag but no content/closing tag
    parser.push('<adnify_tool_call name="broken">')
    const flush = parser.flush()

    // flush() will attempt to parse — since there's no closing tag,
    // parseToolCallMarkup returns null
    // We emit the raw buffer as text
    expect(flush.toolCall).toBeNull()
    expect(flush.text).toContain('adnify_tool_call')
  })

  test('holds back exactly the right amount for partial prefix', () => {
    const parser = new StreamingToolCallParser()

    // Only "<" — the minimum prefix
    const result = parser.push('abc<')
    // "abc" is safe, "<" is held
    expect(result.text).toBe('abc')

    // Next push confirms it's not a tool call start (starts with "a" instead of next expected char)
    const result2 = parser.push('p')
    // "<p" is not a prefix of "<adnify_tool_call", so "<p" is flushed
    expect(result2.text).toBe('<p')
  })
})
