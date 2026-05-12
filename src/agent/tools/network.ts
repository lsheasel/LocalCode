import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import * as os from 'os'
import { ToolResult } from '../../shared/types'
import { decodeContent } from './decoders'
import { getAppVersion } from '../../shared/version'

const execAsync = promisify(exec)
const appVersion = getAppVersion()
const userAgent = `Mozilla/5.0 (compatible; LocalCode/${appVersion})`

function findChrome(): string | null {
  const candidates = process.platform === 'win32' ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

export async function webFetchTool(url: string, format: string): Promise<ToolResult> {
  const isLocalPath = /^[A-Za-z]:[\\\/]/.test(url) || /^\/[^\s]/.test(url) || url.startsWith('file://')
  if (isLocalPath) {
    return { success: false, output: '', error: `"${url}" is a local path. Use read_file to read local files.` }
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, output: '', error: 'URL must start with http:// or https://' }
  }

  const chrome = findChrome()
  const tmpPng = join(os.tmpdir(), `localcode_web_${Date.now()}.png`)

  if (chrome) {
    try {
      const flags = [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--screenshot="${tmpPng}"`,
        '--window-size=1280,900',
        '--hide-scrollbars',
        `"${url}"`,
      ].join(' ')
      await execAsync(`"${chrome}" ${flags}`, { timeout: 20000 })

      const imgBuf = await readFile(tmpPng)
      const imgB64 = imgBuf.toString('base64')
      await unlink(tmpPng).catch(() => {})

      const { text } = await fetchPageContent(url, format)
      return {
        success: true,
        output: `[screenshot taken] ${url}\n\n${text.slice(0, 8000)}`,
        images: [imgB64],
      }
    } catch {
      await unlink(tmpPng).catch(() => {})
    }
  }

  try {
    const { text } = await fetchPageContent(url, format)
    return { success: true, output: `[no browser found — text only] ${url}\n\n${text.slice(0, 20000)}` }
  } catch (err) {
    return { success: false, output: '', error: friendlyFetchError(err, url) }
  }
}

function friendlyFetchError(err: unknown, url: string): string {
  const msg = String(err)
  const low = msg.toLowerCase()
  if (low.includes('timeout') || low.includes('timed out') || low.includes('abort')) {
    return `Request timed out after 15 s — ${url}\n  The server did not respond in time. Try again or use a different URL.`
  }
  if (low.includes('enotfound') || low.includes('getaddrinfo') || low.includes('dns')) {
    const host = (() => { try { return new URL(url).hostname } catch { return url } })()
    return `Cannot resolve host "${host}"\n  Check your internet connection or the URL spelling.`
  }
  if (low.includes('econnrefused')) {
    return `Connection refused — ${url}\n  The server is not accepting connections on that port.`
  }
  if (low.includes('econnreset') || low.includes('socket hang up')) {
    return `Connection was reset by the server — ${url}\n  The server closed the connection unexpectedly.`
  }
  if (low.includes('cert') || low.includes('ssl') || low.includes('tls')) {
    return `SSL/TLS certificate error — ${url}\n  The site's certificate is invalid or untrusted.`
  }
  if (low.includes('too many redirects') || low.includes('redirect')) {
    return `Too many redirects — ${url}\n  The server is redirecting in a loop.`
  }
  return `Failed to fetch ${url}\n  ${msg}`
}

async function fetchPageContent(url: string, format = 'text'): Promise<{ text: string; imageB64?: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok && res.status !== 304) {
    const body = await res.text().catch(() => '')
    const hint = body.slice(0, 200).trim()
    throw new Error(`HTTP ${res.status} ${res.statusText}${hint ? ` — ${hint}` : ''}`)
  }
  const contentType = res.headers.get('content-type') || ''

  if (contentType.startsWith('image/')) {
    const buf = await res.arrayBuffer()
    return { text: `[image: ${url}]`, imageB64: Buffer.from(buf).toString('base64') }
  }

  const raw = await res.text()

  // Explicit format overrides
  if (format === 'raw' || format === 'html') return { text: raw }
  if (format === 'json') {
    try { return { text: JSON.stringify(JSON.parse(raw), null, 2) } } catch {}
    return { text: raw }
  }
  if (format === 'xml') return { text: decodeContent(raw, '.xml') }
  if (format === 'csv') return { text: decodeContent(raw, '.csv') }

  // Auto-detect from content-type
  if (contentType.includes('application/json')) {
    try { return { text: JSON.stringify(JSON.parse(raw), null, 2) } } catch {}
  }
  if (contentType.includes('xml')) return { text: decodeContent(raw, '.xml') }
  if (contentType.includes('text/csv')) return { text: decodeContent(raw, '.csv') }

  // Default: strip HTML tags + decode entities
  return { text: decodeContent(raw, 'html') }
}

export async function httpRequestTool(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<ToolResult> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, output: '', error: 'URL must start with http:// or https://' }
  }
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
  const upperMethod = method.toUpperCase()
  if (!validMethods.includes(upperMethod)) {
    return { success: false, output: '', error: `http_request: invalid method "${method}" — use one of ${validMethods.join(', ')}` }
  }

  const init: RequestInit = {
    method: upperMethod,
    headers: { 'Content-Type': 'application/json', ...headers },
    signal: AbortSignal.timeout(15000),
  }
  if (body !== undefined && upperMethod !== 'GET' && upperMethod !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  try {
    const res = await fetch(url, init)
    const text = await res.text()
    let output: string
    try { output = JSON.stringify(JSON.parse(text), null, 2) } catch { output = text }
    return {
      success: res.ok,
      output: `HTTP ${res.status} ${res.statusText}\n\n${output.slice(0, 10000)}`,
      error: res.ok ? undefined : `HTTP ${res.status} ${res.statusText}`,
    }
  } catch (err) {
    return { success: false, output: '', error: friendlyFetchError(err, url) }
  }
}
