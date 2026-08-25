import { parseJsonObject } from '../toolPathGuard'
import { toolFailure, toolSuccess, type ToolHandler } from './ToolHandler'

const MAX_FETCH_CHARS = 20_000
const FETCH_TIMEOUT_MS = 20_000
/** 下载体积硬上限（字节）。无 content-length 时按流式累计强制截断，防止超大响应占满内存。 */
const MAX_FETCH_BYTES = 2 * 1024 * 1024

/** Fetch text-based web content from a URL. */
export const handleWebFetch: ToolHandler = async (request) => {
  const params = parseJsonObject(request.input)
  const url = typeof params.url === 'string' ? params.url.trim() : ''

  if (!url) {
    return toolFailure(request.toolId, 'Missing required field "url". Example: {"url":"https://example.com/docs"}')
  }

  if (!/^https?:\/\//i.test(url)) {
    return toolFailure(request.toolId, `Invalid URL "${url}". Must start with http:// or https://`)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('fetch-timeout')), FETCH_TIMEOUT_MS)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Adnify-Cli/1.0 (terminal AI coding assistant)',
        Accept: 'text/html, text/plain, application/json, */*',
      },
      redirect: 'follow',
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return toolFailure(
        request.toolId,
        `HTTP ${response.status} ${response.statusText} — ${url}`,
      )
    }

    const contentType = response.headers.get('content-type') ?? ''

    // 体积上限：声明的 content-length 超限直接拒绝；
    // 没有头（chunked/流式）则边读边累计，超限即中止下载。
    let body: string
    const declaredLength = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FETCH_BYTES) {
      return toolFailure(
        request.toolId,
        `Response too large: ${declaredLength} bytes exceeds the ${MAX_FETCH_BYTES} byte limit — ${url}`,
      )
    }

    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const chunks: string[] = []
      let received = 0
      let truncated = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_FETCH_BYTES) {
          await reader.cancel().catch(() => {})
          truncated = true
          break
        }
        chunks.push(decoder.decode(value, { stream: true }))
      }
      chunks.push(decoder.decode())
      body = chunks.join('')
      if (truncated) {
        body = `${body}\n\n[download truncated at ${MAX_FETCH_BYTES} bytes]`
      }
    } else {
      body = await response.text()
      if (body.length > MAX_FETCH_BYTES) {
        return toolFailure(
          request.toolId,
          `Response too large: ${body.length} bytes exceeds the ${MAX_FETCH_BYTES} byte limit — ${url}`,
        )
      }
    }

    // Strip HTML to text for readability
    let text: string
    if (contentType.includes('text/html')) {
      text = stripHtml(body)
    } else {
      text = body
    }

    if (text.length > MAX_FETCH_CHARS) {
      // 用 text.length 而不是 body.length：HTML 被 stripHtml 处理过之后，
      // body 是原始长度，拿它算省略量会算出一个和实际截断无关的数字。
      const omitted = text.length - MAX_FETCH_CHARS
      text = `${text.slice(0, MAX_FETCH_CHARS)}\n\n[truncated: ${omitted} of ${text.length} characters omitted]`
    }

    const meta = [
      `URL: ${url}`,
      `Status: ${response.status}`,
      `Content-Type: ${contentType || 'unknown'}`,
      `Length: ${body.length} chars`,
      '',
    ].join('\n')

    return toolSuccess(request.toolId, `${meta}${text}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('abort') || msg.includes('timeout')) {
      return toolFailure(request.toolId, `Fetch timed out after ${FETCH_TIMEOUT_MS}ms — ${url}`)
    }
    return toolFailure(request.toolId, `Fetch failed: ${msg}`)
  }
}

/** Minimal HTML-to-text conversion without external deps. */
function stripHtml(html: string): string {
  return html
    // Remove script/style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    // Convert block elements to newlines
    .replace(/<(?:p|div|section|article|li|h[1-6]|br|tr|td|th)[^>]*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
