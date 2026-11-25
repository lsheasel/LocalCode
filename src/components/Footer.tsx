import React from 'react'
import { Box, Text } from 'ink'
import { Hint } from '../shared/keymap'
import { theme, ICON } from '../shared/theme'
import { fitItems } from '../shared/utils'
import { useHitbox } from '../shared/mouse'
import { animationsOn, mix, useGlow, useTween } from '../shared/anim'

interface Props {
  width: number
  /** What the keys do right now — from footerHints(). */
  hints: Hint[]
  /** Replaces the left side while the agent works (the spinner line). */
  busy?: React.ReactNode
  /** A hint was clicked: do what its key does. */
  onHint?: (hint: Hint) => void
  /** A short confirmation ("copied 42 characters") that fades away. */
  flash?: { id: number; text: string } | null
}

const GAP = 3
const hintW = (h: Hint) => h.keys.length + 1 + h.label.length

/** One hint; it lights up under the mouse and a click presses its key. */
const HintItem: React.FC<{ hint: Hint; first: boolean; onClick?: () => void }> = ({ hint, first, onClick }) => {
  const [ref, hover] = useHitbox({ onClick, disabled: !onClick })
  const t = useTween(hover ? 1 : 0, 120)
  return (
    <Box ref={ref} flexShrink={0} marginLeft={first ? 0 : GAP}>
      <Text>
        <Text color={mix(theme.textMuted, theme.primaryBright, t)}>{hint.keys}</Text>
        <Text color={mix(theme.textFaint, theme.text, t)}> {hint.label}</Text>
      </Text>
    </Box>
  )
}

/** "✓ copied 42 characters", bright at first, then gone. */
const Flash: React.FC<{ text: string }> = ({ text }) => {
  const g = useGlow(true, 2200)
  const color = animationsOn() ? mix(theme.textFaint, theme.success, g) : theme.success
  return (
    <Text color={color}>
      {ICON.ok} {text}
    </Text>
  )
}

/**
 * The row under the prompt: what you can press right now — or, while the
 * agent works, the spinner on the left and how to stop it on the right.
 * Always one row; hints that don't fit are dropped from the end.
 */
export const Footer: React.FC<Props> = ({ width, hints, busy, onHint, flash }) => {
  const usable = Math.max(0, width - 2)
  const flashW = flash ? flash.text.length + 4 : 0
  const shown = fitItems(hints, (busy ? Math.floor(usable / 2) : usable) - flashW, (h) => hintW(h) + GAP)
  const list = (
    <Box>
      {shown.map((h, i) => (
        <HintItem key={`${h.keys}:${h.label}`} hint={h} first={i === 0} onClick={onHint ? () => onHint(h) : undefined} />
      ))}
    </Box>
  )
  return (
    <Box width={width} paddingX={1} flexShrink={0}>
      <Box flexGrow={1} minWidth={0}>
        {busy ?? list}
      </Box>
      {busy ? <Box flexShrink={0}>{list}</Box> : null}
      {flash ? (
        <Box flexShrink={0} marginLeft={2}>
          <Flash key={flash.id} text={flash.text} />
        </Box>
      ) : null}
    </Box>
  )
}
