import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, readdir, mkdir, rm, copyFile as fsCopyFile, rename, appendFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, join, dirname, normalize } from 'path'
import * as os from 'os'
import { ToolCall, ToolResult } from '../../shared/types'
import { lspCheck } from '../../lsp/LspRunner'
import { PluginLoader } from '../../plugins/PluginLoader'

const execAsync = promisify(exec)

// ── Chrome discovery ──────────────────────────────────────────────────────────
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

export async function executeTool(toolCall: ToolCall, cwd: string): Promise<ToolResult> {
  const { tool, arguments: args } = toolCall
  try {
    switch (tool) {
      // ── Shell ─────────────────────────────────────────────────────────────────
      case 'run_shell':
        return runShell(String(args.command || ''), String(args.cwd || cwd))

      // ── File system ───────────────────────────────────────────────────────────
      case 'read_file':
        return readFileTool(
          String(args.path || ''),
          cwd,
          args.start_line ? Number(args.start_line) : undefined,
          args.end_line   ? Number(args.end_line)   : undefined,
        )
      case 'write_file':
        return writeFileTool(String(args.path || ''), String(args.content || ''), cwd)
      case 'append_file':
        return appendFileTool(String(args.path || ''), String(args.content || ''), cwd)
      case 'edit_file':
        return editFileTool(String(args.path || ''), String(args.old || ''), String(args.new || ''), cwd)
      case 'delete_file':
        return deleteFileTool(String(args.path || ''), cwd, Boolean(args.recursive))
      case 'move_file':
        return moveFileTool(String(args.from || ''), String(args.to || ''), cwd)
      case 'copy_file':
        return copyFileTool(String(args.from || ''), String(args.to || ''), cwd)
      case 'create_dir':
        return createDirTool(String(args.path || ''), cwd)
      case 'list_files':
        return listFilesTool(String(args.path || '.'), cwd, Boolean(args.recursive))
      case 'find_files':
        return findFilesTool(String(args.pattern || ''), String(args.path || '.'), cwd)
      case 'search_files':
        return searchFilesTool(String(args.pattern || ''), String(args.path || '.'), cwd)

      // ── Git ───────────────────────────────────────────────────────────────────
      case 'git_status':
        return runShell('git status', cwd)
      case 'git_diff':
        return runShell(args.staged ? 'git diff --staged' : 'git diff', cwd)
      case 'git_log':
        return runShell(`git log --oneline -${Number(args.limit) || 20}`, cwd)
      case 'git_commit':
        return runShell(
          `git add -A && git commit -m ${JSON.stringify(String(args.message || 'chore: update'))}`,
          cwd
        )

      // ── Network ───────────────────────────────────────────────────────────────
      case 'web_fetch':
        return webFetchTool(String(args.url || ''), String(args.format || 'text'))
      case 'http_request':
        return httpRequestTool(
          String(args.method || 'GET'),
          String(args.url || ''),
          args.headers as Record<string,string> | undefined,
          args.body,
        )

      // ── LSP / Diagnostics ─────────────────────────────────────────────────────
      case 'lsp_check':
        return lspCheckTool(String(args.path || '.'), cwd)

      default: {
        const pluginTool = PluginLoader.getInstance().getTool(tool)
        if (pluginTool) return pluginTool.handler(args, { cwd })
        return { success: false, output: '', error: `Unknown tool: ${tool}` }
      }
    }
  } catch (err) {
    return { success: false, output: '', error: String(err) }
  }
}

function getShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  const s = process.env.SHELL || ''
  if (s && !/fish/.test(s)) return s
  return '/bin/bash'
}

// Normalize a path for use in the current platform's shell
function shellPath(p: string): string {
  if (process.platform === 'win32') return normalize(p).replace(/\//g, '\\')
  return p.replace(/\\/g, '/')
}

async function runShell(command: string, cwd: string): Promise<ToolResult> {
  const normalizedCwd = shellPath(cwd)
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: normalizedCwd,
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 10,
      shell: getShell(),
    })
    const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')
    return { success: true, output: output.trim() || '(no output)' }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return {
      success: false,
      output: e.stdout || '',
      error: e.stderr || e.message || String(err),
    }
  }
}

async function readFileTool(filePath: string, cwd: string, startLine?: number, endLine?: number): Promise<ToolResult> {
  const resolved = resolve(cwd, filePath)
  try {
    const content = await readFile(resolved, 'utf-8')
    const lines = content.split('\n')
    const total = lines.length
    const from = startLine ? Math.max(1, startLine) - 1 : 0
    const to   = endLine   ? Math.min(endLine, total)   : total
    const slice = lines.slice(from, to)
    const numbered = slice.map((l, i) => `${String(from + i + 1).padStart(5)} │ ${l}`).join('\n')
    const range = (from > 0 || to < total) ? `, showing lines ${from + 1}–${to}` : ''
    return { success: true, output: `// ${resolved}  (${total} lines total${range})\n${numbered}` }
  } catch (err) {
    return { success: false, output: '', error: `Cannot read "${filePath}": ${String(err)}` }
  }
}

async function writeFileTool(filePath: string, content: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, filePath)
  const dir = dirname(resolved)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(resolved, content, 'utf-8')
  return { success: true, output: `Written: ${resolved} (${content.length} chars, ${content.split('\n').length} lines)` }
}

async function editFileTool(filePath: string, oldStr: string, newStr: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, filePath)
  const content = await readFile(resolved, 'utf-8')
  if (!content.includes(oldStr)) {
    return { success: false, output: '', error: `Pattern not found in ${filePath}. Check for exact whitespace and line endings.` }
  }

  const idx = content.indexOf(oldStr)
  const startLine = content.slice(0, idx).split('\n').length
  const allLines = content.split('\n')
  const oldLines = oldStr.split('\n')
  const CONTEXT = 3
  const contextBefore = allLines.slice(Math.max(0, startLine - 1 - CONTEXT), startLine - 1)
  const contextAfter = allLines.slice(startLine - 1 + oldLines.length, startLine - 1 + oldLines.length + CONTEXT)

  await writeFile(resolved, content.replace(oldStr, newStr), 'utf-8')
  return {
    success: true,
    output: `Edited: ${resolved}`,
    meta: {
      diffPath: filePath,
      diffOld: oldLines,
      diffNew: newStr.split('\n'),
      diffStartLine: startLine,
      diffContextBefore: contextBefore,
      diffContextAfter: contextAfter,
    }
  }
}

async function listFilesTool(dirPath: string, cwd: string, recursive: boolean): Promise<ToolResult> {
  const resolved = resolve(cwd, dirPath)
  const SKIP = new Set([
    'node_modules', 'dist', '.git', '__pycache__', 'target', '.next', 'build',
    '.cache', '.npm', '.yarn', '.pnpm-store', 'venv', '.venv', '.env',
  ])
  const MAX_DEPTH = 4
  const MAX_ENTRIES = 300
  let totalEntries = 0

  async function listDir(dir: string, prefix = '', depth = 0): Promise<string[]> {
    if (depth > MAX_DEPTH || totalEntries >= MAX_ENTRIES) return []
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return [`${prefix}(permission denied)`]
    }
    const lines: string[] = []
    for (const entry of entries) {
      if (totalEntries >= MAX_ENTRIES) { lines.push(`${prefix}… (limit reached)`); break }
      const isDir = entry.isDirectory()
      if (SKIP.has(entry.name)) {
        if (isDir) lines.push(`${prefix}${entry.name}/ (skipped)`)
        continue
      }
      lines.push(`${prefix}${entry.name}${isDir ? '/' : ''}`)
      totalEntries++
      if (isDir && recursive && depth < MAX_DEPTH) {
        const sub = await listDir(join(dir, entry.name), `${prefix}  `, depth + 1)
        lines.push(...sub)
      }
    }
    return lines
  }

  const files = await listDir(resolved)
  return { success: true, output: files.join('\n') || '(empty directory)' }
}

async function searchFilesTool(pattern: string, searchPath: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, searchPath)
  const isWin = process.platform === 'win32'

  if (isWin) {
    const cmd = `findstr /s /n /i /r "${pattern}" "${resolved}\\*.ts" "${resolved}\\*.tsx" "${resolved}\\*.js" "${resolved}\\*.jsx" "${resolved}\\*.py" "${resolved}\\*.go" "${resolved}\\*.json" "${resolved}\\*.md" 2>nul`
    return runShell(cmd, cwd)
  }

  const includes = ['ts','tsx','js','jsx','py','go','rs','java','cs','cpp','c','h','json','yaml','yml','md']
    .map(e => `--include="*.${e}"`).join(' ')
  const cmd = `grep -rn ${includes} "${pattern}" "${resolved}" 2>/dev/null | head -60`
  return runShell(cmd, cwd)
}

async function appendFileTool(filePath: string, content: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, filePath)
  const dir = dirname(resolved)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await appendFile(resolved, content, 'utf-8')
  return { success: true, output: `Appended ${content.length} chars to ${resolved}` }
}

async function deleteFileTool(filePath: string, cwd: string, recursive: boolean): Promise<ToolResult> {
  const resolved = resolve(cwd, filePath)
  await rm(resolved, { recursive, force: true })
  return { success: true, output: `Deleted: ${resolved}` }
}

async function moveFileTool(from: string, to: string, cwd: string): Promise<ToolResult> {
  const src = resolve(cwd, from)
  const dst = resolve(cwd, to)
  const dir = dirname(dst)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await rename(src, dst)
  return { success: true, output: `Moved: ${src} → ${dst}` }
}

async function copyFileTool(from: string, to: string, cwd: string): Promise<ToolResult> {
  const src = resolve(cwd, from)
  const dst = resolve(cwd, to)
  const dir = dirname(dst)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await fsCopyFile(src, dst)
  return { success: true, output: `Copied: ${src} → ${dst}` }
}

async function createDirTool(dirPath: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, dirPath)
  await mkdir(resolved, { recursive: true })
  return { success: true, output: `Created directory: ${resolved}` }
}

async function findFilesTool(pattern: string, searchPath: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, searchPath)
  const isWin = process.platform === 'win32'
  const SKIP = new Set(['node_modules', '.git', 'dist', '__pycache__', '.next', 'build', 'target'])

  const results: string[] = []
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i'
  )

  async function walk(dir: string): Promise<void> {
    if (results.length >= 200) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (regex.test(entry.name)) {
        results.push(full)
      }
    }
  }

  await walk(resolved)
  return { success: true, output: results.join('\n') || 'No files found.' }
}

async function webFetchTool(url: string, format: string): Promise<ToolResult> {
  // Reject local file paths — they should be read with read_file, not web_fetch
  const isLocalPath = /^[A-Za-z]:[\\\/]/.test(url) || /^\/[^\s]/.test(url) || url.startsWith('file://')
  if (isLocalPath) {
    return { success: false, output: '', error: `"${url}" is a local path. Use read_file to read local files.` }
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, output: '', error: 'URL must start with http:// or https://' }
  }

  const chrome = findChrome()
  const tmpPng = join(os.tmpdir(), `localcode_web_${Date.now()}.png`)

  // ── Screenshot via headless Chrome ────────────────────────────────────────
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

      const imgBuf   = await readFile(tmpPng)
      const imgB64   = imgBuf.toString('base64')
      await unlink(tmpPng).catch(() => {})

      // Also get page text via fetch for context
      const { text } = await fetchPageText(url)
      return {
        success: true,
        output: `[screenshot taken] ${url}\n\n${text.slice(0, 8000)}`,
        images: [imgB64],
      }
    } catch {
      await unlink(tmpPng).catch(() => {})
      // Fall through to plain fetch
    }
  }

  // ── Fallback: plain fetch + HTML→text ─────────────────────────────────────
  const { text } = await fetchPageText(url)
  return { success: true, output: `[no browser found — text only] ${url}\n\n${text.slice(0, 20000)}` }
}

async function fetchPageText(url: string): Promise<{ text: string; imageB64?: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalCode/1.0)' },
    signal: AbortSignal.timeout(15000),
  })
  const contentType = res.headers.get('content-type') || ''

  // Image URL — return as base64 so the model can actually see it
  if (contentType.startsWith('image/')) {
    const buf = await res.arrayBuffer()
    return { text: `[image: ${url}]`, imageB64: Buffer.from(buf).toString('base64') }
  }

  const raw = await res.text()
  if (contentType.includes('application/json')) {
    try { return { text: JSON.stringify(JSON.parse(raw), null, 2) } } catch {}
  }
  return {
    text: raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}

async function httpRequestTool(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<ToolResult> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, output: '', error: 'URL must start with http:// or https://' }
  }

  const init: RequestInit = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json', ...headers },
    signal: AbortSignal.timeout(15000),
  }
  if (body !== undefined && method.toUpperCase() !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const res = await fetch(url, init)
  const text = await res.text()
  let output: string
  try { output = JSON.stringify(JSON.parse(text), null, 2) } catch { output = text }

  return {
    success: res.ok,
    output: `HTTP ${res.status} ${res.statusText}\n\n${output.slice(0, 10000)}`,
    error: res.ok ? undefined : `HTTP ${res.status}`,
  }
}

async function lspCheckTool(targetPath: string, cwd: string): Promise<ToolResult> {
  const resolved = targetPath === '.' ? undefined : resolve(cwd, targetPath)
  const { diagnostics, tool, error } = await lspCheck(cwd, resolved)

  if (error && diagnostics.length === 0) {
    return { success: false, output: '', error }
  }
  if (diagnostics.length === 0) {
    return { success: true, output: `✓ No issues found  (${tool})` }
  }

  const errors   = diagnostics.filter(d => d.severity === 'error').length
  const warnings = diagnostics.filter(d => d.severity === 'warning').length
  const lines = [
    `${tool}: ${errors} error${errors !== 1 ? 's' : ''}, ${warnings} warning${warnings !== 1 ? 's' : ''}`,
    '',
    ...diagnostics.slice(0, 60).map(d =>
      `${d.file}:${d.line}:${d.col}  ${d.severity}  ${d.message}${d.code ? `  [${d.code}]` : ''}`
    ),
  ]
  if (diagnostics.length > 60) lines.push(`… and ${diagnostics.length - 60} more`)

  return {
    success: errors === 0,
    output: lines.join('\n'),
    error: errors > 0 ? `${errors} error(s)` : undefined,
  }
}
