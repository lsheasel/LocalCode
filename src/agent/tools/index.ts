import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { ToolCall, ToolResult } from '../../shared/types'

const execAsync = promisify(exec)

export async function executeTool(toolCall: ToolCall, cwd: string): Promise<ToolResult> {
  const { tool, arguments: args } = toolCall
  try {
    switch (tool) {
      case 'run_shell':
        return runShell(String(args.command || ''), String(args.cwd || cwd))
      case 'read_file':
        return readFileTool(String(args.path || ''), cwd)
      case 'write_file':
        return writeFileTool(String(args.path || ''), String(args.content || ''), cwd)
      case 'edit_file':
        return editFileTool(String(args.path || ''), String(args.old || ''), String(args.new || ''), cwd)
      case 'list_files':
        return listFilesTool(String(args.path || '.'), cwd, Boolean(args.recursive))
      case 'search_files':
        return searchFilesTool(String(args.pattern || ''), String(args.path || '.'), cwd)
      case 'git_status':
        return runShell('git status', cwd)
      case 'git_diff':
        return runShell(args.staged ? 'git diff --staged' : 'git diff', cwd)
      case 'git_commit':
        return runShell(
          `git add -A && git commit -m ${JSON.stringify(String(args.message || 'chore: update'))}`,
          cwd
        )
      default:
        return { success: false, output: '', error: `Unknown tool: ${tool}` }
    }
  } catch (err) {
    return { success: false, output: '', error: String(err) }
  }
}

async function runShell(command: string, cwd: string): Promise<ToolResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 10,
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

async function readFileTool(filePath: string, cwd: string): Promise<ToolResult> {
  const resolved = resolve(cwd, filePath)
  const content = await readFile(resolved, 'utf-8')
  const lines = content.split('\n')
  const numbered = lines.map((l, i) => `${String(i + 1).padStart(4)} │ ${l}`).join('\n')
  return { success: true, output: `// ${resolved}\n${numbered}` }
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
    'AppData', 'appdata', '.cache', 'cache', 'Cache', 'Temp', 'temp', 'tmp',
    'OneDrive', 'OneDriveConsumer', 'Pictures', 'Videos', 'Music',
    '.npm', '.yarn', '.pnpm-store', 'venv', '.venv', 'env',
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
  const cmd = isWin
    ? `findstr /s /n /i "${pattern}" "${resolved}\\*" 2>nul`
    : `grep -rn --include="*.{ts,tsx,js,jsx,py,go,rs,java,cs,cpp,c,h,json,yaml,yml,md}" "${pattern}" "${resolved}" 2>/dev/null | head -60`
  return runShell(cmd, cwd)
}
