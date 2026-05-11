import React from 'react'
import { render } from 'ink'
import chalk from 'chalk'
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

// ── Alternate screen ───────────────────────────────────────────────────────
const useAltScreen = process.stdout.isTTY

function enterAltScreen(): void {
  if (!useAltScreen) return
  process.stdout.write(
    '\x1B[?1049h' + // enter alternate screen buffer
    '\x1B[2J'    + // clear screen
    '\x1B[3J'    + // clear scrollback
    '\x1B[H'     + // move cursor to top-left
    '\x1B[?1007h'  // alternate scroll: wheel → arrow keys, clicks NOT captured (text selection works)
  )
}

function exitAltScreen(): void {
  if (!useAltScreen) return
  process.stdout.write(
    '\x1B[?1007l' + // disable alternate scroll
    '\x1B[?1049l'   // exit alternate screen
  )
}

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
    exitOnCtrlC: false,
    patchConsole: true,
  }
)

waitUntilExit().then(() => {
  exitAltScreen()
  process.exit(0)
})
