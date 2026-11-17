// The prompt's text editing, as pure functions — no React, so it can be
// tested on its own and the app stays the only keyboard listener.
//
//   enter            send                 alt+enter / ctrl+j   new line
//   ← →              move                 ctrl+← / ctrl+→      by word
//   home / ctrl+a    line start           end / ctrl+e         line end
//   ↑ ↓              line up / down (history when already on the first/last row)
//   backspace        delete back          ctrl+w               delete word back
//   ctrl+u           delete to line start
//   paste            inserted as is (Windows line breaks become \n)

export interface EditorState {
  value: string
  /** Cursor position as an index into `value` (0 … value.length). */
  cursor: number
}

/** The subset of Ink's key flags the editor looks at. */
export interface KeyInfo {
  return?: boolean
  backspace?: boolean
  delete?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  upArrow?: boolean
  downArrow?: boolean
  ctrl?: boolean
  meta?: boolean
  tab?: boolean
  escape?: boolean
}

export type EditResult =
  | { kind: 'edit'; state: EditorState }
  | { kind: 'submit' }
  /** Up/down pressed on the first/last row: the caller may browse history. */
  | { kind: 'edge'; dir: -1 | 1 }
  | { kind: 'ignored' }

const clamp = (s: EditorState): EditorState => ({
  value: s.value,
  cursor: Math.max(0, Math.min(s.value.length, s.cursor)),
})

const lineStart = (v: string, c: number) => v.lastIndexOf('\n', c - 1) + 1
const lineEnd = (v: string, c: number) => {
  const i = v.indexOf('\n', c)
  return i === -1 ? v.length : i
}

function wordLeft(v: string, c: number): number {
  let i = c
  while (i > 0 && /\s/.test(v[i - 1])) i--
  while (i > 0 && !/\s/.test(v[i - 1])) i--
  return i
}

function wordRight(v: string, c: number): number {
  let i = c
  while (i < v.length && /\s/.test(v[i])) i++
  while (i < v.length && !/\s/.test(v[i])) i++
  return i
}

function insert(s: EditorState, text: string): EditorState {
  return { value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor), cursor: s.cursor + text.length }
}

function removeRange(s: EditorState, from: number, to: number): EditorState {
  return { value: s.value.slice(0, from) + s.value.slice(to), cursor: from }
}

/** Move the cursor one visual row up or down within `width`-wide rows. */
function moveVertical(s: EditorState, dir: -1 | 1, width: number): EditorState | null {
  const rows = layoutRows(s.value, width)
  const pos = cursorRowCol(rows, s.cursor)
  const target = pos.row + dir
  if (target < 0 || target >= rows.length) return null
  const r = rows[target]
  return { value: s.value, cursor: r.start + Math.min(pos.col, r.text.length) }
}

/**
 * Apply one keypress. `width` is the text area's width, for moving between
 * wrapped rows. Keys the editor doesn't use come back as 'ignored'.
 */
export function editKey(state: EditorState, input: string, key: KeyInfo, width: number): EditResult {
  const s = clamp(state)
  const { value: v, cursor: c } = s
  const edit = (next: EditorState): EditResult => ({ kind: 'edit', state: clamp(next) })

  // Alt+Enter / Ctrl+J: new line. (Ink reports Alt+Enter as meta + "\r".)
  if ((key.meta && input === '\r') || (key.ctrl && input === 'j')) return edit(insert(s, '\n'))
  if (key.return) return { kind: 'submit' }

  if (key.backspace || key.delete) {
    if (c === 0) return { kind: 'ignored' }
    return edit(removeRange(s, c - 1, c))
  }

  // Word-wise movement arrives as "[1;5D" / "[1;5C" with meta set.
  if (key.meta && /^\[1;[35]D$/.test(input)) return edit({ value: v, cursor: wordLeft(v, c) })
  if (key.meta && /^\[1;[35]C$/.test(input)) return edit({ value: v, cursor: wordRight(v, c) })
  // Home / End (several encodings).
  if ((key.meta && /^(\[H|\[1~|OH)$/.test(input)) || (key.ctrl && input === 'a')) {
    return edit({ value: v, cursor: lineStart(v, c) })
  }
  if ((key.meta && /^(\[F|\[4~|OF)$/.test(input)) || (key.ctrl && input === 'e')) {
    return edit({ value: v, cursor: lineEnd(v, c) })
  }

  if (key.leftArrow) return edit({ value: v, cursor: c - 1 })
  if (key.rightArrow) return edit({ value: v, cursor: c + 1 })

  if (key.upArrow || key.downArrow) {
    const dir = key.upArrow ? -1 : 1
    const moved = moveVertical(s, dir, width)
    return moved ? edit(moved) : { kind: 'edge', dir }
  }

  if (key.ctrl && input === 'w') return edit(removeRange(s, wordLeft(v, c), c))
  if (key.ctrl && input === 'u') return edit(removeRange(s, lineStart(v, c), c))

  // Anything else with ctrl/meta, tab or escape belongs to the app.
  if (key.ctrl || key.meta || key.tab || key.escape) return { kind: 'ignored' }

  if (input) {
    // Typed text or a paste. Normalise line breaks; drop other control chars.
    const text = input.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    if (text) return edit(insert(s, text))
  }
  return { kind: 'ignored' }
}

export interface Row {
  /** Index in the value where this visual row starts. */
  start: number
  text: string
}

/** Split `value` into visual rows: at line breaks, and hard-wrapped at `width`. */
export function layoutRows(value: string, width: number): Row[] {
  const w = Math.max(1, width)
  const rows: Row[] = []
  let start = 0
  for (const line of value.split('\n')) {
    if (line.length === 0) rows.push({ start, text: '' })
    for (let i = 0; i < line.length; i += w) rows.push({ start: start + i, text: line.slice(i, i + w) })
    start += line.length + 1
  }
  return rows
}

/** Visual row and column of `cursor`. A cursor at a wrap point sits on the next row. */
export function cursorRowCol(rows: Row[], cursor: number): { row: number; col: number } {
  for (let r = rows.length - 1; r >= 0; r--) {
    if (cursor >= rows[r].start) {
      return { row: r, col: Math.min(cursor - rows[r].start, rows[r].text.length) }
    }
  }
  return { row: 0, col: 0 }
}
