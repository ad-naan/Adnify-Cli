import { test, expect } from 'bun:test'
import { ResponseCache } from './ResponseCache'

test('get returns undefined for missing key', () => {
  const cache = new ResponseCache<string>()
  expect(cache.get('missing')).toBeUndefined()
})

test('set then get returns the value', () => {
  const cache = new ResponseCache<string>()
  cache.set('key1', 'hello')
  expect(cache.get('key1')).toBe('hello')
})

test('TTL expiry invalidates entries', () => {
  const cache = new ResponseCache<string>(10, 50)
  cache.set('key1', 'value', 10)
  expect(cache.get('key1')).toBe('value')

  // After TTL expiry it should be gone
  const start = Date.now()
  while (Date.now() - start < 20) {
    // busy-wait 20ms
  }
  expect(cache.get('key1')).toBeUndefined()
})

test('LRU eviction removes the least recently accessed entry', () => {
  const cache = new ResponseCache<string>(3)
  cache.set('a', '1')
  cache.set('b', '2')
  cache.set('c', '3')

  // Access 'a' to make it most recently used
  expect(cache.get('a')).toBe('1')

  // Insert 'd' — should evict 'b' (LRU)
  cache.set('d', '4')

  expect(cache.get('b')).toBeUndefined()
  expect(cache.get('a')).toBe('1')
  expect(cache.get('c')).toBe('3')
  expect(cache.get('d')).toBe('4')
  expect(cache.size).toBe(3)
})

test('clear removes all entries', () => {
  const cache = new ResponseCache<string>()
  cache.set('x', '1')
  cache.set('y', '2')
  cache.clear()
  expect(cache.size).toBe(0)
  expect(cache.get('x')).toBeUndefined()
})

test('computeKey produces deterministic keys', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ]
  const key1 = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096)
  const key2 = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096)
  expect(key1).toBe(key2)
  expect(key1.length).toBe(16)
})

test('computeKey differs when content changes', () => {
  const messages1 = [{ role: 'user', content: 'hello' }]
  const messages2 = [{ role: 'user', content: 'world' }]
  const key1 = ResponseCache.computeKey(messages1, 'gpt-4')
  const key2 = ResponseCache.computeKey(messages2, 'gpt-4')
  expect(key1).not.toBe(key2)
})

test('computeKey differs when model changes', () => {
  const messages = [{ role: 'user', content: 'hello' }]
  const key1 = ResponseCache.computeKey(messages, 'gpt-4')
  const key2 = ResponseCache.computeKey(messages, 'claude-3')
  expect(key1).not.toBe(key2)
})

test('computeKey differs when tools change', () => {
  const messages = [{ role: 'user', content: 'hello' }]
  const toolsA = [{ name: 'file-ops' }, { name: 'shell-runner' }]
  const toolsB = [{ name: 'file-ops' }, { name: 'web-search' }]
  const key1 = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096, toolsA)
  const key2 = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096, toolsB)
  expect(key1).not.toBe(key2)
})

test('computeKey same when tools are same but order differs', () => {
  const messages = [{ role: 'user', content: 'hello' }]
  const toolsA = [{ name: 'file-ops' }, { name: 'shell-runner' }]
  const toolsB = [{ name: 'shell-runner' }, { name: 'file-ops' }]
  const key1 = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096, toolsA)
  const key2 = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096, toolsB)
  expect(key1).toBe(key2)
})

test('computeKey differs when tools added or removed', () => {
  const messages = [{ role: 'user', content: 'hello' }]
  const toolsA = [{ name: 'file-ops' }, { name: 'shell-runner' }]
  const toolsB = [{ name: 'file-ops' }]
  const keyNoTools = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096)
  const keyTwoTools = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096, toolsA)
  const keyOneTool = ResponseCache.computeKey(messages, 'gpt-4', 0.7, 4096, toolsB)
  expect(keyNoTools).not.toBe(keyTwoTools)
  expect(keyTwoTools).not.toBe(keyOneTool)
  expect(keyNoTools).not.toBe(keyOneTool)
})

test('overwrite updates value for same key', () => {
  const cache = new ResponseCache<string>()
  cache.set('k', 'old')
  cache.set('k', 'new')
  expect(cache.get('k')).toBe('new')
  expect(cache.size).toBe(1)
})
