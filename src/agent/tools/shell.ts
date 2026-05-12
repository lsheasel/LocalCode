import { exec } from 'child_process'
import { promisify } from 'util'
import { normalize } from 'path'
import { ToolResult } from '../../shared/types'

const execAsync = promisify(exec)

export function getShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  const s = process.env.SHELL || ''
  if (s && !/fish/.test(s)) return s
  return '/bin/bash'
}

export function shellPath(p: string): string {
  if (process.platform === 'win32') return normalize(p).replace(/\//g, '\\')
  return p.replace(/\\/g, '/')
}

export async function runShell(command: string, cwd: string): Promise<ToolResult> {
  if (!command.trim()) return { success: false, output: '', error: 'run_shell: command is empty' }
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
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number | string; killed?: boolean }
    if (e.killed || String(e.message).includes('ETIMEDOUT') || String(e.message).includes('timed out')) {
      return {
        success: false,
        output: e.stdout?.trim() || '',
        error: `Command timed out after 60 s: ${command.slice(0, 80)}\n  Use a faster command or split it into smaller steps.`,
      }
    }
    const stderr = (e.stderr || '').trim()
    const stdout = (e.stdout || '').trim()
    const code   = e.code !== undefined ? ` (exit code ${e.code})` : ''
    return {
      success: false,
      output: stdout,
      error: stderr || e.message || `Command failed${code}`,
    }
  }
}
