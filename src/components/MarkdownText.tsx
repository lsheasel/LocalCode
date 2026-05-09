import React from 'react'
import { Box, Text } from 'ink'

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
        if (p.code)   return <Text key={i} color="#7DD3FC">{p.t}</Text>
        if (p.bold)   return <Text key={i} bold color="#E5E7EB">{p.t}</Text>
        if (p.italic) return <Text key={i} color="#D1D5DB" italic>{p.t}</Text>
        return <Text key={i} color="#D1D5DB">{p.t}</Text>
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

  const flushCode = (key: string) => {
    nodes.push(
      <Box key={key} flexDirection="column">
        {codeLang && (
          <Box>
            <Text color="#1D4ED8">  ┌─ </Text>
            <Text color="#60A5FA">{codeLang}</Text>
          </Box>
        )}
        {codeLines.map((l, i) => (
          <Box key={i}>
            <Text color="#374151">  │ </Text>
            <Text color="#7DD3FC" wrap="wrap">{l || ' '}</Text>
          </Box>
        ))}
        <Text color="#1D4ED8">  └{'─'.repeat(Math.min(40, Math.max(8, ...codeLines.map(l => l.length + 1))))}</Text>
      </Box>
    )
    codeLines = []
    codeLang = ''
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (!inCode) { inCode = true; codeLang = line.slice(3).trim() }
      else         { inCode = false; flushCode(`c${i}`) }
      continue
    }
    if (inCode) { codeLines.push(line); continue }

    if (line.startsWith('### ')) {
      nodes.push(<Text key={i} bold color="#93C5FD" wrap="wrap">{line.slice(4)}</Text>)
    } else if (line.startsWith('## ')) {
      nodes.push(<Text key={i} bold color="#60A5FA" wrap="wrap">{line.slice(3)}</Text>)
    } else if (line.startsWith('# ')) {
      nodes.push(<Text key={i} bold color="#3B82F6" wrap="wrap">{line.slice(2)}</Text>)
    } else if (/^[-*+] /.test(line)) {
      nodes.push(
        <Box key={i}>
          <Text color="#6B7280">  • </Text>
          <Box flexWrap="wrap"><InlinePart text={line.slice(2)} /></Box>
        </Box>
      )
    } else if (/^\d+\. /.test(line)) {
      const m = line.match(/^(\d+)\. (.*)/)!
      nodes.push(
        <Box key={i}>
          <Text color="#6B7280">  {m[1]}. </Text>
          <Box flexWrap="wrap"><InlinePart text={m[2]} /></Box>
        </Box>
      )
    } else if (/^---+$/.test(line.trim())) {
      nodes.push(<Text key={i} color="#374151">{'─'.repeat(48)}</Text>)
    } else if (!line.trim()) {
      nodes.push(<Text key={i}>{' '}</Text>)
    } else {
      nodes.push(
        <Box key={i} flexWrap="wrap"><InlinePart text={line} /></Box>
      )
    }
  }

  if (inCode && codeLines.length) flushCode('end')

  return <Box flexDirection="column">{nodes}</Box>
}
