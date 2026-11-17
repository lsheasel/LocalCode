import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../shared/theme'

export interface Label {
  text: string
  color?: string
  bold?: boolean
}

const len = (ls: Label[]) => ls.reduce((n, l) => n + l.text.length, 0)

const Labels: React.FC<{ items: Label[] }> = ({ items }) => (
  <>
    {items.map((l, i) => (
      <Text key={i} color={l.color ?? theme.textMuted} bold={l.bold}>{l.text}</Text>
    ))}
  </>
)

/**
 * A rounded frame with its labels set into the border, like a form fieldset:
 *
 *   ┌─ build ──────────────── qwen3.5-9b  lm studio ─┐
 *   │ content                                        │
 *   └───────────────────────────────── LocalCode:main ─┘
 *
 * Labels that don't fit are dropped (right first), never wrapped.
 */
export const Fieldset: React.FC<{
  width: number
  color: string
  title?: Label[]
  right?: Label[]
  footer?: Label[]
  children: React.ReactNode
}> = ({ width, color, title = [], right = [], footer = [], children }) => {
  const w = Math.max(6, width)
  // ┌─ title ─…─ right ─┐  — fixed cost: "┌─ " + " " + " ─┐" around the labels
  const titleW = len(title)
  const showRight = right.length > 0 && titleW + len(right) + 9 <= w
  const topFill = w - 2 - (titleW ? titleW + 3 : 0) - (showRight ? len(right) + 3 : 0)
  const showFooter = footer.length > 0 && len(footer) + 6 <= w
  const bottomFill = w - 2 - (showFooter ? len(footer) + 3 : 0)

  return (
    <Box flexDirection="column" width={w} flexShrink={0}>
      <Text wrap="truncate-end">
        <Text color={color}>{titleW ? '┌─ ' : '┌'}</Text>
        <Labels items={title} />
        <Text color={color}>{titleW ? ' ' : ''}{'─'.repeat(Math.max(0, topFill))}</Text>
        {showRight && (
          <>
            <Text> </Text>
            <Labels items={right} />
            <Text color={color}> ─</Text>
          </>
        )}
        <Text color={color}>┐</Text>
      </Text>
      <Box
        flexDirection="column"
        width={w}
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderColor={color}
        paddingX={1}
      >
        {children}
      </Box>
      <Text wrap="truncate-end">
        <Text color={color}>└{'─'.repeat(Math.max(0, bottomFill))}</Text>
        {showFooter && (
          <>
            <Text> </Text>
            <Labels items={footer} />
            <Text color={color}> ─</Text>
          </>
        )}
        <Text color={color}>┘</Text>
      </Text>
    </Box>
  )
}
