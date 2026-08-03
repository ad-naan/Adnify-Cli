import { parseJsonObject } from '../toolPathGuard'
import { toolFailure, toolSuccess, type ToolHandler } from './ToolHandler'

const MAX_FETCH_CHARS = 20_000
const FETCH_TIMEOUT_MS = 20_000

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
    const body = await response.text()

    // Strip HTML to text for readability
    let text: string
    if (contentType.includes('text/html')) {
      text = stripHtml(body)
    } else {
      text = body
    }

    if (text.length > MAX_FETCH_CHARS) {
      text = `${text.slice(0, MAX_FETCH_CHARS)}\n\n[... truncated, ${body.length - MAX_FETCH_CHARS} chars omitted]`
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
