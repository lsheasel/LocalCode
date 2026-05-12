import { extname } from 'path'

export function decodeHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function decodeJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

export function decodeXml(raw: string): string {
  let indent = 0
  const lines: string[] = []
  const tokens = raw.replace(/>\s*</g, '>\n<').split('\n')
  for (const token of tokens) {
    const t = token.trim()
    if (!t) continue
    if (t.startsWith('</')) {
      indent = Math.max(0, indent - 1)
      lines.push('  '.repeat(indent) + t)
    } else if (
      t.startsWith('<') &&
      !t.startsWith('<?') &&
      !t.startsWith('<!') &&
      !t.endsWith('/>') &&
      !t.includes('</')
    ) {
      lines.push('  '.repeat(indent) + t)
      indent++
    } else {
      lines.push('  '.repeat(indent) + t)
    }
  }
  return lines.join('\n')
}

export function decodeCsv(raw: string): string {
  const rows = raw.split('\n').map(r => r.trimEnd()).filter(r => r)
  if (rows.length === 0) return raw
  const parsed = rows.map(row => {
    const cells: string[] = []
    let cur = '', inQ = false
    for (const ch of row) {
      if (ch === '"') { inQ = !inQ; continue }
      if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    cells.push(cur.trim())
    return cells
  })
  const colCount = Math.max(...parsed.map(r => r.length))
  const widths = Array.from({ length: colCount }, (_, i) =>
    Math.min(40, Math.max(4, ...parsed.map(r => (r[i] || '').length)))
  )
  return parsed.map((row, ri) => {
    const line = row.map((cell, ci) => cell.padEnd(widths[ci] ?? 0)).join(' │ ')
    if (ri === 0) return line + '\n' + widths.map(w => '─'.repeat(w)).join('─┼─')
    return line
  }).join('\n')
}

/** Decode raw content based on a MIME-type string or file extension hint. */
export function decodeContent(raw: string, hint: string): string {
  const h = hint.toLowerCase()
  if (h.includes('html') || h === '.html' || h === '.htm' || h === '.xhtml') return decodeHtml(raw)
  if (h.includes('json') || h === '.json' || h === '.jsonc') return decodeJson(raw)
  if (h.includes('xml') || h === '.xml' || h === '.svg' || h === '.rss' || h === '.atom') return decodeXml(raw)
  if (h === '.csv' || h.includes('csv')) return decodeCsv(raw)
  return raw
}

/** Returns the lowercase extension including the dot, e.g. ".json". */
export function hintFromPath(filePath: string): string {
  return extname(filePath).toLowerCase()
}
