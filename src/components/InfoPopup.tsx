import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../shared/theme'
import { Fieldset } from './Fieldset'

interface InfoPopupProps {
  title: string
  content: string
  scroll: number
  /** Most rows the popup may take, frame included. */
  maxRows: number
  termCols: number
}

/** Rows the frame costs: the top and bottom border (labels sit in them). */
export const INFO_FRAME_ROWS = 2

function renderLine(line: string, i: number, termCols: number): React.ReactElement {
  const maxW = termCols - 8
  if (!line.trim()) return <Text key={i}> </Text>

  if (/^\*\*.+\*\*$/.test(line.trim())) {
    return <Text key={i} color={theme.textBright} bold wrap="truncate-end">{line.replace(/\*\*/g, '')}</Text>
  }

  const isKv = /^\s{2}\S.*\s:\s/.test(line)
  if (isKv) {
    const ci = line.indexOf(' : ')
    return (
      <Box key={i}>
        <Text wrap="truncate-end">
          <Text color={theme.textDim}>{line.slice(0, ci)} </Text>
          <Text color={theme.textGhost}>: </Text>
          <Text color={theme.textBright}>{line.slice(ci + 3)}</Text>
        </Text>
      </Box>
    )
  }

  if (/^\s{2}[/$!\\]/.test(line)) {
    const si = line.search(/\s{2,}/)
    const cmd  = si > 0 ? line.slice(0, si) : line
    const desc = si > 0 ? line.slice(si).trim() : ''
    return (
      <Box key={i}>
        <Text wrap="truncate-end">
          <Text color={theme.primary}>{cmd}</Text>
          {desc ? <Text color={theme.textFaint}>  {desc}</Text> : null}
        </Text>
      </Box>
    )
  }

  if (/^\s{2}\S/.test(line)) {
    return <Text key={i} color={theme.textMuted} wrap="truncate-end">{line.slice(0, maxW)}</Text>
  }

  return <Text key={i} color={theme.text} wrap="truncate-end">{line.slice(0, maxW)}</Text>
}

export const InfoPopup: React.FC<InfoPopupProps> = ({ title, content, scroll, maxRows, termCols }) => {
  const lines = content.split('\n')
  // As tall as the content, but never taller than the space it was given.
  const bodyH = Math.max(1, Math.min(lines.length, maxRows - INFO_FRAME_ROWS))
  const clamped = Math.min(scroll, Math.max(0, lines.length - bodyH))
  const visible = lines.slice(clamped, clamped + bodyH)
  const scrolls = lines.length > bodyH
  const position = scrolls ? `${clamped + 1}–${clamped + visible.length} of ${lines.length}` : ''

  return (
    <Fieldset
      width={termCols}
      color={theme.borderSubtle}
      title={[{ text: title.toLowerCase(), color: theme.primary }]}
      right={position ? [{ text: position, color: theme.textFaint }] : []}
      footer={[
        ...(scrolls
          ? [
              { text: '↑↓ PgUp PgDn', color: theme.textMuted },
              { text: ' scroll   ', color: theme.textFaint },
            ]
          : []),
        { text: 'esc', color: theme.textMuted },
        { text: ' close', color: theme.textFaint },
      ]}
    >
      {visible.map((line, i) => renderLine(line, i, termCols))}
    </Fieldset>
  )
}
