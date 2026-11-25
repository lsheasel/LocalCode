// Drives the built app (dist/localcode.js) in a real pseudo-terminal and
// mirrors its output into a headless xterm, so tests can read the screen the
// way a user would see it. Each session gets its own home directory, so the
// user's ~/.localcode is never touched.

import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawn, IPty } from 'node-pty'
import xterm from '@xterm/headless'

const { Terminal } = xterm
export const ROOT = resolve(__dirname, '..', '..')
const ENTRY = join(ROOT, 'dist', 'localcode.js')

export const KEY = {
  enter: '\r',
  altEnter: '\x1b\r',
  esc: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  ctrlC: '\x03',
  ctrlK: '\x0b',
  ctrlP: '\x10',
}

/** A fresh home with a config that points at a model server that isn't there. */
export function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'localcode-test-'))
  mkdirSync(join(home, '.localcode'), { recursive: true })
  writeFileSync(
    join(home, '.localcode', 'config.json'),
    JSON.stringify({
      llm: { provider: 'lmstudio', model: 'test-model', baseURL: 'http://127.0.0.1:9/v1' },
      theme: 'dark', fontSize: 14, trustedPaths: [], disabledPlugins: [], shell: 'powershell.exe',
      workspaceDir: home, security: { allowDangerousCommands: false, requireConfirmation: [] }, debugMode: false,
    }),
  )
  return home
}

export class Session {
  readonly term: InstanceType<typeof Terminal>
  private proc: IPty
  exited = false
  /** What the app put on the clipboard (OSC 52). */
  clipboard = ''

  constructor({ cols = 100, rows = 30, cwd = ROOT, home = makeHome(), args = [] as string[] } = {}) {
    this.term = new Terminal({ cols, rows, allowProposedApi: true })
    this.term.parser.registerOscHandler(52, (data) => {
      const b64 = data.split(';')[1] ?? ''
      this.clipboard = Buffer.from(b64, 'base64').toString('utf8')
      return true
    })
    this.proc = spawn(process.execPath, [ENTRY, ...args], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      // Never touch the real clipboard from a test.
      env: { ...process.env, USERPROFILE: home, HOME: home, FORCE_COLOR: '3', CI: '', LOCALCODE_NO_NATIVE_CLIPBOARD: '1' },
    })
    this.proc.onData((d) => this.term.write(d))
    this.proc.onExit(() => {
      this.exited = true
    })
  }

  wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
  }

  async type(text: string) {
    for (const ch of text) {
      this.proc.write(ch)
      await this.wait(10)
    }
  }

  key(seq: string) {
    this.proc.write(seq)
  }

  // ── Mouse (SGR reports, cells 0-based) ──
  move(x: number, y: number) {
    this.proc.write(`[<35;${x + 1};${y + 1}M`)
  }

  async click(x: number, y: number) {
    this.proc.write(`[<0;${x + 1};${y + 1}M`)
    await this.wait(30)
    this.proc.write(`[<0;${x + 1};${y + 1}m`)
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    this.proc.write(`[<0;${from.x + 1};${from.y + 1}M`)
    await this.wait(30)
    this.proc.write(`[<32;${to.x + 1};${to.y + 1}M`)
    await this.wait(60)
    this.proc.write(`[<0;${to.x + 1};${to.y + 1}m`)
  }

  /** Where `text` is on screen (its last occurrence), or null. */
  async find(text: string): Promise<{ x: number; y: number } | null> {
    const rows = await this.screen()
    for (let y = rows.length - 1; y >= 0; y--) {
      const x = rows[y].indexOf(text)
      if (x !== -1) return { x, y }
    }
    return null
  }

  resize(cols: number, rows: number) {
    this.proc.resize(cols, rows)
    this.term.resize(cols, rows)
  }

  /** The visible screen, one string per row. */
  async screen(): Promise<string[]> {
    await new Promise<void>((r) => this.term.write('', r))
    const buf = this.term.buffer.active
    const rows: string[] = []
    for (let y = 0; y < this.term.rows; y++) rows.push(buf.getLine(buf.baseY + y)?.translateToString(true) ?? '')
    return rows
  }

  async text(): Promise<string> {
    return (await this.screen()).join('\n')
  }

  /** Wait until `pred` holds for the screen text, or fail after `ms`. */
  async until(pred: (screen: string) => boolean, ms = 8000): Promise<string> {
    const t0 = Date.now()
    let last = ''
    while (Date.now() - t0 < ms) {
      last = await this.text()
      if (pred(last)) return last
      await this.wait(100)
    }
    throw new Error(`Timed out waiting for the screen. Last screen:\n${last}`)
  }

  async quit() {
    for (let i = 0; i < 3 && !this.exited; i++) {
      this.key(KEY.ctrlC)
      await this.wait(400)
    }
    try {
      this.proc.kill()
    } catch {}
  }
}
