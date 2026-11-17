// A small syntax highlighter for code blocks in answers — no dependency, no
// grammar files. It knows comments, strings, numbers, keywords, types and
// function calls for the languages local coding models write most; anything
// else falls back to a C-like rule set. Good enough to make code scannable;
// not a parser.

export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'func' | 'punct'

export interface Token {
  text: string
  kind: TokenKind
}

interface Lang {
  keywords: Set<string>
  /** Line comment starters, e.g. "//" or "#". */
  lineComment: string[]
  /** Block comments, e.g. ["/*", "*\/"]. */
  block?: [string, string]
  /** Identifiers starting with an uppercase letter are types. */
  pascalTypes: boolean
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const JS = words(`
  const let var function return if else for while do switch case default break continue new delete typeof
  instanceof in of class extends super this import export from as async await yield try catch finally throw
  null undefined true false void interface type enum implements public private protected readonly static
  abstract declare namespace keyof infer satisfies`)
const PY = words(`
  def return if elif else for while in not and or is class import from as with try except finally raise
  pass break continue lambda yield global nonlocal assert del None True False async await self match case`)
const GO = words(`
  func return if else for range switch case default break continue go defer select chan map struct interface
  package import type var const nil true false fallthrough goto`)
const RUST = words(`
  fn let mut return if else for while loop in match impl trait struct enum pub use mod crate self super as
  where move ref const static unsafe async await dyn true false Some None Ok Err type`)
const SH = words(`
  if then else elif fi for in do done while until case esac function return export local echo exit set unset
  source cd`)
const C_LIKE = words(`
  int long short char float double bool void return if else for while do switch case default break continue
  new delete class struct public private protected static const true false null nullptr this namespace using
  try catch throw import package`)

const LANGS: Record<string, Lang> = {
  js: { keywords: JS, lineComment: ['//'], block: ['/*', '*/'], pascalTypes: true },
  py: { keywords: PY, lineComment: ['#'], pascalTypes: true },
  go: { keywords: GO, lineComment: ['//'], block: ['/*', '*/'], pascalTypes: true },
  rust: { keywords: RUST, lineComment: ['//'], block: ['/*', '*/'], pascalTypes: true },
  sh: { keywords: SH, lineComment: ['#'], pascalTypes: false },
  json: { keywords: words('true false null'), lineComment: [], pascalTypes: false },
  css: { keywords: words('important'), lineComment: [], block: ['/*', '*/'], pascalTypes: false },
  c: { keywords: C_LIKE, lineComment: ['//'], block: ['/*', '*/'], pascalTypes: true },
}

const ALIASES: Record<string, string> = {
  javascript: 'js', jsx: 'js', ts: 'js', tsx: 'js', typescript: 'js', mjs: 'js', cjs: 'js',
  python: 'py', golang: 'go', rs: 'rust', bash: 'sh', shell: 'sh', zsh: 'sh', powershell: 'sh', ps1: 'sh',
  scss: 'css', jsonc: 'json', java: 'c', cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', kotlin: 'c', swift: 'c',
}

function langFor(name: string): Lang {
  const key = name.toLowerCase().trim()
  return LANGS[ALIASES[key] ?? key] ?? LANGS.c
}

/**
 * Highlight a code block. Returns one token list per line; block comments
 * and multi-line strings carry over from line to line.
 */
export function highlight(code: string[], language: string): Token[][] {
  const lang = langFor(language)
  let inBlock = false
  let inTriple: string | null = null // Python """ / ''' and JS template strings
  return code.map((line) => {
    const out: Token[] = []
    const push = (text: string, kind: TokenKind) => {
      if (!text) return
      const last = out[out.length - 1]
      if (last && last.kind === kind) last.text += text
      else out.push({ text, kind })
    }
    let i = 0
    while (i < line.length) {
      const rest = line.slice(i)

      if (inBlock && lang.block) {
        const end = rest.indexOf(lang.block[1])
        if (end === -1) { push(rest, 'comment'); break }
        push(rest.slice(0, end + lang.block[1].length), 'comment')
        i += end + lang.block[1].length
        inBlock = false
        continue
      }
      if (inTriple) {
        const end = rest.indexOf(inTriple)
        if (end === -1) { push(rest, 'string'); break }
        push(rest.slice(0, end + inTriple.length), 'string')
        i += end + inTriple.length
        inTriple = null
        continue
      }

      if (lang.block && rest.startsWith(lang.block[0])) {
        inBlock = true
        push(lang.block[0], 'comment')
        i += lang.block[0].length
        continue
      }
      if (lang.lineComment.some((c) => rest.startsWith(c))) {
        push(rest, 'comment')
        break
      }

      const triple = rest.startsWith('"""') ? '"""' : rest.startsWith("'''") ? "'''" : null
      if (triple || rest[0] === '`') {
        const q = triple ?? '`'
        const end = rest.indexOf(q, q.length)
        if (end === -1) { inTriple = q; push(rest, 'string'); break }
        push(rest.slice(0, end + q.length), 'string')
        i += end + q.length
        continue
      }
      if (rest[0] === '"' || rest[0] === "'") {
        const q = rest[0]
        let j = 1
        while (j < rest.length && rest[j] !== q) j += rest[j] === '\\' ? 2 : 1
        push(rest.slice(0, j + 1), 'string')
        i += j + 1
        continue
      }

      const num = /^(0x[\da-f_]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)\b/i.exec(rest)
      if (num) { push(num[0], 'number'); i += num[0].length; continue }

      const ident = /^[A-Za-z_$][\w$]*/.exec(rest)
      if (ident) {
        const w = ident[0]
        const after = line.slice(i + w.length)
        const kind: TokenKind =
          lang.keywords.has(w) ? 'keyword'
          : /^\s*\(/.test(after) ? 'func'
          : lang.pascalTypes && /^[A-Z][a-z0-9]/.test(w) ? 'type'
          : 'plain'
        push(w, kind)
        i += w.length
        continue
      }

      push(rest[0], /[{}()[\];,.:<>=+\-*/%!&|^~?@]/.test(rest[0]) ? 'punct' : 'plain')
      i++
    }
    return out
  })
}
