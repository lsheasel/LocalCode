// Fullscreen renderer for Ink.
//
// The UI owns the whole terminal (like opencode): it runs in the alternate
// screen and paints every frame itself. Ink 4 on its own redraws relative to
// the cursor ("move up N lines, rewrite"), which breaks for a fullscreen app:
//   1. Once a frame is as tall as the terminal, Ink clears the whole terminal
//      before *every* frame — the spinner alone caused ~12 full clears a
//      second, which is visible flicker.
//   2. On resize the terminal reflows what is on screen, so "up N lines" no
//      longer points at the top of the frame and old frames are left behind.
//
// So Ink runs in `debug` mode — where every write is one complete frame —
// against this proxy stdout. The proxy paints each frame at absolute
// positions, rewrites only the rows that changed, and repaints everything
// after a resize. Nothing depends on where the cursor was left.
// The mouse wheel is captured too (createMouseInput below).

import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

const ESC = '\x1B['

/** Never paint more often than this — Ink in debug mode renders on every commit. */
const FRAME_INTERVAL_MS = 16

export interface FullscreenScreen {
  /** Pass this to Ink's render() as `stdout`, together with `debug: true`. */
  stream: NodeJS.WriteStream
  /** Switch to the alternate screen and hide the cursor. */
  enter(): void
  /** Paint any pending frame, then restore the normal screen. Idempotent. */
  leave(): void
}

export function createFullscreen(out: NodeJS.WriteStream): FullscreenScreen {
  const stream = new EventEmitter() as EventEmitter & Record<string, unknown>

  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastPaint = 0
  /** What is on screen right now, row by row. */
  let shown: string[] = []
  let fullRepaint = true
  let active = false

  const paint = () => {
    timer = null
    if (pending === null || !active) return
    const frame = pending
    pending = null
    lastPaint = Date.now()

    const rows = out.rows || 24
    const lines = frame.split('\n')
    // A frame taller than the screen would scroll it; the extra rows only
    // exist for a moment, between a shrink and the re-layout that follows.
    if (lines.length > rows) lines.length = rows

    // Synchronized output (DEC 2026): the terminal shows the whole update at
    // once instead of row by row. Terminals without it ignore it.
    let buf = `${ESC}?2026h`
    if (fullRepaint) {
      buf += `${ESC}0m${ESC}2J`
      shown = []
      fullRepaint = false
    }
    for (let y = 0; y < rows; y++) {
      const line = lines[y] ?? ''
      if (shown[y] === line) continue
      // Reset attributes before erasing, so the rest of the row is not painted
      // in whatever background colour the line ended with.
      buf += `${ESC}${y + 1};1H${line}${ESC}0m${ESC}K`
      shown[y] = line
    }
    shown.length = rows
    buf += `${ESC}?2026l`
    out.write(buf)
  }

  const schedule = () => {
    if (timer) return
    const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - lastPaint))
    timer = setTimeout(paint, wait)
  }

  stream.write = (chunk: unknown, encOrCb?: unknown, cb?: unknown) => {
    pending = typeof chunk === 'string' ? chunk : String(chunk)
    schedule()
    const done = typeof encOrCb === 'function' ? encOrCb : cb
    if (typeof done === 'function') (done as () => void)()
    return true
  }

  Object.defineProperties(stream, {
    columns: { get: () => out.columns || 80 },
    rows: { get: () => out.rows || 24 },
    isTTY: { get: () => true },
  })

  // The terminal may have reflowed or cleared what we painted — repaint it all.
  const onResize = () => {
    fullRepaint = true
    stream.emit('resize')
  }

  return {
    stream: stream as unknown as NodeJS.WriteStream,
    enter() {
      if (active) return
      active = true
      out.on('resize', onResize)
      out.write(
        `${ESC}?1049h` + // alternate screen buffer
          `${ESC}?25l` + // hide the cursor — the prompt draws its own
          `${ESC}?7l` + // no auto-wrap: an over-long row is clipped, never wraps
          `${ESC}?1000h${ESC}?1006h` + // report mouse buttons/wheel, SGR encoding (see createMouseInput)
          `${ESC}?2004h` + // bracketed paste: pasted text arrives marked, as one piece
          `${ESC}2J${ESC}H`,
      )
    },
    leave() {
      if (!active) return
      if (timer) clearTimeout(timer)
      paint()
      active = false
      out.off('resize', onResize)
      out.write(`${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?7h${ESC}?25h${ESC}0m${ESC}?1049l`)
    },
  }
}

// ── Mouse wheel ───────────────────────────────────────────────────────────────
// In fullscreen the transcript scrolls inside the app, so the wheel has to
// reach the app as a wheel — not as arrow keys, which belong to the prompt
// history. The terminal reports mouse events (SGR mode 1006) on stdin; this
// proxy strips them out before Ink sees the input and emits wheel steps
// instead. Like opencode, text selection then needs Shift+drag.

export interface MouseInput {
  /** Pass this to Ink's render() as `stdin`. */
  stream: NodeJS.ReadStream
  /** Emits 'wheel' with -1 (up) or +1 (down). */
  events: EventEmitter
}

// ESC [ < button ; column ; row (M press | m release)
const SGR_MOUSE = /\x1B\[<(\d+);\d+;\d+[mM]/g

export function createMouseInput(real: NodeJS.ReadStream): MouseInput {
  const proxy = new PassThrough() as unknown as NodeJS.ReadStream & Record<string, unknown>
  const events = new EventEmitter()

  proxy.isTTY = true
  proxy.setRawMode = (mode: boolean) => {
    real.setRawMode?.(mode)
    return proxy
  }
  proxy.ref = () => {
    real.ref()
    return proxy
  }
  proxy.unref = () => {
    real.unref()
    return proxy
  }

  // Ink 4 treats whatever arrives in one read as ONE keypress. Holding ←, fast
  // typing or a paste deliver several keys at once, which Ink then doesn't
  // recognise at all. So input is split into single keys here and handed over
  // one per tick — except pasted text, which the terminal marks (bracketed
  // paste) and which stays one piece, line breaks included.
  const queue: string[] = []
  let draining = false
  const drain = () => {
    const next = queue.shift()
    if (next === undefined) {
      draining = false
      return
    }
    proxy.write(next)
    setImmediate(drain)
  }
  const send = (token: string) => {
    queue.push(token)
    if (!draining) {
      draining = true
      setImmediate(drain)
    }
  }

  let pasting = false
  let pasteBuf = ''

  // Raw mode right away, not only once Ink has mounted: keys typed while the
  // app starts would otherwise sit in the terminal's line buffer and be lost.
  // They are buffered here instead and reach the prompt as soon as it exists.
  try {
    real.setRawMode?.(true)
  } catch {}

  real.on('data', (chunk: Buffer | string) => {
    let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    text = text.replace(SGR_MOUSE, (_m, button: string) => {
      const b = Number(button)
      if (b === 64) events.emit('wheel', -1)
      else if (b === 65) events.emit('wheel', 1)
      return ''
    })

    while (text) {
      if (pasting) {
        const end = text.indexOf(PASTE_END)
        if (end === -1) {
          pasteBuf += text
          return
        }
        pasteBuf += text.slice(0, end)
        text = text.slice(end + PASTE_END.length)
        pasting = false
        // A one-character paste would look like a keypress (e.g. "\r" =
        // Enter); a paste is always text, so give it a harmless second char.
        if (pasteBuf) send(pasteBuf.length === 1 && pasteBuf < ' ' ? pasteBuf + ' ' : pasteBuf)
        pasteBuf = ''
        continue
      }
      const start = text.indexOf(PASTE_START)
      const keys = start === -1 ? text : text.slice(0, start)
      for (const token of keys.match(KEY_TOKEN) ?? []) send(token)
      if (start === -1) return
      text = text.slice(start + PASTE_START.length)
      pasting = true
    }
  })

  return { stream: proxy, events }
}

const PASTE_START = '\x1B[200~'
const PASTE_END = '\x1B[201~'
/**
 * One key: an escape sequence (CSI "ESC [ … final", SS3 "ESC O x", or ESC
 * plus one char for Alt+key), a single control character, or a run of plain
 * text (typed characters arriving together are still just text).
 */
const KEY_TOKEN = /\x1B\[[0-9;?<>=]*[ -\/]*[@-~]|\x1BO[@-~]|\x1B[\s\S]?|[\x00-\x1F\x7F]|[^\x00-\x1F\x7F\x1B]+/g
