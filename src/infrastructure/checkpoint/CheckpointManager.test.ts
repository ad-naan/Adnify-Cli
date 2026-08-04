import { test, expect, describe } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { CheckpointManager } from './CheckpointManager'

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

function createTempManager(): { dir: string; manager: CheckpointManager } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-test-'))
  return { dir, manager: new CheckpointManager(dir, logger as any) }
}

function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

describe('CheckpointManager', () => {
  test('captureBeforeWrite reads existing file content', () => {
    const { dir, manager } = createTempManager()
    const filePath = path.join(dir, 'test.ts')
    fs.writeFileSync(filePath, 'original content', 'utf8')

    const id = manager.captureBeforeWrite('test.ts', 'write test.ts')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    cleanup(dir)
  })

  test('captureBeforeWrite handles non-existent file', () => {
    const { dir, manager } = createTempManager()
    const id = manager.captureBeforeWrite('nonexistent.ts', 'create new file')
    expect(typeof id).toBe('string')
    cleanup(dir)
  })

  test('commitSnapshot persists and listSnapshots returns it', () => {
    const { dir, manager } = createTempManager()
    const entry = {
      relativePath: 'test.ts',
      originalContent: 'Hello\nWorld',
      timestamp: Date.now(),
    }
    const id = manager.commitSnapshot([entry], 'file-ops write')
    const snapshots = manager.listSnapshots()
    expect(snapshots.length).toBe(1)
    expect(snapshots[0].id).toBe(id)
    expect(snapshots[0].entries[0].originalContent).toBe('Hello\nWorld')
    cleanup(dir)
  })

  test('restore reverts file to original content', () => {
    const { dir, manager } = createTempManager()
    const filePath = path.join(dir, 'test.ts')
    const original = 'original line 1\noriginal line 2'
    fs.writeFileSync(filePath, original, 'utf8')

    const id = manager.commitSnapshot(
      [{ relativePath: 'test.ts', originalContent: original, timestamp: Date.now() }],
      'write',
    )

    fs.writeFileSync(filePath, 'modified content', 'utf8')
    const restored = manager.restore(id)
    expect(restored).not.toBeNull()
    expect(restored!.length).toBe(1)
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original)
    cleanup(dir)
  })

  test('restore deletes file when originalContent is null', () => {
    const { dir, manager } = createTempManager()
    const filePath = path.join(dir, 'new-file.ts')
    fs.writeFileSync(filePath, 'newly created', 'utf8')

    const id = manager.commitSnapshot(
      [{ relativePath: 'new-file.ts', originalContent: null, timestamp: Date.now() }],
      'create',
    )

    const restored = manager.restore(id)
    expect(restored).not.toBeNull()
    expect(fs.existsSync(filePath)).toBe(false)
    cleanup(dir)
  })

  test('restore returns null for non-existent snapshot', () => {
    const { dir, manager } = createTempManager()
    expect(manager.restore('nonexistent-id')).toBeNull()
    cleanup(dir)
  })

  test('listSnapshots returns newest first', () => {
    const { dir, manager } = createTempManager()
    manager.commitSnapshot(
      [{ relativePath: 'a.ts', originalContent: 'a', timestamp: Date.now() }],
      'op1',
    )
    manager.commitSnapshot(
      [{ relativePath: 'b.ts', originalContent: 'b', timestamp: Date.now() + 1 }],
      'op2',
    )
    const snapshots = manager.listSnapshots()
    expect(snapshots.length).toBe(2)
    expect(snapshots[0].description).toBe('op2')
    cleanup(dir)
  })

  test('deleteSnapshot removes snapshot', () => {
    const { dir, manager } = createTempManager()
    const id = manager.commitSnapshot(
      [{ relativePath: 'a.ts', originalContent: 'a', timestamp: Date.now() }],
      'op1',
    )
    expect(manager.deleteSnapshot(id)).toBe(true)
    expect(manager.listSnapshots().length).toBe(0)
    cleanup(dir)
  })

  test('deleteSnapshot returns false for non-existent', () => {
    const { dir, manager } = createTempManager()
    expect(manager.deleteSnapshot('nonexistent')).toBe(false)
    cleanup(dir)
  })
})
