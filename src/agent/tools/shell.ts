import { spawn } from 'child_process'
import { normalize } from 'path'
import { ToolResult } from '../../shared/types'

/** A command that runs longer than this is stopped. */
const TIMEOUT_MS = 60_000
/** Output kept for the result; the live view shows it as it arrives anyway. */
const MAX_OUTPUT_CHARS = 10 * 1024 * 1024

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

/**
 * Run `command` in the user's shell. `onOutput`, if given, receives stdout and
 * stderr as they arrive — that is what the live view under a running command
 * shows. The result has the same shape as before: stdout, plus stderr under a
 * "STDERR:" marker, or an error with the exit code.
 */
export function runShell(
  command: string,
  cwd: string,
  onOutput?: (chunk: string) => void,
): Promise<ToolResult> {
  if (!command.trim()) {
    return Promise.resolve({ success: false, output: '', error: 'run_shell: command is empty' })
  }
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (r: ToolResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, { cwd: shellPath(cwd), shell: getShell(), windowsHide: true })
    } catch (err) {
      finish({ success: false, output: '', error: `Could not start the shell: ${String(err)}` })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, TIMEOUT_MS)

    const take = (which: 'out' | 'err') => (data: Buffer) => {
      const text = data.toString('utf8')
      if (which === 'out') {
        if (stdout.length < MAX_OUTPUT_CHARS) stdout += text
      } else if (stderr.length < MAX_OUTPUT_CHARS) {
        stderr += text
      }
      onOutput?.(text)
    }
    child.stdout?.on('data', take('out'))
    child.stderr?.on('data', take('err'))

    child.on('error', (err) => {
      finish({ success: false, output: stdout.trim(), error: `Could not run the command: ${err.message}` })
    })

    child.on('close', (code) => {
      if (timedOut) {
        finish({
          success: false,
          output: stdout.trim(),
          error: `Command timed out after ${TIMEOUT_MS / 1000} s: ${command.slice(0, 80)}\n  Use a faster command or split it into smaller steps.`,
        })
        return
      }
      if (code === 0) {
        const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')
        finish({ success: true, output: output.trim() || '(no output)' })
        return
      }
      finish({
        success: false,
        output: stdout.trim(),
        error: stderr.trim() || `Command failed (exit code ${code})`,
      })
    })
  })
}
