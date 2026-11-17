import React from 'react'
import { Box, Text } from 'ink'
import { theme, ICON } from '../shared/theme'

// LocalCode's wordmark, drawn with the same thin line glyphs as the thread
// that runs down the transcript. Lowercase, four rows: an ascender row and a
// three-row x-height. Each letter is a column of equal-width strings.
const GLYPHS: Record<string, string[]> = {
  l: ['╷', '│', '│', '└'],
  o: ['   ', '┌─┐', '│ │', '└─┘'],
  c: ['   ', '┌─╴', '│  ', '└─╴'],
  a: ['   ', '┌─┐', '┌─┤', '└─┘'],
  d: ['  ╷', '┌─┤', '│ │', '└─┘'],
  e: ['   ', '┌─┐', '├─┘', '└─╴'],
}

function word(w: string): string[] {
  return [0, 1, 2, 3].map((row) => w.split('').map((ch) => GLYPHS[ch][row]).join(' '))
}

const LOCAL = word('local')
const CODE = word('code')
const GAP = '  '

/** Cells the full wordmark needs. */
export const LOGO_WIDTH = LOCAL[0].length + GAP.length + CODE[0].length
/** Rows the full wordmark needs, tagline included. */
export const LOGO_HEIGHT = LOCAL.length + 2

/** The wordmark with its tagline, or a one-line mark when space is short. */
export const Logo: React.FC<{ big: boolean }> = ({ big }) =>
  big ? (
    <Box flexDirection="column" alignItems="center" flexShrink={0}>
      {LOCAL.map((row, i) => (
        <Text key={i}>
          <Text color={theme.textBright}>{row}</Text>
          <Text>{GAP}</Text>
          <Text color={theme.primary}>{CODE[i]}</Text>
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color={theme.textFaint}>your code, your machine</Text>
      </Box>
    </Box>
  ) : (
    <Box flexShrink={0}>
      <Text color={theme.primary}>{ICON.you} </Text>
      <Text color={theme.textBright} bold>local</Text>
      <Text color={theme.primary} bold>code</Text>
    </Box>
  )

const TIPS = [
  'Start inside a project folder so the agent has codebase context',
  'Run a shell command directly with $ — e.g.  $ npm test',
  'Type @ to attach a file, e.g.  @src/app.ts explain this',
  'Use /model to switch to another model on the running server',
  'Tab switches between build, plan and debug mode',
  '/compact summarizes a long conversation to free up context',
  '/session save <name> bookmarks a conversation; /session load resumes it',
  '/doctor checks the connection to your model server',
  'Plan first: in plan mode the agent reads your code and writes a plan',
]

/** One tip per day, as a single row cut to `width`. */
export const Tip: React.FC<{ width: number }> = ({ width }) => (
  <Box width={width} justifyContent="center" flexShrink={0}>
    <Text wrap="truncate-end">
      <Text color={theme.warn}>tip  </Text>
      <Text color={theme.textFaint}>{TIPS[new Date().getDate() % TIPS.length]}</Text>
    </Text>
  </Box>
)
