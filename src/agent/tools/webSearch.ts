// web_search: real search results instead of guessed URLs. Uses DuckDuckGo's
// HTML endpoint, which needs no API key; the lite endpoint is the fallback
// when the first one answers with a block page.

import { ToolResult } from '../../shared/types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** DuckDuckGo wraps result links in a redirect: //duckduckgo.com/l/?uddg=<real url>. */
function realUrl(href: string): string {
  const h = href.replace(/&amp;/g, '&')
  const m = /[?&]uddg=([^&]+)/.exec(h)
  if (m) {
    try { return decodeURIComponent(m[1]) } catch {}
  }
  return h.startsWith('//') ? 'https:' + h : h
}

/** Results from the html.duckduckgo.com page. */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1)
  for (const b of blocks) {
    const a = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b)
    if (!a) continue
    const url = realUrl(a[1])
    // Ads link through duckduckgo.com/y.js — skip them.
    if (/duckduckgo\.com\/y\.js/.test(url)) continue
    const snip = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(b)
    hits.push({ title: decodeEntities(a[2]), url, snippet: snip ? decodeEntities(snip[1]) : '' })
  }
  return hits
}

/** Results from the lite.duckduckgo.com page (a plain table). */
export function parseDuckDuckGoLite(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const re = /<a[^>]+href="([^"]+)"[^>]+class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=class=['"]result-link['"]|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const snip = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/.exec(m[3])
    const url = realUrl(m[1])
    if (/duckduckgo\.com\/y\.js/.test(url)) continue
    hits.push({ title: decodeEntities(m[2]), url, snippet: snip ? decodeEntities(snip[1]) : '' })
  }
  return hits
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`search returned HTTP ${res.status}`)
  return res.text()
}

export async function searchWeb(query: string, limit = 8): Promise<SearchHit[]> {
  const q = encodeURIComponent(query)
  let hits: SearchHit[] = []
  try {
    hits = parseDuckDuckGoHtml(await get(`https://html.duckduckgo.com/html/?q=${q}`))
  } catch {}
  if (!hits.length) hits = parseDuckDuckGoLite(await get(`https://lite.duckduckgo.com/lite/?q=${q}`))
  // Same page listed twice (e.g. with and without a trailing slash) — keep one.
  const seen = new Set<string>()
  return hits
    .filter((h) => {
      const k = h.url.replace(/\/$/, '')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, limit)
}

export async function webSearchTool(query: string, limit?: number): Promise<ToolResult> {
  const q = query.trim()
  if (!q) return { success: false, output: '', error: 'web_search needs a "query".' }
  const n = Math.max(1, Math.min(20, Number(limit) || 8))
  try {
    const hits = await searchWeb(q, n)
    if (!hits.length) {
      return { success: true, output: `No results for "${q}". Try other or fewer words.` }
    }
    const lines = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`)
    return {
      success: true,
      output: `Results for "${q}":\n\n${lines.join('\n\n')}\n\nRead a page with web_fetch.`,
    }
  } catch (err) {
    return { success: false, output: '', error: `Web search failed: ${(err as Error).message}. Check the internet connection.` }
  }
}
