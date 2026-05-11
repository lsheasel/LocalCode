import React from 'react'
import { render } from 'ink'
import chalk from 'chalk'
import { Transform, TransformCallback } from 'stream'
import { App } from '../app'
import { ConfigManager } from '../config/ConfigManager'

const args = process.argv.slice(2)
const cwd = process.cwd()

// ── Flags ──────────────────────────────────────────────────────────────────
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`
${chalk.bold.blue('⚡ LocalCode')} ${chalk.gray('v0.1.0')} ${chalk.gray('— Futuristic AI Developer Terminal')}

${chalk.bold('Usage:')}
  ${chalk.blue('localcode')}                        Start interactive TUI
  ${chalk.blue('localcode')} <task>                 Run AI task directly
  ${chalk.blue('localcode')} --provider <p>         Override LLM provider
  ${chalk.blue('localcode')} --model <m>            Override model
  ${chalk.blue('localcode')} --help                 Show this help

${chalk.bold('Examples:')}
  ${chalk.gray('localcode')}
  ${chalk.gray('localcode fix auth bug')}
  ${chalk.gray('localcode --provider ollama --model llama3 fix typescript errors')}
  ${chalk.gray('localcode --provider openai --model gpt-4o create REST API')}

${chalk.bold('Providers:')}  ollama · openai · claude · openrouter · lmstudio

${chalk.bold('Config:')}  ~/.localcode/config.json
`)
  process.exit(0)
}

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write('0.1.0\n')
  process.exit(0)
}

// ── Parse --provider / --model flags ──────────────────────────────────────
let remaining = [...args]

function extractFlag(flag: string): string | undefined {
  const idx = remaining.indexOf(flag)
  if (idx === -1) return undefined
  const val = remaining[idx + 1]
  remaining.splice(idx, 2)
  return val
}

const provider = extractFlag('--provider')
const model = extractFlag('--model')

if (provider || model) {
  ConfigManager.getInstance().setLLM({
    ...(provider && { provider: provider as any }),
    ...(model && { model }),
  })
}

const initialCommand = remaining.length > 0 ? remaining.join(' ') : undefined

// ── Alternate screen: take over the terminal completely ────────────────────
// Like vim/htop — clears the screen, restores on exit
const useAltScreen = process.stdout.isTTY

function enterAltScreen(): void {
  if (!useAltScreen) return
  process.stdout.write(
    '\x1B[?1049h'       + // enter alternate screen buffer
    '\x1B[2J'           + // clear screen
    '\x1B[3J'           + // clear scrollback
    '\x1B[H'            + // move cursor to top-left
    '\x1B[?1000h'       + // enable mouse button tracking
    '\x1B[?1006h'         // enable SGR extended mouse coordinates
  )
}

function exitAltScreen(): void {
  if (!useAltScreen) return
  process.stdout.write(
    '\x1B[?1006l'  + // disable SGR mouse
    '\x1B[?1000l'  + // disable mouse tracking
    '\x1B[?1049l'    // exit alternate screen
  )
}

// ── Mouse-filtering stdin proxy ────────────────────────────────────────────
// SGR mouse tracking sends \x1b[<btn;col;rowM sequences. readline doesn't
// recognise them — it consumes the ESC separately and emits the rest as text,
// which leaks into the input field. We filter at the raw byte level (before
// readline sees anything) by piping stdin through a Transform that:
//   • scroll-wheel up  (btn 64) → \x1b[5~ (PageUp)
//   • scroll-wheel down (btn 65) → \x1b[6~ (PageDown)
//   • all other mouse events     → dropped

class MouseFilterStream extends Transform {
  readonly isTTY: boolean | undefined

  constructor() {
    super()
    this.isTTY = process.stdin.isTTY
  }

  setRawMode(mode: boolean): this {
    (process.stdin as NodeJS.ReadStream).setRawMode?.(mode)
    return this
  }

  ref(): this   { (process.stdin as any).ref?.();   return this }
  unref(): this { (process.stdin as any).unref?.(); return this }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    // Work in binary (Latin-1) so single-byte ops don't mangle multi-byte chars
    const str      = chunk.toString('binary')
    const filtered = str.replace(/\x1b\[<(\d+);\d+;\d+[Mm]/g, (_, btnStr: string) => {
      const btn = parseInt(btnStr, 10)
      if (btn === 64) return '\x1b[5~'  // scroll up   → PageUp
      if (btn === 65) return '\x1b[6~'  // scroll down → PageDown
      return ''                          // discard other mouse events
    })
    if (filtered.length > 0) this.push(Buffer.from(filtered, 'binary'))
    cb()
  }
}

const stdinProxy = new MouseFilterStream()
process.stdin.pipe(stdinProxy)

// Restore terminal on any unexpected exit
process.on('exit', exitAltScreen)
process.on('SIGINT', () => { exitAltScreen(); process.exit(0) })
process.on('SIGTERM', () => { exitAltScreen(); process.exit(0) })
process.on('uncaughtException', () => { exitAltScreen(); process.exit(1) })

enterAltScreen()

// ── Launch Ink app ─────────────────────────────────────────────────────────
const { waitUntilExit } = render(
  React.createElement(App, { initialCommand, cwd }),
  {
    stdin: stdinProxy as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    patchConsole: true,
  }
)

waitUntilExit().then(() => {
  exitAltScreen()
  process.exit(0)
})
