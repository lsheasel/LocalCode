import { EventEmitter } from 'events'
import type { IPty } from 'node-pty'

export class PtyManager extends EventEmitter {
  private shell: IPty | null = null
  private _cwd: string
  private _alive = false

  constructor(cwd: string, shellBin?: string) {
    super()
    this._cwd = cwd
    const shellExe = shellBin || (
      process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'
    )

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pty = require('node-pty') as typeof import('node-pty')
      this.shell = pty.spawn(shellExe, [], {
        name: 'xterm-256color',
        cols: process.stdout.columns || 80,
        rows: 10,
        cwd,
        env: process.env as Record<string, string>,
      })
      this._alive = true
      this.shell.onData((data) => this.emit('data', data))
      this.shell.onExit(({ exitCode }) => {
        this._alive = false
        this.emit('exit', exitCode)
      })
    } catch {
      // PTY not available — graceful degradation
    }
  }

  write(data: string): void { this.shell?.write(data) }

  resize(cols: number, rows: number): void {
    try { this.shell?.resize(cols, rows) } catch {}
  }

  get cwd(): string { return this._cwd }
  isAlive(): boolean { return this._alive }

  kill(): void {
    try { this.shell?.kill() } catch {}
    this.shell = null
    this._alive = false
  }
}
