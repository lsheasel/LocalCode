import { BUILTIN_COMMANDS, COMMAND_SUGGESTIONS } from './constants'

/**
 * Fit as many items as possible into `width` cells, in order, dropping the
 * rest. Used by the one-row bars so they never wrap onto a second row.
 */
export function fitItems<T>(items: T[], width: number, cost: (item: T) => number): T[] {
  const out: T[] = []
  let used = 0
  for (const item of items) {
    const w = cost(item)
    if (used + w > width) break
    used += w
    out.push(item)
  }
  return out
}

/** Shorten `s` to `max` cells, keeping the start (`…` marks the cut). */
export function truncEnd(s: string, max: number): string {
  if (max <= 0) return ''
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…'
}

/** Shorten `s` to `max` cells, keeping the end (`…` marks the cut). */
export function truncStart(s: string, max: number): string {
  if (max <= 0) return ''
  return s.length <= max ? s : '…' + s.slice(s.length - Math.max(0, max - 1))
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Thinking tag parser ───────────────────────────────────────────────────────
export function parseThinking(tokens: string): {
  thinking: string
  response: string
  stillThinking: boolean
} {
  let openTag = '<thinking>'
  let closeTag = '</thinking>'
  let start = tokens.indexOf(openTag)

  if (start === -1) {
    openTag = '<think>'
    closeTag = '</think>'
    start = tokens.indexOf(openTag)
  }

  if (start !== -1) {
    const before = tokens.slice(0, start).trim()
    const end = tokens.indexOf(closeTag, start)
    if (end === -1) {
      return {
        thinking: tokens.slice(start + openTag.length),
        response: before,
        stillThinking: true,
      }
    }
    const after = tokens.slice(end + closeTag.length).trimStart()
    return {
      thinking: tokens.slice(start + openTag.length, end),
      response: before + (before && after ? '\n\n' : '') + after,
      stillThinking: false,
    }
  }

  const closeThinking = tokens.indexOf('</thinking>')
  const closeThink = tokens.indexOf('</think>')

  if (closeThinking !== -1) {
    return {
      thinking: tokens.slice(0, closeThinking),
      response: tokens.slice(closeThinking + '</thinking>'.length).trimStart(),
      stillThinking: false,
    }
  }
  if (closeThink !== -1) {
    return {
      thinking: tokens.slice(0, closeThink),
      response: tokens.slice(closeThink + '</think>'.length).trimStart(),
      stillThinking: false,
    }
  }

  return { thinking: '', response: tokens, stillThinking: false }
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
export function getSuggestion(input: string, history: string[]): string {
  if (input.length < 2) return ''
  const h = history.find(
    (s) => s !== input && s.toLowerCase().startsWith(input.toLowerCase()),
  )
  if (h) return h.slice(input.length)
  const c = BUILTIN_COMMANDS.find(
    (b) => b.cmd.startsWith(input) && b.cmd !== input,
  )
  if (c) return c.cmd.slice(input.length)
  const a = COMMAND_SUGGESTIONS.find((s) => s.startsWith(input) && s !== input)
  if (a) return a.slice(input.length)
  return ''
}

// ── Transcript virtualisation ─────────────────────────────────────────────────

/** Rows `text` takes when wrapped at `width` (rough: one cell per char). */
export function countLines(text: string, width: number): number {
  const w = Math.max(1, width)
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / w)), 0)
}

/** Wrap `text` to lines of at most `width` cells, breaking at spaces where possible. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue
      if ((line + word).length <= w) { line += word; continue }
      if (line.trim()) out.push(line.trimEnd())
      line = word.trimStart()
      while (line.length > w) { out.push(line.slice(0, w)); line = line.slice(w) }
    }
    out.push(line.trimEnd())
  }
  return out
}

export interface ItemWindow {
  /** First item to render (inclusive). */
  start: number
  /** Last item to render (exclusive). */
  end: number
  /** Estimated rows of the items skipped below the window. */
  linesBelow: number
  /** Estimated rows of the items skipped above the window. */
  linesAbove: number
}

/**
 * Pick which transcript items to render for a viewport of `viewRows` rows,
 * scrolled `scrollLines` up from the bottom.
 *
 * This only keeps long sessions cheap — the *exact* scroll position comes from
 * Ink: the rendered items sit in a clipped, bottom-aligned box shifted down by
 * `scrollLines - linesBelow` rows (a negative bottom margin). The heights are
 * estimates, so a full screen of slack is rendered on both sides; an
 * under-estimate can never leave a gap in the viewport.
 */
export function getItemWindow(
  heights: number[],
  viewRows: number,
  scrollLines: number,
): ItemWindow {
  const slack = Math.max(viewRows, 10)
  const lo = scrollLines - slack
  const hi = scrollLines + viewRows + slack

  let start = heights.length
  let end = heights.length
  let linesBelow = 0
  let linesAbove = 0
  let pos = 0 // rows between the bottom of the transcript and this item

  for (let i = heights.length - 1; i >= 0; i--) {
    const h = heights[i]
    if (pos + h <= lo) {
      linesBelow += h
      end = i
      start = i
    } else if (pos >= hi) {
      linesAbove += h
    } else {
      start = i
    }
    pos += h
  }
  return { start, end, linesBelow, linesAbove }
}

// ── Fuzzy search ──────────────────────────────────────────────────────────────

/**
 * Score how well `query` matches `text` as a subsequence (case-insensitive);
 * null when it doesn't. Consecutive letters and letters at the start of a
 * word or path segment score higher, so "sl" finds "/session load" first.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    const boundary = found === 0 || /[\s/._\-:]/.test(t[found - 1])
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (boundary ? 3 : 0) - Math.min(3, (found - ti) * 0.1)
    ti = found + 1
  }
  // Shorter texts win ties.
  return score - t.length * 0.01
}

/** 950 → "950", 12345 → "12.3k", 65536 → "65.5k". */
export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n)
}
