import React from 'react'
import { Box, Text } from 'ink'
import { Hint } from '../shared/keymap'
import { theme } from '../shared/theme'
import { fitItems } from '../shared/utils'

interface Props {
  width: number
  /** What the keys do right now — from footerHints(). */
  hints: Hint[]
  /** Replaces the left side while the agent works (the spinner line). */
  busy?: React.ReactNode
}

const GAP = 3
const hintW = (h: Hint) => h.keys.length + 1 + h.label.length

/**
 * The row under the prompt: what you can press right now — or, while the
 * agent works, the spinner on the left and how to stop it on the right.
 * Always one row; hints that don't fit are dropped from the end.
 */
export const Footer: React.FC<Props> = ({ width, hints, busy }) => {
  const usable = Math.max(0, width - 2)
  const shown = fitItems(hints, busy ? Math.floor(usable / 2) : usable, (h) => hintW(h) + GAP)
  const list = (
    <>
      {shown.map((h, i) => (
        <Text key={i}>
          {i > 0 ? ' '.repeat(GAP) : ''}
          <Text color={theme.textMuted}>{h.keys}</Text>
          <Text color={theme.textFaint}> {h.label}</Text>
        </Text>
      ))}
    </>
  )
  return (
    <Box width={width} paddingX={1} flexShrink={0}>
      <Box flexGrow={1} minWidth={0}>
        {busy ?? list}
      </Box>
      {busy ? <Box flexShrink={0}>{list}</Box> : null}
    </Box>
  )
}
