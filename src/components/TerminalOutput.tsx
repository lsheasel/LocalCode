import React from 'react'
import { Box, Text } from 'ink'

interface Props {
  lines: string[]
  maxLines?: number
}

function clean(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[mGKHF]/g, '').replace(/\r/g, '').trimEnd()
}

export const TerminalOutput: React.FC<Props> = ({ lines, maxLines = 5 }) => {
  const cols = process.stdout.columns || 80
  const display = lines.slice(-maxLines)

  return (
    <Box flexDirection="column">
      <Text color="#1E3A8A">{'─'.repeat(cols)}</Text>
      <Text color="#3B82F6" bold> ▸ Shell</Text>
      {display.length === 0 ? (
        <Text color="#374151">  prefix with $ to run shell commands directly</Text>
      ) : (
        display.map((line, i) => (
          <Text key={i} color="#9CA3AF" wrap="truncate-end">
            {'  '}{clean(line).slice(0, cols - 3)}
          </Text>
        ))
      )}
    </Box>
  )
}
