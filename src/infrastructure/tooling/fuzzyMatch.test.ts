import { describe, expect, test } from 'bun:test'
import { findTolerantMatch, reindentReplacement } from './fuzzyMatch'

describe('findTolerantMatch', () => {
  test('matches a block that differs only in trailing whitespace', () => {
    const content = 'const a = 1   \nconst b = 2\n'
    const result = findTolerantMatch(content, 'const a = 1\nconst b = 2')
    expect(result.strategy).toBe('trailing-whitespace')
    expect(result.matches).toHaveLength(1)
    const [m] = result.matches
    expect(content.slice(m.start, m.end)).toBe('const a = 1   \nconst b = 2')
  })

  test('matches a block that differs only in indentation', () => {
    const content = 'function f() {\n    return 42\n}\n'
    // model reproduced with 2-space indent instead of the file's 4 spaces
    const result = findTolerantMatch(content, '  return 42')
    expect(result.strategy).toBe('indentation')
    expect(result.matches).toHaveLength(1)
    const [m] = result.matches
    expect(content.slice(m.start, m.end)).toBe('    return 42')
  })

  test('tolerates CRLF line endings', () => {
    const content = 'line one\r\nline two\r\n'
    const result = findTolerantMatch(content, 'line one\nline two')
    expect(result.strategy).toBe('trailing-whitespace')
    expect(result.matches).toHaveLength(1)
  })

  test('reports every ambiguous match instead of guessing', () => {
    const content = '  foo()\n\n  foo()\n'
    const result = findTolerantMatch(content, 'foo()')
    expect(result.matches.length).toBeGreaterThan(1)
  })

  test('returns no match when the block is genuinely absent', () => {
    const content = 'const a = 1\n'
    const result = findTolerantMatch(content, 'const zzz = 9')
    expect(result.strategy).toBeNull()
    expect(result.matches).toHaveLength(0)
  })

  test('refuses to anchor on all-whitespace oldText', () => {
    const content = 'a\n\n\nb\n'
    const result = findTolerantMatch(content, '\n\n')
    expect(result.strategy).toBeNull()
  })
})

describe('reindentReplacement', () => {
  test('shifts newText to the matched block indentation', () => {
    // oldText used 2-space base, file/match uses 4-space base
    const out = reindentReplacement('  return 43', '  return 42', '    return 42')
    expect(out).toBe('    return 43')
  })

  test('preserves relative indentation across lines', () => {
    const newText = '  if (x) {\n    go()\n  }'
    const oldText = '  if (x) {\n    stop()\n  }'
    const matched = '        if (x) {\n          stop()\n        }'
    const out = reindentReplacement(newText, oldText, matched)
    expect(out).toBe('        if (x) {\n          go()\n        }')
  })

  test('leaves newText untouched when base indentation already matches', () => {
    const out = reindentReplacement('  b', '  a', '  a')
    expect(out).toBe('  b')
  })

  test('keeps blank lines blank', () => {
    const out = reindentReplacement('  a\n\n  b', '  a\n\n  b', '    a\n\n    b')
    expect(out).toBe('    a\n\n    b')
  })
})
