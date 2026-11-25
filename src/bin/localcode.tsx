import React from 'react'
import { render } from 'ink'
import chalk from 'chalk'
import { format } from 'util'
import { createFullscreen, createMouseInput, attachPointer } from '../shared/screen'
import { pointerClick, pointerMove, getPanes } from '../shared/mouse'
import { setAnimations } from '../shared/anim'
import { prefs } from '../shared/settings'
import { App } from '../app'
import { ConfigManager } from '../config/ConfigManager'
import { discordPresence } from '../discord/DiscordPresence'
import { getAppVersion } from '../shared/version'
import { loadPlugins } from '../plugins/loader.js'
import { globalRegistry, globalCommandRegistry } from '../plugins/registry.js'

const args = process.argv.slice(2)
const cwd = process.cwd()
const appVersion = getAppVersion()

// ── Flags ──────────────────────────────────────────────────────────────────
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`
${chalk.bold.blue('⚡ LocalCode')} ${chalk.gray(`v${appVersion}`)} ${chalk.gray('— Futuristic AI Developer Terminal')}

${chalk.bold('Usage:')}
  ${chalk.blue('localcode')}                        Start interactive TUI
  ${chalk.blue('localcode')} <task>                 Run AI task directly
  ${chalk.blue('localcode')} --continue, -c         Pick up the last session in this folder
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
  process.stdout.write(`${appVersion}\n`)
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

const resume = remaining.includes('--continue') || remaining.includes('-c')
remaining = remaining.filter((a) => a !== '--continue' && a !== '-c')
const provider = extractFlag('--provider')
const model = extractFlag('--model')

if (provider || model) {
  ConfigManager.getInstance().setLLM({
    ...(provider && { provider: provider as any }),
    ...(model && { model }),
  })
}

const initialCommand = remaining.length > 0 ? remaining.join(' ') : undefined

// ── Fullscreen ─────────────────────────────────────────────────────────────
// In a terminal the UI owns the whole screen, like opencode: alternate screen,
// painted by shared/screen.ts. Piped output falls back to Ink's normal renderer.
const settings = prefs(ConfigManager.getInstance().get())
setAnimations(settings.animations)
const fullscreen = process.stdout.isTTY ? createFullscreen(process.stdout, { mouse: settings.mouse }) : null
const mouse = fullscreen && process.stdin.isTTY ? createMouseInput(process.stdin) : null
if (fullscreen && mouse) {
  // Clicks and hover go to the app; a drag selects text and copies it.
  attachPointer(fullscreen, mouse, {
    onClick: (x, y) => { pointerClick(x, y) },
    onMove: pointerMove,
    onCopy: (text) => mouse.events.emit('copied', text),
    panes: getPanes,
  })
}

// Anything printed straight to the console (plugins, libraries) would land in
// the middle of the painted screen. Hold it and print it once the UI is gone.
const deferredLogs: string[] = []
if (fullscreen) {
  const hold = (...parts: unknown[]) => { deferredLogs.push(format(...parts)) }
  console.log = hold
  console.info = hold
  console.warn = hold
  console.error = hold
  console.debug = hold
}

let restored = false
function restoreTerminal(): void {
  if (restored) return
  restored = true
  fullscreen?.leave()
  if (deferredLogs.length) process.stderr.write(deferredLogs.join('\n') + '\n')
}

function crash(err: unknown): void {
  restoreTerminal()
  discordPresence.destroy()
  // Print after leaving the alternate screen — otherwise the message is
  // thrown away with it and the app seems to vanish without a reason.
  process.stderr.write(`\nlocalcode crashed: ${err instanceof Error ? err.stack || err.message : String(err)}\n`)
  process.exit(1)
}

process.on('exit', restoreTerminal)
process.on('SIGINT', () => { restoreTerminal(); discordPresence.destroy(); process.exit(0) })
process.on('SIGTERM', () => { restoreTerminal(); discordPresence.destroy(); process.exit(0) })
process.on('uncaughtException', crash)
process.on('unhandledRejection', crash)

fullscreen?.enter()
loadPlugins(globalRegistry, globalCommandRegistry).catch(() => undefined)
// Discord status is opt-in (/settings → discord status).
if (settings.discord) {
  discordPresence.connect().then(() => discordPresence.update('idle', cwd)).catch(() => undefined)
}

// ── Launch Ink app ─────────────────────────────────────────────────────────
const { waitUntilExit } = render(
  React.createElement(App, { initialCommand, cwd, resume, wheel: mouse?.events, setMouse: fullscreen?.setMouse, onStatusChange: (s: string, dir: string) => discordPresence.update(s as any, dir) }),
  fullscreen
    ? {
        stdout: fullscreen.stream,
        ...(mouse ? { stdin: mouse.stream } : {}),
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      }
    : { exitOnCtrlC: false, patchConsole: true },
)

waitUntilExit().then(() => {
  restoreTerminal()
  discordPresence.destroy()
  process.exit(0)
})
