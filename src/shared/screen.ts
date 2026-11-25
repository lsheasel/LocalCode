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
//
// The mouse is captured too (createMouseInput below): wheel, hover, clicks,
// and drag-to-select. A terminal that reports the mouse no longer selects
// text on its own, so this file paints the selection and copies it itself
// (attachPointer).

import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import stringWidth from 'string-width'
import { copyToClipboard } from './clipboard'

const ESC = '\x1B['

/** Never paint more often than this — Ink in debug mode renders on every commit. */
const FRAME_INTERVAL_MS = 16

/** Report buttons, wheel and any motion, SGR encoded. */
const MOUSE_ON = `${ESC}?1000h${ESC}?1003h${ESC}?1006h`
const MOUSE_OFF = `${ESC}?1006l${ESC}?1003l${ESC}?1000l`

export interface FullscreenScreen {
  /** Pass this to Ink's render() as `stdout`, together with `debug: true`. */
  stream: NodeJS.WriteStream
  /** Switch to the alternate screen and hide the cursor. */
  enter(): void
  /** Paint any pending frame, then restore the normal screen. Idempotent. */
  leave(): void
  /** Report the mouse to the app (hover, clicks, wheel) or leave it to the terminal. */
  setMouse(on: boolean): void
  /** Highlight a selection, or clear it with null. */
  setSelection(sel: Selection | null): void
  /** The plain text inside a selection, as it is on screen now. */
  selectionText(sel: Selection): string
}

/** A text selection in screen cells. Columns stay inside [left, right). */
export interface Selection {
  from: { x: number; y: number }
  to: { x: number; y: number }
  left: number
  right: number
  /** Background of the highlight, "#rrggbb". */
  color: string
}

export function createFullscreen(out: NodeJS.WriteStream, opts: { mouse?: boolean } = {}): FullscreenScreen {
  const stream = new EventEmitter() as EventEmitter & Record<string, unknown>

  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastPaint = 0
  /** What is on screen right now, row by row. */
  let shown: string[] = []
  let fullRepaint = true
  let active = false
  let mouse = opts.mouse !== false
  /** The last frame Ink sent, without the selection painted over it. */
  let lastFrame = ''
  let selection: Selection | null = null

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
    if (selection) {
      for (const [y, from, to] of selectedRows(selection)) {
        if (y < lines.length) lines[y] = highlight(lines[y], from, to, selection.color)
      }
    }

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
    lastFrame = pending
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
    selection = null
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
          (mouse ? MOUSE_ON : '') + // report the mouse (see createMouseInput)
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
      out.write(`${ESC}?2004l${MOUSE_OFF}${ESC}?7h${ESC}?25h${ESC}0m${ESC}?1049l`)
    },
    setMouse(on) {
      if (on === mouse) return
      mouse = on
      if (active) out.write(on ? MOUSE_ON : MOUSE_OFF)
    },
    setSelection(sel) {
      if (!sel && !selection) return
      selection = sel
      // Repaint the last frame with (or without) the highlight.
      if (pending === null) pending = lastFrame
      schedule()
    },
    selectionText(sel) {
      const lines = lastFrame.split('\n').map(plain)
      const rows = selectedRows(sel).map(([y, from, to]) =>
        sliceCells(lines[y] ?? '', from, to + 1).replace(/\s+$/, ''),
      )
      return tidySelection(rows)
    },
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

/** [row, first column, last column] for every row a selection touches. */
export function selectedRows(sel: Selection): Array<[number, number, number]> {
  const forward = sel.from.y < sel.to.y || (sel.from.y === sel.to.y && sel.from.x <= sel.to.x)
  const [a, b] = forward ? [sel.from, sel.to] : [sel.to, sel.from]
  const clamp = (x: number) => Math.min(sel.right - 1, Math.max(sel.left, x))
  const out: Array<[number, number, number]> = []
  for (let y = a.y; y <= b.y; y++) {
    const from = y === a.y ? clamp(a.x) : sel.left
    const to = y === b.y ? clamp(b.x) : sel.right - 1
    if (to >= from) out.push([y, from, to])
  }
  return out
}

const SGR = /\x1B\[[0-9;:]*m/y
const OTHER_ESC = /\x1B(?:\[[0-9;?<>=]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/y
const ANY_ESC = /\x1B\[[0-9;:?<>=]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g

/** The text of a painted row, without colours. */
export function plain(line: string): string {
  return line.replace(ANY_ESC, '')
}

const cellWidth = (ch: string) => (ch.charCodeAt(0) < 0x1100 ? 1 : Math.max(1, stringWidth(ch)))

/** The characters of `text` that sit in cells [from, to). */
export function sliceCells(text: string, from: number, to: number): string {
  let col = 0
  let out = ''
  for (const ch of text) {
    if (col >= to) break
    if (col >= from) out += ch
    col += cellWidth(ch)
  }
  return out
}

/**
 * Paint cells [from, to] of a coloured row with background `color`, keeping
 * the text colours. A colour change inside the range could reset the
 * background, so the highlight is set again after each one; after the range
 * the row's own colours are put back.
 */
export function highlight(line: string, from: number, to: number, color: string): string {
  const n = parseInt(color.slice(1), 16)
  const bg = `${ESC}48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
  let out = ''
  let col = 0
  let i = 0
  let state = '' // colour codes since the last full reset
  let on = false
  let done = false
  const open = () => {
    if (!on && !done) {
      out += bg
      on = true
    }
  }
  const close = () => {
    if (on) {
      out += `${ESC}49m${state}`
      on = false
      done = true
    }
  }
  while (i < line.length) {
    SGR.lastIndex = i
    const sgr = SGR.exec(line)
    if (sgr) {
      out += sgr[0]
      state = /^\x1B\[0?m$/.test(sgr[0]) ? '' : state + sgr[0]
      if (on) out += bg
      i += sgr[0].length
      continue
    }
    OTHER_ESC.lastIndex = i
    const esc = OTHER_ESC.exec(line)
    if (esc) {
      out += esc[0]
      i += esc[0].length
      continue
    }
    const ch = String.fromCodePoint(line.codePointAt(i)!)
    if (col >= from && col <= to) open()
    else if (col > to) close()
    out += ch
    col += cellWidth(ch)
    i += ch.length
  }
  // A selection past the end of the text still shows where it ends.
  if (!done && col <= to) {
    open()
    out += ' '.repeat(to - Math.max(col, from) + 1)
  }
  close()
  return out
}

const THREAD = /^\s?[│┃] ?/

/**
 * Selected rows as text. Transcript rows start with the thread ("│ "); when
 * the rows have it, it is decoration, not text, and goes. So does the
 * indentation the rows share. A first row that starts mid-line (no thread,
 * no indent) is left out of that comparison.
 */
export function tidySelection(rows: string[]): string {
  if (rows.length > 1) {
    const rest = rows.slice(1).filter((r) => r.trim())
    if (rest.length && rest.every((r) => THREAD.test(r))) rows = rows.map((r) => r.replace(THREAD, ''))
    const firstIsWhole = /^\s/.test(rows[0]) || !rows[0].trim()
    const pool = (firstIsWhole ? rows : rows.slice(1)).filter((r) => r.trim())
    const indent = pool.length ? Math.min(...pool.map((r) => /^ */.exec(r)![0].length)) : 0
    if (indent > 0) rows = rows.map((r, i) => (i === 0 && !firstIsWhole ? r : r.slice(indent)))
  } else if (/^\s/.test(rows[0] ?? '')) {
    rows = [rows[0].trimStart()]
  }
  return rows.join('\n').replace(/^\n+|\n+$/g, '')
}

// ── Mouse ─────────────────────────────────────────────────────────────────────
// In fullscreen the transcript scrolls inside the app, so the wheel has to
// reach the app as a wheel, not as arrow keys, which belong to the prompt
// history. The terminal reports mouse events (SGR mode 1006) on stdin; this
// proxy strips them out before Ink sees the input and emits them as events.

export interface MouseInput {
  /** Pass this to Ink's render() as `stdin`. */
  stream: NodeJS.ReadStream
  /**
   * Emits 'wheel' with -1 (up) or +1 (down), and 'pointer' with a
   * PointerEvent for presses, releases and movement.
   */
  events: EventEmitter
}

export interface PointerEvent {
  kind: 'down' | 'up' | 'drag' | 'move'
  /** 0 left, 1 middle, 2 right. */
  button: number
  /** Screen cell, 0-based. */
  x: number
  y: number
}

// ESC [ < code ; column ; row (M press or motion | m release)
const SGR_MOUSE = /\x1B\[<(\d+);(\d+);(\d+)([mM])/g

/** One SGR mouse report: a wheel step ('up' / 'down') or a pointer event. */
export function decodeMouse(code: number, col: number, row: number, final: string): PointerEvent | 'up' | 'down' {
  if (code & 64) return (code & 1) === 0 ? 'up' : 'down'
  const button = code & 3
  const x = col - 1
  const y = row - 1
  if (code & 32) return { kind: button === 3 ? 'move' : 'drag', button, x, y }
  if (final === 'm') return { kind: 'up', button, x, y }
  return { kind: 'down', button, x, y }
}

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
    text = text.replace(SGR_MOUSE, (_m, code: string, col: string, row: string, final: string) => {
      const ev = decodeMouse(Number(code), Number(col), Number(row), final)
      if (ev === 'up') events.emit('wheel', -1)
      else if (ev === 'down') events.emit('wheel', 1)
      else events.emit('pointer', ev)
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

// ── Pointer: click or drag-to-select ──────────────────────────────────────────

export interface PointerHandlers {
  /** A press and release on the same spot. */
  onClick(x: number, y: number): void
  /** The mouse moved with no button held. */
  onMove(x: number, y: number): void
  /** A drag selected text, which is now on the clipboard. */
  onCopy(text: string): void
  /** Column ranges [left, right) the screen is split into (main column, sidebar). */
  panes(): Array<[number, number]>
}

/** The highlight, then the steps it fades through once the text is copied. */
const SELECT_FADE = ['#24508F', '#1F4475', '#1A375C', '#152A44', '#111A26']

/**
 * Mouse handling on top of the screen: a click goes to the app, a drag
 * selects text inside the pane it started in, and letting go copies it.
 */
export function attachPointer(screen: FullscreenScreen, mouse: MouseInput, h: PointerHandlers): void {
  let anchor: { x: number; y: number } | null = null
  let current: Selection | null = null
  let fadeTimer: ReturnType<typeof setTimeout> | null = null

  const paneFor = (x: number): [number, number] => {
    for (const p of h.panes()) if (x >= p[0] && x < p[1]) return p
    return [0, Number.MAX_SAFE_INTEGER]
  }
  const stopFade = () => {
    if (fadeTimer) clearTimeout(fadeTimer)
    fadeTimer = null
  }
  /** After copying, the highlight stays a moment, then fades out. */
  const fadeOut = (sel: Selection, step = 0) => {
    if (step >= SELECT_FADE.length) {
      fadeTimer = null
      screen.setSelection(null)
      return
    }
    screen.setSelection({ ...sel, color: SELECT_FADE[step] })
    fadeTimer = setTimeout(() => fadeOut(sel, step + 1), step === 0 ? 350 : 45)
  }

  mouse.events.on('pointer', (ev: PointerEvent) => {
    if (ev.kind === 'move') {
      h.onMove(ev.x, ev.y)
      return
    }
    if (ev.button !== 0) return
    if (ev.kind === 'down') {
      stopFade()
      screen.setSelection(null)
      anchor = { x: ev.x, y: ev.y }
      current = null
      return
    }
    if (!anchor) return
    if (ev.kind === 'drag') {
      if (!current && ev.x === anchor.x && ev.y === anchor.y) return
      const [left, right] = paneFor(anchor.x)
      current = { from: anchor, to: { x: ev.x, y: ev.y }, left, right, color: SELECT_FADE[0] }
      screen.setSelection(current)
      return
    }
    // Released.
    const start = anchor
    const sel = current
    anchor = null
    current = null
    if (!sel) {
      h.onClick(start.x, start.y)
      return
    }
    const text = screen.selectionText(sel)
    if (!text.trim()) {
      screen.setSelection(null)
      return
    }
    copyToClipboard(text).catch(() => undefined)
    h.onCopy(text)
    fadeOut(sel)
  })
}
