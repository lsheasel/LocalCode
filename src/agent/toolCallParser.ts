// Read a tool call out of a model response — and repair the usual damage.
//
// Small local models write the JSON by hand, and long calls (write_file with
// a whole web page) often come back slightly broken:
//   • the final "}" (or "}}") is missing
//   • string values contain real line breaks / tabs instead of \n / \t
//   • the arguments are written flat: {"tool": "x", "path": "…"}
// Before, any of these made the response look like a final answer with no
// text, and the agent stopped without a word.

import { ToolCall } from '../shared/types'

/** Escape raw control characters inside JSON strings; leave everything else. */
function escapeControlCharsInStrings(json: string): string {
  let out = ''
  let inString = false
  let escape = false
  for (const ch of json) {
    if (inString) {
      if (escape) { escape = false; out += ch; continue }
      if (ch === '\\') { escape = true; out += ch; continue }
      if (ch === '"') { inString = false; out += ch; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
      continue
    }
    if (ch === '"') inString = true
    out += ch
  }
  return out
}

/** Turn a parsed object into a ToolCall, accepting the flat argument form. */
function asToolCall(parsed: unknown): ToolCall | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.tool !== 'string' || !obj.tool) return null
  if (obj.arguments && typeof obj.arguments === 'object') {
    return { tool: obj.tool, arguments: obj.arguments as Record<string, unknown> } as ToolCall
  }
  const { tool, arguments: _ignored, ...rest } = obj
  return { tool, arguments: rest } as ToolCall
}

function tryParse(candidate: string): ToolCall | null {
  for (const text of [candidate, escapeControlCharsInStrings(candidate)]) {
    try {
      const call = asToolCall(JSON.parse(text))
      if (call) return call
    } catch {}
  }
  return null
}

/**
 * Scan from `start` (a "{"): returns the end index of the balanced object, or
 * how many braces are still open when the text runs out.
 */
function scanObject(text: string, start: number): { end: number } | { open: number; inString: boolean } {
  let depth = 0
  let inString = false
  let escape = false
  for (let j = start; j < text.length; j++) {
    const ch = text[j]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { end: j }
    }
  }
  return { open: depth, inString }
}

export function parseToolCall(text: string): ToolCall | null {
  // 1. A complete, valid object anywhere in the text.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    const r = scanObject(text, i)
    if ('end' in r) {
      const call = tryParse(text.slice(i, r.end + 1))
      if (call) return call
    }
  }

  // 2. Repair: the last object that starts a tool call but never closes.
  const starts = [...text.matchAll(/\{\s*"tool"\s*:/g)].map((m) => m.index!)
  for (const i of starts.reverse()) {
    const r = scanObject(text, i)
    if ('end' in r || r.inString || r.open <= 0 || r.open > 3) continue
    const call = tryParse(text.slice(i).trimEnd() + '}'.repeat(r.open))
    if (call) return call
  }
  return null
}

/** True when the response tried to call a tool, whether or not it parsed. */
export function looksLikeToolCall(text: string): boolean {
  const visible = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  return /\{\s*"tool"\s*:/.test(visible)
}
