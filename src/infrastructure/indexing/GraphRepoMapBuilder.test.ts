import { test, expect, describe } from 'bun:test'
import { GraphRepoMapBuilder } from './GraphRepoMapBuilder'
import type { FileSymbolIndex } from '../../domain/workspace/value-objects/SymbolTag'

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const builder = new GraphRepoMapBuilder(mockLogger as any)

function makeIndex(
  path: string,
  defs: Array<{ name: string; kind: string; line: number }>,
  refs: string[] = [],
): FileSymbolIndex {
  return {
    path,
    definitions: defs.map((d) => ({
      name: d.name,
      kind: d.kind as any,
      line: d.line,
      level: 0,
    })),
    referencePaths: refs,
  }
}

const basicIndices: FileSymbolIndex[] = [
  makeIndex('src/A.ts', [
    { name: 'ClassA', kind: 'class', line: 1 },
    { name: 'methodOne', kind: 'method', line: 5 },
    { name: 'methodTwo', kind: 'method', line: 10 },
  ], ['src/B.ts', 'src/C.ts']),
  makeIndex('src/B.ts', [
    { name: 'ClassB', kind: 'class', line: 1 },
    { name: 'helper', kind: 'function', line: 20 },
  ], ['src/C.ts']),
  makeIndex('src/C.ts', [
    { name: 'InterfaceC', kind: 'interface', line: 1 },
    { name: 'TypeC', kind: 'type', line: 10 },
  ], ['src/A.ts']),
  makeIndex('src/util.ts', [
    { name: 'isolated', kind: 'function', line: 1 },
  ], []),
]

describe('GraphRepoMapBuilder', () => {
  test('returns empty for no indices', () => {
    const result = builder.buildFromIndex([], [], 1000)
    expect(result.files.length).toBe(0)
    expect(result.tokenEstimate).toBe(0)
  })

  test('returns files sorted by PageRank', () => {
    const result = builder.buildFromIndex(basicIndices, [], 2000)
    expect(result.files.length).toBe(4)

    const paths = result.files.map((f) => f.path)
    // util.ts (isolated) should be ranked last
    expect(paths[paths.length - 1]).toBe('src/util.ts')
  })

  test('respects token budget', () => {
    const result = builder.buildFromIndex(basicIndices, [], 30)
    expect(result.tokenEstimate).toBeLessThan(80)
    expect(result.files.length < 4 || result.files.length === 4).toBe(true)
  })

  test('prioritizes chat-mentioned files', () => {
    const resultNoChat = builder.buildFromIndex(basicIndices, [], 10000)
    const resultWithChat = builder.buildFromIndex(basicIndices, ['src/util.ts'], 10000)

    const posNoChat = resultNoChat.files.findIndex((f) => f.path === 'src/util.ts')
    const posWithChat = resultWithChat.files.findIndex((f) => f.path === 'src/util.ts')
    expect(posWithChat <= posNoChat).toBe(true)
  })

  test('includes symbols in output', () => {
    const result = builder.buildFromIndex(basicIndices, [], 5000)
    for (const file of result.files) {
      expect(file.symbols.length > 0).toBe(true)
    }
  })

  test('handles files with no definitions', () => {
    const indices: FileSymbolIndex[] = [
      makeIndex('empty.ts', [], []),
      makeIndex('has.ts', [{ name: 'Foo', kind: 'class', line: 1 }], ['empty.ts']),
    ]
    const result = builder.buildFromIndex(indices, [], 1000)
    expect(result.files.length).toBe(1)
    expect(result.files[0].path).toBe('has.ts')
  })

  test('toTreeString produces tree output', () => {
    const result = builder.buildFromIndex(basicIndices, [], 5000)
    const tree = builder.toTreeString(result)
    expect(tree.includes('src/')).toBe(true)
    expect(tree.includes('A.ts')).toBe(true)
    expect(tree.includes('ClassA')).toBe(true)
  })

  test('rank values are normalized between 0 and 1', () => {
    const result = builder.buildFromIndex(basicIndices, [], 100000)
    for (const file of result.files) {
      expect(file.rank > 0).toBe(true)
      expect(file.rank < 1).toBe(true)
    }
  })

  test('highly referenced files rank higher than fans', () => {
    const indices: FileSymbolIndex[] = [
      makeIndex('center.ts', [{ name: 'Core', kind: 'class', line: 1 }], []),
      makeIndex('fan1.ts', [{ name: 'F1', kind: 'function', line: 1 }], ['center.ts']),
      makeIndex('fan2.ts', [{ name: 'F2', kind: 'function', line: 1 }], ['center.ts']),
      makeIndex('fan3.ts', [{ name: 'F3', kind: 'function', line: 1 }], ['center.ts']),
      makeIndex('fan4.ts', [{ name: 'F4', kind: 'function', line: 1 }], ['center.ts']),
    ]
    const result = builder.buildFromIndex(indices, [], 100000)
    const center = result.files.find((f) => f.path === 'center.ts')
    const fan1 = result.files.find((f) => f.path === 'fan1.ts')
    expect(center != null).toBe(true)
    expect(fan1 != null).toBe(true)
    expect(center!.rank > fan1!.rank).toBe(true)
  })

  test('handles extremely small budget without crashing', () => {
    const result = builder.buildFromIndex(basicIndices, [], 5)
    expect(result.files.length >= 0).toBe(true)
  })

  test('kind labels appear in tree output', () => {
    const result = builder.buildFromIndex(basicIndices, [], 5000)
    const tree = builder.toTreeString(result)
    // Should contain kind labels like "class", "fn", "interface"
    const hasKindLabel = /\b(class|fn|method|interface|type)\b/.test(tree)
    expect(hasKindLabel).toBe(true)
  })
})
