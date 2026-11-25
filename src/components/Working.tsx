import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../shared/theme'
import { animationsOn, shimmer, useFrameTime } from '../shared/anim'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * "⠋ Thinking…  12s" — the one line that says the agent is busy. A soft light
 * sweeps across the label while it works. It ticks on its own so the rest of
 * the UI doesn't re-render.
 */
export const Working: React.FC<{ label: string; startedAt: number; detail?: string }> = ({
  label,
  startedAt,
  detail,
}) => {
  // With animations: the shared 30 fps ticker (the shimmer needs it).
  // Without: a plain clock for the spinner and the seconds.
  const animated = animationsOn()
  const frameNow = useFrameTime(animated)
  const [slowNow, setSlowNow] = useState(Date.now())
  useEffect(() => {
    if (animated) return
    const t = setInterval(() => setSlowNow(Date.now()), 80)
    return () => clearInterval(t)
  }, [animated])
  const now = animated ? frameNow : slowNow

  const frame = FRAMES[Math.floor(now / 80) % FRAMES.length]
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000))
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
  const text = `${label}…`
  const colors = shimmer(text.length, now - startedAt, animated ? theme.textMuted : theme.textBright, theme.primaryPale)

  return (
    <Box>
      <Box flexShrink={0}>
        <Text color={theme.primary}>{frame} </Text>
        <Text>
          {text.split('').map((ch, i) => (
            <Text key={i} color={colors[i]}>{ch}</Text>
          ))}
        </Text>
        <Text color={theme.textFaint}>  {elapsed}</Text>
      </Box>
      {detail ? (
        <Box flexGrow={1} minWidth={0} marginLeft={2}>
          <Text color={theme.textFaint} italic wrap="truncate-start">{detail}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
