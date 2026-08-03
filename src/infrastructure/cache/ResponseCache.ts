/**
 * 轻量级 FNV-1a 哈希，不依赖 node:crypto，避免环境差异。
 */
function fnv1aHash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193

  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (byte + 0x9e), 0x100000001b3) >>> 0
  }

  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/**
 * 简单的 LRU 缓存条目。
 */
interface CacheEntry<V> {
  value: V
  expiresAt: number
  accessTick: number
}

/**
 * 轻量级 LRU 缓存，用于模型响应去重。
 *
 * 场景：Agent 多轮执行中，模型可能对同一组消息重复请求（例如工具被拒绝后重试）。
 * 缓存命中时不重新调用 API，直接返回之前的流式文本。
 *
 * 设计取舍：
 * - 只缓存非流式结果（完整文本），命中后模拟流式输出
 * - TTL 到期自动失效
 * - 容量上限防止内存膨胀
 */
export class ResponseCache<V = string> {
  private readonly store = new Map<string, CacheEntry<V>>()
  private tick = 0

  constructor(
    private readonly maxEntries = 64,
    private readonly defaultTtlMs = 5 * 60 * 1000,
  ) {}

  /**
   * 根据消息列表和模型参数生成缓存 key。
   * 取所有消息参与 hash，保证任何消息变化时 key 也变化。
   */
  static computeKey(
    messages: ReadonlyArray<{ role: string; content: string }>,
    model: string,
    temperature?: number,
    maxTokens?: number,
  ): string {
    const payload = JSON.stringify({
      m: messages.map((m) => ({ r: m.role, c: m.content })),
      model,
      t: temperature ?? -1,
      mt: maxTokens ?? -1,
    })
    return fnv1aHash(payload)
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key)
    if (!entry) {
      return undefined
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }

    entry.accessTick = ++this.tick
    return entry.value
  }

  set(key: string, value: V, ttlMs?: number): void {
    if (this.store.size >= this.maxEntries) {
      this.evictLRU()
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      accessTick: ++this.tick,
    })
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }

  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTick = Infinity

    for (const [key, entry] of this.store) {
      if (entry.accessTick < oldestTick) {
        oldestTick = entry.accessTick
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey)
    }
  }
}
