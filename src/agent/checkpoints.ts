// Undo for the agent's file changes.
//
// Before a file tool touches a file, its current bytes are recorded (or the
// fact that it didn't exist yet). /undo restores the most recent change,
// /undo all every change of the most recent task. Shell commands are not
// covered — the agent's run_shell can change anything, which is exactly why
// those always ask first.

import { readFile, writeFile, rm, mkdir } from 'fs/promises'
import { existsSync, statSync } from 'fs'
import { dirname, relative, isAbsolute } from 'path'

interface Change {
  path: string
  /** File content before the change; null = the file did not exist. */
  before: Buffer | null
  task: number
}

export interface UndoneChange {
  path: string
  /** restored: old content written back; removed: the file was new, so deleted. */
  action: 'restored' | 'removed'
}

/** Keep memory bounded: the oldest changes fall off first. */
const MAX_CHANGES = 200
const MAX_FILE_BYTES = 5 * 1024 * 1024

class Checkpoints {
  private changes: Change[] = []
  private task = 0

  /** Start a new task — /undo all reverts back to here. */
  beginTask(): void {
    this.task++
  }

  /** Call before modifying `path`. Directories and huge files are skipped. */
  async record(path: string): Promise<void> {
    let before: Buffer | null = null
    if (existsSync(path)) {
      try {
        const st = statSync(path)
        if (!st.isFile() || st.size > MAX_FILE_BYTES) return
        before = await readFile(path)
      } catch {
        return
      }
    }
    this.changes.push({ path, before, task: this.task })
    if (this.changes.length > MAX_CHANGES) this.changes.shift()
  }

  get count(): number {
    return this.changes.length
  }

  private async revert(c: Change): Promise<UndoneChange> {
    if (c.before === null) {
      await rm(c.path, { force: true })
      return { path: c.path, action: 'removed' }
    }
    await mkdir(dirname(c.path), { recursive: true })
    await writeFile(c.path, c.before)
    return { path: c.path, action: 'restored' }
  }

  /** Revert the most recent change. */
  async undoLast(): Promise<UndoneChange[]> {
    const c = this.changes.pop()
    return c ? [await this.revert(c)] : []
  }

  /** Revert every change of the most recent task that made changes, newest first. */
  async undoTask(): Promise<UndoneChange[]> {
    const last = this.changes[this.changes.length - 1]
    if (!last) return []
    const done: UndoneChange[] = []
    while (this.changes.length && this.changes[this.changes.length - 1].task === last.task) {
      done.push(await this.revert(this.changes.pop()!))
    }
    // A file touched twice is reported once, with its final state.
    const seen = new Set<string>()
    return done.reverse().filter((d) => (seen.has(d.path) ? false : (seen.add(d.path), true))).reverse()
  }
}

export const checkpoints = new Checkpoints()

/** For messages: a path relative to `cwd` when it is inside it. */
export function displayPath(p: string, cwd: string): string {
  const rel = relative(cwd, p)
  return (rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : p).replace(/\\/g, '/')
}
