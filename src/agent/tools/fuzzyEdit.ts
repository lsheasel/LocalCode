// Locate the text an edit_file call wants to replace — tolerantly.
//
// Small local models rarely reproduce the old text byte for byte. The usual
// slips, seen in practice:
//   • copying the line numbers from read_file's output ("  2 │ return a - b")
//   • different indentation (tabs vs spaces, a level more or less)
//   • trailing whitespace, CRLF vs LF, a stray blank line at either end
// Each failed edit costs a full extra round trip (re-read, retry), so the
// matcher tries progressively looser comparisons. Loose matches must be
// unique — an ambiguous one is refused rather than guessed.

export interface EditPlan {
  /** The whole new file content. */
  content: string
  /** 1-based line where the replaced block starts. */
  startLine: number
  /** The file's lines that were replaced. */
  oldLines: string[]
  /** The lines that replaced them (re-indented when matched loosely). */
  newLines: string[]
  /** How the block was found. */
  strategy: 'exact' | 'lines' | 'trailing-space' | 'indentation'
}

export type EditOutcome = { ok: true; plan: EditPlan } | { ok: false; reason: string }

// "  12 │ code", "12: code", "12| code" — read_file's numbering, copied by mistake.
const LINE_NO = /^\s*\d+\s*(?:│|\||:)\s?/

/** Drop copied line numbers, but only when every non-blank line has one. */
function stripLineNumbers(lines: string[]): string[] {
  const nonBlank = lines.filter((l) => l.trim())
  if (nonBlank.length === 0 || !nonBlank.every((l) => LINE_NO.test(l))) return lines
  return lines.map((l) => l.replace(LINE_NO, ''))
}

/** Remove blank lines at the start and end. */
function trimBlankEdges(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a].trim()) a++
  while (b > a && !lines[b - 1].trim()) b--
  return lines.slice(a, b)
}

const indentOf = (line: string) => /^\s*/.exec(line)![0]

/** All start indices where `needle` matches `hay` line by line under `eq`. */
function findAll(hay: string[], needle: string[], eq: (a: string, b: string) => boolean): number[] {
  const hits: number[] = []
  if (needle.length === 0 || needle.length > hay.length) return hits
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (!eq(hay[i + j], needle[j])) continue outer
    }
    hits.push(i)
  }
  return hits
}

/**
 * Translate `newLines` from the indentation the model used to the file's.
 * Each indentation the model wrote is paired with what the file really has on
 * the matched lines (e.g. 2 spaces → 4 spaces, or spaces → a tab), and the new
 * lines are re-indented by that table. An indentation the old text never used
 * is scaled from the nearest known one.
 */
function reindent(newLines: string[], modelOld: string[], fileOld: string[]): string[] {
  const table = new Map<string, string>()
  modelOld.forEach((l, i) => {
    if (l.trim() && fileOld[i] !== undefined && !table.has(indentOf(l))) table.set(indentOf(l), indentOf(fileOld[i]))
  })
  if ([...table].every(([m, f]) => m === f)) return newLines

  // Indentation unit in model and file (smallest non-zero step), for scaling.
  const steps = (xs: string[]) => xs.map((x) => x.length).filter((n) => n > 0)
  const modelUnit = Math.min(...steps([...table.keys()]), Infinity)
  const fileUnit = Math.min(...steps([...table.values()]), Infinity)
  const fileUnitStr = [...table.values()].find((v) => v.length === fileUnit) ?? '  '

  return newLines.map((l) => {
    if (!l.trim()) return l
    const ind = indentOf(l)
    const known = table.get(ind)
    if (known !== undefined) return known + l.slice(ind.length)
    if (Number.isFinite(modelUnit) && Number.isFinite(fileUnit) && modelUnit > 0) {
      const levels = Math.round(ind.length / modelUnit)
      return fileUnitStr.slice(0, fileUnit).repeat(levels) + l.slice(ind.length)
    }
    return l
  })
}

export function planEdit(content: string, oldStr: string, newStr: string): EditOutcome {
  // 1. Exact substring — also covers edits inside a single line.
  const exactAt = content.indexOf(oldStr)
  if (oldStr && exactAt !== -1) {
    const startLine = content.slice(0, exactAt).split('\n').length
    return {
      ok: true,
      plan: {
        // A function replacement: a string would expand "$&", "$1", … in newStr.
        content: content.slice(0, exactAt) + newStr + content.slice(exactAt + oldStr.length),
        startLine,
        oldLines: oldStr.split('\n'),
        newLines: newStr.split('\n'),
        strategy: 'exact',
      },
    }
  }

  // 2+. Line-based comparisons on normalised text.
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const fileLines = content.split(/\r?\n/)
  const rawOld = oldStr.split(/\r?\n/)
  const hadNumbers = stripLineNumbers(rawOld) !== rawOld
  const oldLines = trimBlankEdges(stripLineNumbers(rawOld))
  let newLines = newStr.split(/\r?\n/)
  if (hadNumbers) newLines = stripLineNumbers(newLines)
  newLines = trimBlankEdges(newLines)
  if (oldLines.length === 0) return { ok: false, reason: 'the text to replace is empty' }

  const strategies: Array<[EditPlan['strategy'], (a: string, b: string) => boolean]> = [
    ['lines', (a, b) => a === b],
    ['trailing-space', (a, b) => a.trimEnd() === b.trimEnd()],
    ['indentation', (a, b) => a.trim() === b.trim()],
  ]

  for (const [strategy, eq] of strategies) {
    const hits = findAll(fileLines, oldLines, eq)
    if (hits.length === 0) continue
    if (hits.length > 1) {
      return {
        ok: false,
        reason: `the text matches ${hits.length} places (lines ${hits.slice(0, 5).map((h) => h + 1).join(', ')}) — include more surrounding lines so it is unique`,
      }
    }
    const at = hits[0]
    const matched = fileLines.slice(at, at + oldLines.length)
    const replacement = strategy === 'indentation' ? reindent(newLines, oldLines, matched) : newLines
    const out = [...fileLines.slice(0, at), ...replacement, ...fileLines.slice(at + oldLines.length)]
    return {
      ok: true,
      plan: {
        content: out.join(eol),
        startLine: at + 1,
        oldLines: matched,
        newLines: replacement,
        strategy,
      },
    }
  }

  return { ok: false, reason: 'the text to replace was not found' }
}
