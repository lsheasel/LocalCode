import React from 'react'
import { Box, Text } from 'ink'
import { layoutRows, cursorRowCol } from '../shared/lineEditor'
import { theme } from '../shared/theme'

interface Props {
  value: string
  cursor: number
  /** Cells available for text. */
  width: number
  /** Most rows shown; beyond that the view follows the cursor. */
  maxRows: number
  placeholder: string
  /** Inline completion shown after the text, in a ghost colour. */
  ghost?: string
  focused: boolean
}

/** Rows the editor will take for `value` — the layout reserves exactly this. */
export function promptEditorRows(value: string, width: number, maxRows: number): number {
  const n = layoutRows(value, Math.max(1, width - 1)).length
  // Past maxRows a "↑/↓ n more" line is added.
  return n > maxRows ? maxRows + 1 : Math.max(1, n)
}

/**
 * The prompt's text: wrapped to the width, grows up to `maxRows`, then
 * scrolls to keep the cursor in view. The cursor is drawn as an inverted cell.
 */
export const PromptEditor: React.FC<Props> = ({ value, cursor, width, maxRows, placeholder, ghost, focused }) => {
  // One cell stays free at the end of each row for the cursor.
  const textW = Math.max(1, width - 1)

  if (!value) {
    return (
      <Text wrap="truncate-end">
        {focused ? <Text inverse>{placeholder.slice(0, 1) || ' '}</Text> : <Text color={theme.textFaint}>{placeholder.slice(0, 1)}</Text>}
        <Text color={theme.textFaint}>{placeholder.slice(1)}</Text>
      </Text>
    )
  }

  const rows = layoutRows(value, textW)
  const at = cursorRowCol(rows, cursor)
  const visible = Math.min(maxRows, rows.length)
  // Keep the cursor's row inside the window.
  const top = Math.max(0, Math.min(at.row - visible + 1, rows.length - visible))
  const shown = rows.slice(top, top + visible)

  return (
    <Box flexDirection="column">
      {shown.map((r, i) => {
        const rowIdx = top + i
        const isCursorRow = focused && rowIdx === at.row
        const isLast = rowIdx === rows.length - 1
        if (!isCursorRow) {
          return (
            <Text key={rowIdx} color={theme.textBright}>
              {r.text || ' '}
              {isLast && ghost ? <Text color={theme.textShadow}>{ghost}</Text> : null}
            </Text>
          )
        }
        const before = r.text.slice(0, at.col)
        const under = r.text.slice(at.col, at.col + 1) || ' '
        const after = r.text.slice(at.col + 1)
        return (
          <Text key={rowIdx} wrap="truncate-end">
            <Text color={theme.textBright}>{before}</Text>
            <Text inverse>{under}</Text>
            <Text color={theme.textBright}>{after}</Text>
            {isLast && ghost ? <Text color={theme.textShadow}>{ghost}</Text> : null}
          </Text>
        )
      })}
      {rows.length > visible && (
        <Text color={theme.textFaint}>
          {top > 0 ? `↑ ${top} more` : ''}
          {top > 0 && top + visible < rows.length ? '   ' : ''}
          {top + visible < rows.length ? `↓ ${rows.length - top - visible} more` : ''}
        </Text>
      )}
    </Box>
  )
}
