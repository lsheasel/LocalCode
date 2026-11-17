import React from 'react'
import { Box, Text } from 'ink'
import { relative, isAbsolute } from 'path'
import { theme, space, ICON } from '../shared/theme'
import { truncStart } from '../shared/utils'

interface Props {
  filePath: string
  oldLines: string[]
  newLines: string[]
  startLine: number
  contextBefore: string[]
  contextAfter: string[]
  isNew?: boolean
  maxLines?: number
  /** Width available to the diff, for shortening the file path. */
  width?: number
  /** Only the changed lines — the transcript thread draws its own header. */
  bodyOnly?: boolean
}

// Hard ceiling so a giant file create never renders hundreds of nodes.
const DIFF_HARD_CAP = 200

export const DiffView: React.FC<Props> = ({
  filePath, oldLines, newLines, startLine, contextBefore, contextAfter, isNew = false, maxLines,
  width = process.stdout.columns || 80,
  bodyOnly = false,
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

  const cap = Math.max(4, Math.min(maxLines ?? DIFF_HARD_CAP, DIFF_HARD_CAP))
  const hiddenLines = lines.length > cap ? lines.length - cap : 0
  const shownLines = hiddenLines > 0 ? lines.slice(0, cap) : lines

  // Size the gutter to the widest line number actually shown, so files with
  // five-digit line numbers don't push the diff body out of alignment.
  const gutterW = Math.max(
    4,
    ...shownLines.map(l => String(l.lineNo).length),
  )

  const added   = newLines.length
  const removed = oldLines.length
  const summary = isNew
    ? `${added} line${added !== 1 ? 's' : ''}`
    : [
        added   > 0 ? `Added ${added} line${added !== 1 ? 's' : ''}`     : '',
        removed > 0 ? `${added > 0 ? 'removed' : 'Removed'} ${removed} line${removed !== 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(', ')

  // Relative to the project when the file is inside it; shortened from the
  // left to fit one row ("● Update  " and the margins cost 12 columns).
  const rel = isAbsolute(filePath) ? relative(process.cwd(), filePath) : filePath
  const shown = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : filePath
  const displayPath = truncStart(shown.replace(/\\/g, '/'), Math.max(10, width - 12))

  return (
    <Box flexDirection="column" flexShrink={0} marginX={bodyOnly ? 0 : space.rowX}>
      {/* Header: same shape as every other tool entry — "● Verb  target". */}
      {!bodyOnly && <Box>
        <Box flexShrink={0} width={2}>
          <Text color={theme.textFaint}>{ICON.tool}</Text>
        </Box>
        <Text color={theme.text}>{isNew ? 'Create' : 'Update'}</Text>
        <Text color={theme.textDim}>  {displayPath}</Text>
      </Box>}
      {!bodyOnly && <Box>
        <Text color={theme.textGhost}>  {ICON.result}  </Text>
        <Text color={theme.textDim}>{summary}</Text>
      </Box>}

      {/* Diff lines: line number, sign, then the line on a tinted background. */}
      <Box flexDirection="column" paddingLeft={bodyOnly ? 1 : 5}>
        {shownLines.map((line, i) => {
          const num = String(line.lineNo).padStart(gutterW)

          if (line.type === 'removed') {
            return (
              <Box key={i}>
                <Text color={theme.textFaint}>{num} </Text>
                <Text backgroundColor={theme.diffDelBg} color={theme.diffDelFg} wrap="truncate-end">- {line.content || ' '}</Text>
              </Box>
            )
          }
          if (line.type === 'added') {
            return (
              <Box key={i}>
                <Text color={theme.textFaint}>{num} </Text>
                <Text backgroundColor={theme.diffAddBg} color={theme.diffAddFg} wrap="truncate-end">+ {line.content || ' '}</Text>
              </Box>
            )
          }
          return (
            <Box key={i}>
              <Text color={theme.textGhost}>{num} </Text>
              <Text color={theme.textDim} wrap="truncate-end">  {line.content}</Text>
            </Box>
          )
        })}
        {hiddenLines > 0 && (
          <Text color={theme.textFaint}>
            {' '.repeat(gutterW + 1)}{ICON.ellipsis} {hiddenLines} more line{hiddenLines !== 1 ? 's' : ''}
          </Text>
        )}
      </Box>
    </Box>
  )
}
