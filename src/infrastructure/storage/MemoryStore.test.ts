import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppStorageSnapshot } from '../../application/dto/AppStorageSnapshot'
import { MemoryStore } from './MemoryStore'

async function withStore(run: (store: MemoryStore, dataRoot: string) => Promise<void>): Promise<void> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'adnify-memory-'))
  const storage: AppStorageSnapshot = {
    dataRoot,
    configPath: join(dataRoot, 'config.json'),
    sessionsDir: join(dataRoot, 'sessions'),
    source: 'default',
    isCustom: false,
  }

  try {
    await run(new MemoryStore(storage, join(dataRoot, 'workspace')), dataRoot)
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
}

describe('MemoryStore', () => {
  test('clear works before the cache has been loaded', async () => {
    await withStore(async (store) => {
      await store.clear()
      expect(await store.list()).toEqual([])
    })
  })

  test('rejects empty memories instead of persisting unusable prompt entries', async () => {
    await withStore(async (store) => {
      await expect(store.add('   ')).rejects.toThrow('cannot be empty')
      expect(await store.list()).toEqual([])
    })
  })

  test('list returns a copy so callers cannot mutate cached state without persistence', async () => {
    await withStore(async (store) => {
      await store.add('Uses Bun for verification')
      const listed = await store.list()
      listed.splice(0, listed.length)

      expect(await store.list()).toMatchObject([
        { content: 'Uses Bun for verification', scope: 'workspace' },
      ])
    })
  })
})
