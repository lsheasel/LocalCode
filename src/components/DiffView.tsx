import React from 'react'
import { Box, Text } from 'ink'

interface Props {
  filePath: string
  oldLines: string[]
  newLines: string[]
  startLine: number
  contextBefore: string[]
  contextAfter: string[]
  isNew?: boolean
}

export const DiffView: React.FC<Props> = ({
  filePath, oldLines, newLines, startLine, contextBefore, contextAfter, isNew = false,
}) => {
  type DiffLine = { type: 'context' | 'removed' | 'added'; content: string; lineNo: number }
  const lines: DiffLine[] = []

  const ctxStart = startLine - contextBefore.length
  contextBefore.forEach((content, i) => {
    lines.push({ type: 'context', content, lineNo: ctxStart + i })
  })

  oldLines.forEach((content, i) => lines.push({ type: 'removed', content, lineNo: startLine + i }))
  newLines.forEach((content, i) => lines.push({ type: 'added',   content, lineNo: startLine + i }))

  const afterStart = startLine + Math.max(oldLines.length, newLines.length)
  contextAfter.forEach((content, i) => {
    lines.push({ type: 'context', content, lineNo: afterStart + i })
  })

  const added   = newLines.length
  const removed = oldLines.length
  const summary = [
    added   > 0 ? `Added ${added} line${added !== 1 ? 's' : ''}`     : '',
    removed > 0 ? `removed ${removed} line${removed !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ')

  // Normalise the path separator for display
  const displayPath = filePath.replace(/\\/g, '/')

  return (
    <Box flexDirection="column" marginY={0} marginX={1}>
      {/* ── Header ── */}
      <Box>
        <Text color={isNew ? "#22C55E" : "#F59E0B"}>● </Text>
        <Text color="#E5E7EB">{isNew ? "Create(" : "Update("}</Text>
        <Text color="#9CA3AF">{displayPath}</Text>
        <Text color="#E5E7EB">)</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="#4B5563">└  </Text>
        <Text color="#6B7280">{summary}</Text>
      </Box>

      {/* ── Diff lines ── */}
      <Box flexDirection="column" marginLeft={2} marginTop={0}>
        {lines.map((line, i) => {
          const num = String(line.lineNo).padStart(4)

          if (line.type === 'removed') {
            return (
              <Box key={i}>
                <Text color="#EF4444">{num} </Text>
                <Text color="#EF4444">- </Text>
                <Text backgroundColor="#3F0000" color="#FCA5A5">{line.content || ' '}</Text>
              </Box>
            )
          }
          if (line.type === 'added') {
            return (
              <Box key={i}>
                <Text color="#22C55E">{num} </Text>
                <Text color="#22C55E">+ </Text>
                <Text backgroundColor="#052e16" color="#86EFAC">{line.content || ' '}</Text>
              </Box>
            )
          }
          return (
            <Box key={i}>
              <Text color="#4B5563">{num} </Text>
              <Text color="#374151">  </Text>
              <Text color="#6B7280">{line.content}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
