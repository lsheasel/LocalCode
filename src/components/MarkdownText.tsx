import React from 'react'
import { Box, Text } from 'ink'
import { theme, ICON } from '../shared/theme'
import { highlight, TokenKind } from '../shared/highlight'

const SYNTAX_COLOR: Record<TokenKind, string> = {
  plain: theme.synPlain,
  keyword: theme.synKeyword,
  string: theme.synString,
  comment: theme.synComment,
  number: theme.synNumber,
  type: theme.synType,
  func: theme.synFunc,
  punct: theme.synPunct,
}

function stripInlineMarkers(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/\*(.*?)\*/g, '$1')
}

// ── Inline formatter: `code`, **bold**, *italic* ──────────────────────────────
const InlinePart: React.FC<{ text: string }> = ({ text }) => {
  type Seg = { t: string; code?: true; bold?: true; italic?: true }
  const parts: Seg[] = []
  let rem = text

  while (rem) {
    const cm = rem.match(/^`([^`]*)`/)
    if (cm) { parts.push({ t: cm[1], code: true }); rem = rem.slice(cm[0].length); continue }

    const bm = rem.match(/^\*\*([^*]+)\*\*/)
    if (bm) { parts.push({ t: bm[1], bold: true }); rem = rem.slice(bm[0].length); continue }

    const im = rem.match(/^\*([^*]+)\*/)
    if (im) { parts.push({ t: im[1], italic: true }); rem = rem.slice(im[0].length); continue }

    const next = rem.search(/`|\*\*|\*(?!\*)/)
    if (next === -1) { parts.push({ t: rem }); break }
    if (next === 0)  { parts.push({ t: rem[0] }); rem = rem.slice(1); continue }
    parts.push({ t: rem.slice(0, next) }); rem = rem.slice(next)
  }

  return (
    <>
      {parts.map((p, i) => {
        if (p.code)   return <Text key={i} color={theme.accent}>{p.t}</Text>
        if (p.bold)   return <Text key={i} bold color={theme.textBright}>{p.t}</Text>
        if (p.italic) return <Text key={i} color={theme.text} italic>{p.t}</Text>
        return <Text key={i} color={theme.text}>{p.t}</Text>
      })}
    </>
  )
}

// ── Full Markdown renderer ────────────────────────────────────────────────────
export const MarkdownText: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n')
  const nodes: React.ReactNode[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []
  let tableRowIdx = 0

  const flushCode = (key: string) => {
    const tokens = highlight(codeLines, codeLang)
    nodes.push(
      <Box key={key} flexDirection="column">
        {codeLang && (
          <Box>
            <Text color={theme.primaryDeep}>  {ICON.branchStart}─ </Text>
            <Text color={theme.primaryBright}>{codeLang}</Text>
          </Box>
        )}
        {tokens.map((line, i) => (
          <Box key={i}>
            <Box flexShrink={0}>
              <Text color={theme.textGhost}>  {ICON.rail} </Text>
            </Box>
            <Text wrap="wrap">
              {line.length === 0
                ? ' '
                : line.map((t, j) => (
                    <Text key={j} color={SYNTAX_COLOR[t.kind]} italic={t.kind === 'comment'}>
                      {t.text}
                    </Text>
                  ))}
            </Text>
          </Box>
        ))}
        <Text color={theme.primaryDeep}>  {ICON.branchEnd}{'─'.repeat(Math.min(40, Math.max(8, ...codeLines.map(l => l.length + 1))))}</Text>
      </Box>
    )
    codeLines = []
    codeLang = ''
  }

  // Nested list items keep their indentation, so sub-points sit under
  // their parent instead of starting at the left edge again.
  const listIndent = (raw: string) => {
    const lead = raw.length - raw.trimStart().length
    const width = raw.slice(0, lead).replace(/\t/g, '  ').length
    return ' '.repeat(Math.min(8, width))
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()

    if (trimmed.startsWith('```')) {
      if (!inCode) { inCode = true; codeLang = trimmed.slice(3).trim() }
      else         { inCode = false; flushCode(`c${i}`) }
      continue
    }
    if (inCode) { codeLines.push(line); continue }

    // Table row: | col | col |
    if (/^\s*\|/.test(line) && /\|/.test(trimmed.slice(1))) {
      const isSep = /^[\s|:-]+$/.test(trimmed)
      if (isSep) { tableRowIdx = 0; continue }
      const isHeader = tableRowIdx === 0
      const cols = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      tableRowIdx++
      nodes.push(
        <Box key={i}>
          {cols.map((col, ci) => (
            <Box key={ci} marginRight={2}>
              <Text color={isHeader ? theme.primaryLight : theme.text} bold={isHeader} wrap="truncate-end">
                <InlinePart text={col} />
              </Text>
            </Box>
          ))}
        </Box>
      )
    } else {
      tableRowIdx = 0
      if (trimmed.startsWith('### ')) {
        nodes.push(<Text key={i} bold color={theme.primaryLight} wrap="wrap">{stripInlineMarkers(trimmed.slice(4))}</Text>)
      } else if (trimmed.startsWith('## ')) {
        nodes.push(<Text key={i} bold color={theme.primaryBright} wrap="wrap">{stripInlineMarkers(trimmed.slice(3))}</Text>)
      } else if (trimmed.startsWith('# ')) {
        nodes.push(<Text key={i} bold color={theme.primary} wrap="wrap">{stripInlineMarkers(trimmed.slice(2))}</Text>)
      } else if (/^[-*+] /.test(trimmed)) {
        nodes.push(
          <Box key={i}>
            <Text color={theme.textDim}>{listIndent(line)}  {ICON.bullet} </Text>
            <Box flexGrow={1}><Text wrap="wrap"><InlinePart text={trimmed.slice(2)} /></Text></Box>
          </Box>
        )
      } else if (/^\d+\. /.test(trimmed)) {
        const m = trimmed.match(/^(\d+)\. (.*)/)!
        nodes.push(
          <Box key={i}>
            <Text color={theme.textDim}>{listIndent(line)}  {m[1]}. </Text>
            <Box flexGrow={1}><Text wrap="wrap"><InlinePart text={m[2]} /></Text></Box>
          </Box>
        )
      } else if (/^---+$/.test(trimmed)) {
        nodes.push(<Text key={i} color={theme.textFaint} wrap="truncate-end">{'─'.repeat(48)}</Text>)
      } else if (!trimmed) {
        nodes.push(<Text key={i}>{' '}</Text>)
      } else {
        nodes.push(<Text key={i} wrap="wrap"><InlinePart text={trimmed} /></Text>)
      }
    }
  }

  if (inCode && codeLines.length) flushCode('end')

  return <Box flexDirection="column">{nodes}</Box>
}
