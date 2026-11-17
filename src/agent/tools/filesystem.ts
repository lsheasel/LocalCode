import { readFile, writeFile, readdir, mkdir, rm, copyFile as fsCopyFile, rename, appendFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, join, dirname, relative } from 'path'
import { ToolResult } from '../../shared/types'
import { decodeContent, hintFromPath } from './decoders'
import { planEdit } from './fuzzyEdit'
import { checkpoints } from '../checkpoints'

// Extensions that get auto-decoded (pretty-printed) even without an explicit format
const AUTO_DECODE_EXTS = new Set(['.json', '.jsonc'])

export async function readFileTool(
  filePath: string,
  cwd: string,
  startLine?: number,
  endLine?: number,
  format?: string,
): Promise<ToolResult> {
  const resolved = resolve(cwd, filePath)
  try {
    const rawContent = await readFile(resolved, 'utf-8')
    const hint = format || hintFromPath(filePath)
    const shouldDecode = !!format || AUTO_DECODE_EXTS.has(hint)
    const content = shouldDecode ? decodeContent(rawContent, hint) : rawContent

    const lines = content.split('\n')
    const total = lines.length
    const from = startLine ? Math.max(1, startLine) - 1 : 0
    const to   = endLine   ? Math.min(endLine, total)   : total
    const slice = lines.slice(from, to)
    const numbered = slice.map((l, i) => `${String(from + i + 1).padStart(5)} │ ${l}`).join('\n')
    const range   = (from > 0 || to < total) ? `, showing lines ${from + 1}–${to}` : ''
    const decoded = shouldDecode ? ` [decoded: ${hint}]` : ''
    return { success: true, output: `// ${resolved}  (${total} lines total${range}${decoded})\n${numbered}` }
  } catch (err) {
    return { success: false, output: '', error: `Cannot read "${filePath}": ${String(err)}` }
  }
}

export async function writeFileTool(filePath: string, content: string, cwd: string): Promise<ToolResult> {
  if (!filePath) return { success: false, output: '', error: 'write_file: path is required' }
  const resolved = resolve(cwd, filePath)
  try {
    const dir = dirname(resolved)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })

    const isNew = !existsSync(resolved)
    let oldContent = ''
    if (!isNew) {
      try { oldContent = await readFile(resolved, 'utf-8') } catch {}
    }

    await checkpoints.record(resolved)
    await writeFile(resolved, content, 'utf-8')

    // Build diff metadata so the UI can render a DiffView
    const meta = buildWriteDiff(filePath, oldContent, content, isNew)
    return { success: true, output: `Written: ${resolved}`, meta }
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('write', filePath, err) }
  }
}

/** Compute a simplified diff between old and new file content for display. */
function buildWriteDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  isNew: boolean,
): NonNullable<ToolResult['meta']> {
  const CONTEXT = 3
  const MAX_LINES = 60  // cap displayed lines for very large files

  if (isNew) {
    const newLines = newContent.split('\n')
    const shown = newLines.slice(0, MAX_LINES)
    return {
      diffPath: filePath,
      diffOld: [],
      diffNew: shown,
      diffStartLine: 1,
      diffContextBefore: [],
      diffContextAfter: [],
      diffIsNew: true,
    }
  }

  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // Find first differing line (from start)
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++
  }

  // Find first differing line (from end)
  let oldEnd = oldLines.length - 1
  let newEnd = newLines.length - 1
  while (oldEnd > start && newEnd > start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--
    newEnd--
  }

  const contextBefore = oldLines.slice(Math.max(0, start - CONTEXT), start)
  const contextAfter  = newLines.slice(newEnd + 1, newEnd + 1 + CONTEXT)

  return {
    diffPath: filePath,
    diffOld: oldLines.slice(start, oldEnd + 1),
    diffNew: newLines.slice(start, newEnd + 1),
    diffStartLine: start + 1,
    diffContextBefore: contextBefore,
    diffContextAfter: contextAfter,
    diffIsNew: false,
  }
}

export async function appendFileTool(filePath: string, content: string, cwd: string): Promise<ToolResult> {
  if (!filePath) return { success: false, output: '', error: 'append_file: path is required' }
  const resolved = resolve(cwd, filePath)
  try {
    const dir = dirname(resolved)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await checkpoints.record(resolved)
    await appendFile(resolved, content, 'utf-8')
    return { success: true, output: `Appended ${content.length} chars to ${resolved}` }
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('append', filePath, err) }
  }
}

export async function editFileTool(filePath: string, oldStr: string, newStr: string, cwd: string): Promise<ToolResult> {
  if (!filePath) return { success: false, output: '', error: 'edit_file: path is required' }
  if (!oldStr)   return { success: false, output: '', error: 'edit_file: "old" string is required' }
  const resolved = resolve(cwd, filePath)
  let content: string
  try {
    content = await readFile(resolved, 'utf-8')
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('read', filePath, err) }
  }
  const outcome = planEdit(content, oldStr, newStr)
  if (!outcome.ok) {
    const firstLine = oldStr.split('\n')[0].slice(0, 60)
    return {
      success: false, output: '',
      error: `edit_file: ${outcome.reason} in "${filePath}"\n  First line searched: ${firstLine}\n  Copy the exact lines from read_file (without the line numbers) and include enough context to be unique.`,
    }
  }
  const { plan } = outcome
  const allLines = content.split(/\r?\n/)
  const CONTEXT = 3
  const contextBefore = allLines.slice(Math.max(0, plan.startLine - 1 - CONTEXT), plan.startLine - 1)
  const contextAfter = allLines.slice(plan.startLine - 1 + plan.oldLines.length, plan.startLine - 1 + plan.oldLines.length + CONTEXT)

  try {
    await checkpoints.record(resolved)
    await writeFile(resolved, plan.content, 'utf-8')
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('write', filePath, err) }
  }
  const note = plan.strategy === 'exact' ? '' : ` (matched ignoring ${plan.strategy === 'indentation' ? 'indentation' : plan.strategy === 'trailing-space' ? 'trailing spaces' : 'line endings'})`
  return {
    success: true,
    output: `Edited: ${resolved}${note}`,
    meta: {
      diffPath: filePath,
      diffOld: plan.oldLines,
      diffNew: plan.newLines,
      diffStartLine: plan.startLine,
      diffContextBefore: contextBefore,
      diffContextAfter: contextAfter,
    },
  }
}

export async function deleteFileTool(filePath: string, cwd: string, recursive: boolean): Promise<ToolResult> {
  if (!filePath) return { success: false, output: '', error: 'delete_file: path is required' }
  const resolved = resolve(cwd, filePath)
  if (!existsSync(resolved)) return { success: false, output: '', error: `delete_file: "${filePath}" does not exist` }
  try {
    await checkpoints.record(resolved) // files only — a deleted folder can't be undone
    await rm(resolved, { recursive, force: true })
    return { success: true, output: `Deleted: ${resolved}` }
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('delete', filePath, err) }
  }
}

export async function moveFileTool(from: string, to: string, cwd: string): Promise<ToolResult> {
  if (!from || !to) return { success: false, output: '', error: 'move_file: both "from" and "to" are required' }
  const src = resolve(cwd, from)
  const dst = resolve(cwd, to)
  if (!existsSync(src)) return { success: false, output: '', error: `move_file: source "${from}" does not exist` }
  try {
    const dir = dirname(dst)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await checkpoints.record(src)
    await checkpoints.record(dst)
    await rename(src, dst)
    return { success: true, output: `Moved: ${src} → ${dst}` }
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('move', from, err) }
  }
}

export async function copyFileTool(from: string, to: string, cwd: string): Promise<ToolResult> {
  if (!from || !to) return { success: false, output: '', error: 'copy_file: both "from" and "to" are required' }
  const src = resolve(cwd, from)
  const dst = resolve(cwd, to)
  if (!existsSync(src)) return { success: false, output: '', error: `copy_file: source "${from}" does not exist` }
  try {
    const dir = dirname(dst)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await checkpoints.record(dst)
    await fsCopyFile(src, dst)
    return { success: true, output: `Copied: ${src} → ${dst}` }
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('copy', from, err) }
  }
}

export async function createDirTool(dirPath: string, cwd: string): Promise<ToolResult> {
  if (!dirPath) return { success: false, output: '', error: 'create_dir: path is required' }
  const resolved = resolve(cwd, dirPath)
  try {
    await mkdir(resolved, { recursive: true })
    return { success: true, output: `Created directory: ${resolved}` }
  } catch (err) {
    return { success: false, output: '', error: friendlyFsError('create directory', dirPath, err) }
  }
}

function friendlyFsError(op: string, path: string, err: unknown): string {
  const msg = String(err)
  const code = (err as NodeJS.ErrnoException).code
  switch (code) {
    case 'ENOENT':   return `${op} "${path}": file or directory not found`
    case 'EACCES':
    case 'EPERM':    return `${op} "${path}": permission denied`
    case 'EEXIST':   return `${op} "${path}": already exists`
    case 'EISDIR':   return `${op} "${path}": is a directory, not a file`
    case 'ENOTDIR':  return `${op} "${path}": path component is not a directory`
    case 'ENOTEMPTY':return `${op} "${path}": directory is not empty (use recursive: true to delete)`
    case 'EMFILE':
    case 'ENFILE':   return `${op} "${path}": too many open files — close some processes and retry`
    case 'ENOSPC':   return `${op} "${path}": disk is full`
    default:         return `${op} "${path}": ${msg}`
  }
}

export async function listFilesTool(dirPath: string, cwd: string, recursive: boolean): Promise<ToolResult> {
  const resolved = resolve(cwd, dirPath)
  const SKIP = new Set([
    'node_modules', 'dist', '.git', '__pycache__', 'target', '.next', 'build',
    '.cache', '.npm', '.yarn', '.pnpm-store', 'venv', '.venv', '.env',
  ])
  const MAX_DEPTH   = 4
  const MAX_ENTRIES = 300
  let totalEntries  = 0

  async function listDir(dir: string, prefix = '', depth = 0): Promise<string[]> {
    if (depth > MAX_DEPTH || totalEntries >= MAX_ENTRIES) return []
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) }
    catch { return [`${prefix}(permission denied)`] }
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

export async function findFilesTool(pattern: string, searchPath: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, searchPath)
  const SKIP = new Set(['node_modules', '.git', 'dist', '__pycache__', '.next', 'build', 'target'])
  const results: string[] = []
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i',
  )

  async function walk(dir: string): Promise<void> {
    if (results.length >= 200) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(full) }
      else if (regex.test(entry.name)) { results.push(full) }
    }
  }

  await walk(resolved)
  return { success: true, output: results.join('\n') || 'No files found.' }
}

/**
 * Search file contents for `pattern` (a regex, case-insensitive; falls back to
 * plain text if it isn't a valid regex). Done in-process rather than through
 * findstr/grep: the shell is PowerShell on Windows, where the old
 * `findstr … 2>nul` failed outright (`2>nul` means "write to a file called
 * nul" there), and shell output came back in the console's code page.
 */
export async function searchFilesTool(pattern: string, searchPath: string, cwd: string): Promise<ToolResult> {
  if (!pattern) return { success: false, output: '', error: 'search_files: pattern is empty' }
  const resolved = resolve(cwd, searchPath)
  const EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'cs', 'cpp', 'c', 'h',
    'json', 'yaml', 'yml', 'md', 'rb', 'php', 'kt', 'swift', 'html', 'css', 'scss', 'vue', 'svelte', 'toml', 'sh', 'ps1'])
  const SKIP = new Set(['node_modules', '.git', 'dist', '__pycache__', '.next', 'build', 'target'])
  const MAX_RESULTS = 60
  const MAX_FILE_BYTES = 1024 * 1024

  let regex: RegExp
  try {
    regex = new RegExp(pattern, 'i')
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }

  const results: string[] = []
  async function walk(dir: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      const ext = entry.name.includes('.') ? entry.name.split('.').pop()!.toLowerCase() : ''
      if (!EXTS.has(ext)) continue
      let text: string
      try {
        const buf = await readFile(full)
        if (buf.length > MAX_FILE_BYTES) continue
        text = buf.toString('utf8')
      } catch { continue }
      const lines = text.split(/\r?\n/)
      const rel = relative(cwd, full) || full
      for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
        if (regex.test(lines[i])) results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
      }
    }
  }

  await walk(resolved)
  if (results.length === 0) return { success: true, output: `No matches for "${pattern}".` }
  const more = results.length >= MAX_RESULTS ? `\n(stopped after ${MAX_RESULTS} matches — narrow the pattern or path)` : ''
  return { success: true, output: results.join('\n') + more }
}
