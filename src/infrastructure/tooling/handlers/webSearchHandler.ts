import { parseJsonObject } from '../toolPathGuard'
import { toolFailure, toolSuccess, type ToolHandler } from './ToolHandler'

const SEARCH_TIMEOUT_MS = 15_000

interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Search the public web using DuckDuckGo's HTML endpoint (no API key required).
 * Falls back to a concise error message if the request fails.
 */
export const handleWebSearch: ToolHandler = async (request) => {
  const params = parseJsonObject(request.input)
  const query = typeof params.query === 'string' ? params.query.trim() : ''
  const maxResults =
    typeof params.limit === 'number' && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(10, Math.trunc(params.limit)))
      : 5

  if (!query) {
    return toolFailure(request.toolId, 'Missing required field "query". Example: {"query":"TypeScript generics tutorial"}')
  }

  try {
    const results = await searchDuckDuckGo(query, maxResults)

    if (results.length === 0) {
      return toolSuccess(
        request.toolId,
        `No web search results found for: "${query}"`,
      )
    }

    const formatted = results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`,
      )
      .join('\n\n')

    return toolSuccess(
      request.toolId,
      `Search results for "${query}" (${results.length} found):\n\n${formatted}`,
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return toolFailure(request.toolId, `Web search failed: ${msg}`)
  }
}

async function searchDuckDuckGo(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('search-timeout')), SEARCH_TIMEOUT_MS)

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Adnify-Cli/1.0 (terminal AI coding assistant)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const html = await response.text()
    return parseDuckDuckGoResults(html, maxResults)
  } finally {
    clearTimeout(timeout)
  }
}

function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []

  // DuckDuckGo HTML results have <a class="result__a" href="...">title</a>
  // and <a class="result__snippet">snippet</a>
  const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

  const links: Array<{ url: string; title: string }> = []
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkPattern.exec(html)) !== null) {
    const rawUrl = linkMatch[1] ?? ''
    const title = stripTags(linkMatch[2] ?? '').trim()
    // DuckDuckGo uses redirect URLs like //duckduckgo.com/l/?uddg=<encoded_url>
    const actualUrl = extractDdgUrl(rawUrl)
    if (title && actualUrl) {
      links.push({ url: actualUrl, title })
    }
  }

  const snippets: string[] = []
  let snippetMatch: RegExpExecArray | null
  while ((snippetMatch = snippetPattern.exec(html)) !== null) {
    snippets.push(stripTags(snippetMatch[1] ?? '').trim())
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? '',
    })
  }

  return results
}

function extractDdgUrl(rawUrl: string): string {
  // Handle DuckDuckGo's redirect format
  const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/)
  if (uddgMatch?.[1]) {
    try {
      return decodeURIComponent(uddgMatch[1])
    } catch {
      return rawUrl
    }
  }
  return rawUrl
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}
