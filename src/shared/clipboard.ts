// Copy text to the system clipboard from inside a fullscreen terminal app.
//
// Two ways, both tried: OSC 52 asks the terminal itself to set the clipboard
// (Windows Terminal, iTerm2, kitty, WezTerm, Alacritty, also over SSH), and
// the operating system's own tool covers terminals that ignore OSC 52.

import { spawn } from 'child_process'

/** OSC 52 payloads beyond this are refused by several terminals. */
const OSC52_MAX = 100_000

function osc52(text: string): void {
  if (!process.stdout.isTTY) return
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  if (b64.length > OSC52_MAX) return
  try {
    process.stdout.write(`\x1b]52;c;${b64}\x07`)
  } catch {}
}

function run(cmd: string, args: string[], input: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
      p.on('error', () => resolve(false))
      p.on('close', (code) => resolve(code === 0))
      p.stdin.end(input)
    } catch {
      resolve(false)
    }
  })
}

async function native(text: string): Promise<boolean> {
  if (process.env.LOCALCODE_NO_NATIVE_CLIPBOARD) return false
  if (process.platform === 'win32') {
    // clip.exe reads UTF-16 correctly when the text starts with a BOM; plain
    // UTF-8 would turn every umlaut into two wrong characters.
    const body = Buffer.from('﻿' + text, 'utf16le')
    return run('clip', [], body)
  }
  const input = Buffer.from(text, 'utf8')
  if (process.platform === 'darwin') return run('pbcopy', [], input)
  if (process.env.WAYLAND_DISPLAY && (await run('wl-copy', [], input))) return true
  if (await run('xclip', ['-selection', 'clipboard'], input)) return true
  return run('xsel', ['--clipboard', '--input'], input)
}

/** Put `text` on the clipboard. Resolves once the OS tool has finished. */
export async function copyToClipboard(text: string): Promise<void> {
  if (!text) return
  osc52(text)
  await native(text)
}
