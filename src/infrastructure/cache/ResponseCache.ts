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
 *
 * LRU 实现：利用 Map 的插入顺序特性——delete + re-insert 将条目移到末尾（MRU），
 * 首个条目即为 LRU，O(1) 逐出，无需遍历或额外 tick 计数器。
 */
export class ResponseCache<V = string> {
  private readonly store = new Map<string, CacheEntry<V>>()

  constructor(
    private readonly maxEntries = 64,
    private readonly defaultTtlMs = 5 * 60 * 1000,
  ) {}

  /**
   * 根据消息列表、模型参数和工具定义生成缓存 key。
   * 取所有消息和工具参与 hash，保证任何变化时 key 也变化。
   *
   * tools 必须纳入 hash：工具定义变更后仍命中旧缓存，会导致模型用错误的工具集
   * 产出过时响应（例如新增了 file-ops 但缓存重放的回答不含工具调用）。
   */
  static computeKey(
    messages: ReadonlyArray<{
      role: string
      content: string
      toolCalls?: unknown
      toolCallId?: string
      toolName?: string
      ok?: boolean
    }>,
    model: string,
    temperature?: number,
    maxTokens?: number,
    tools?: ReadonlyArray<{ name: string; [key: string]: unknown }>,
  ): string {
    const payload = JSON.stringify({
      m: messages.map((m) => ({
        r: m.role,
        c: m.content,
        tc: m.toolCalls,
        id: m.toolCallId,
        tn: m.toolName,
        ok: m.ok,
      })),
      model,
      t: temperature ?? -1,
      mt: maxTokens ?? -1,
      tl: tools?.map((t) => t.name).sort() ?? [],
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

    // Move to MRU position: delete then re-insert preserves Map insertion order
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value
  }

  set(key: string, value: V, ttlMs?: number): void {
    // If key already exists, delete first so re-insert places it at MRU position
    if (this.store.has(key)) {
      this.store.delete(key)
    } else if (this.store.size >= this.maxEntries) {
      this.evictLRU()
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    })
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }

  /**
   * O(1) eviction: Map iterates in insertion order, so the first entry is the LRU.
   */
  private evictLRU(): void {
    const oldestKey = this.store.keys().next().value
    if (oldestKey !== undefined) {
      this.store.delete(oldestKey)
    }
  }
}
