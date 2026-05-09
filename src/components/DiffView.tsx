import React from 'react'
import { Box, Text } from 'ink'

interface Props {
  filePath: string
  oldLines: string[]
  newLines: string[]
  startLine: number
  contextBefore: string[]
  contextAfter: string[]
}

export const DiffView: React.FC<Props> = ({
  filePath, oldLines, newLines, startLine, contextBefore, contextAfter,
}) => {
  type DiffLine = { type: 'context' | 'removed' | 'added'; content: string; left: number | null; right: number | null }
  const lines: DiffLine[] = []

  const ctxStart = startLine - contextBefore.length
  contextBefore.forEach((content, i) => {
    const n = ctxStart + i
    lines.push({ type: 'context', content, left: n, right: n })
  })

  let leftN = startLine
  let rightN = startLine
  oldLines.forEach(content => lines.push({ type: 'removed', content, left: leftN++, right: null }))
  newLines.forEach(content => lines.push({ type: 'added', content, left: null, right: rightN++ }))

  contextAfter.forEach((content, i) => {
    lines.push({ type: 'context', content, left: leftN + i, right: rightN + i })
  })

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} paddingLeft={2}>
      <Box>
        <Text color="#6B7280">Edit </Text>
        <Text color="#9CA3AF">{filePath}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor="#374151">
        {lines.map((line, i) => {
          const lStr = line.left !== null ? String(line.left).padStart(3) : '   '
          const rStr = line.right !== null ? String(line.right).padStart(3) : '   '
          if (line.type === 'removed') {
            return (
              <Box key={i}>
                <Text color="#EF4444">{lStr} </Text>
                <Text color="#374151">    </Text>
                <Text color="#EF4444">- </Text>
                <Text color="#FCA5A5">{line.content}</Text>
              </Box>
            )
          }
          if (line.type === 'added') {
            return (
              <Box key={i}>
                <Text color="#374151">    </Text>
                <Text color="#22C55E">{rStr} </Text>
                <Text color="#22C55E">+ </Text>
                <Text color="#86EFAC">{line.content}</Text>
              </Box>
            )
          }
          return (
            <Box key={i}>
              <Text color="#4B5563">{lStr}  {rStr}  </Text>
              <Text color="#6B7280">{line.content}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
