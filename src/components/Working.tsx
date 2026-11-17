import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../shared/theme'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * "⠋ Thinking…  12s  ctrl+c to stop" — the one line that says the agent is
 * busy. It ticks on its own so the rest of the UI doesn't re-render.
 */
export const Working: React.FC<{ label: string; startedAt: number; detail?: string }> = ({
  label,
  startedAt,
  detail,
}) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 80)
    return () => clearInterval(t)
  }, [])

  const frame = FRAMES[Math.floor(now / 80) % FRAMES.length]
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000))
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`

  return (
    <Box>
      <Box flexShrink={0}>
        <Text color={theme.primary}>{frame} </Text>
        <Text color={theme.textBright}>{label}…</Text>
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
