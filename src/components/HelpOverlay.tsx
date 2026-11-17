import React from 'react'
import { Box, Text } from 'ink'
import { HELP_GROUPS, HintGroup } from '../shared/keymap'
import { theme, space } from '../shared/theme'
import { Fieldset } from './Fieldset'

interface Props {
  termCols: number
  /** Most rows the overlay may take; it is cut at the bottom beyond that. */
  maxRows: number
}

/** Rows a group occupies: title + one per hint + trailing blank. */
const groupHeight = (g: HintGroup) => g.hints.length + 2

/** Split the groups into two balanced columns so the overlay stays short. */
function splitColumns(groups: HintGroup[]): [HintGroup[], HintGroup[]] {
  const total = groups.reduce((sum, g) => sum + groupHeight(g), 0)
  const left: HintGroup[] = []
  let used = 0
  let i = 0
  while (i < groups.length && used + groupHeight(groups[i]) <= total / 2) {
    used += groupHeight(groups[i])
    left.push(groups[i])
    i++
  }
  // Always leave at least one group on each side.
  if (left.length === 0) left.push(groups[i++])
  return [left, groups.slice(i)]
}

// Every row is exactly one line (labels are cut, never wrapped) and nothing
// shrinks — on a short terminal the overlay clips at the bottom instead of
// Yoga squeezing rows on top of each other.
const Group: React.FC<{ group: HintGroup; keyWidth: number }> = ({ group, keyWidth }) => (
  <Box flexDirection="column" marginBottom={space.gap} flexShrink={0}>
    <Text color={theme.textBright} bold wrap="truncate-end">{group.title}</Text>
    {group.hints.map((h, i) => (
      <Box key={i}>
        <Text wrap="truncate-end">
          <Text color={theme.textFaint}>{h.keys.padEnd(keyWidth)}</Text>
          <Text color={theme.textDim}>  {h.label}</Text>
        </Text>
      </Box>
    ))}
  </Box>
)

/**
 * The `?` overlay — the full keyboard reference. The terse, context-specific
 * version of this lives in the hint bar under the prompt (see footerHints).
 */
export const HelpOverlay: React.FC<Props> = ({ termCols, maxRows }) => {
  const keyWidth = Math.max(
    ...HELP_GROUPS.flatMap(g => g.hints.map(h => h.keys.length)),
  )
  const twoColumn = termCols >= 76
  const [left, right] = twoColumn ? splitColumns(HELP_GROUPS) : [HELP_GROUPS, []]
  const colRows = (gs: HintGroup[]) => gs.reduce((n, g) => n + groupHeight(g), 0)
  const bodyRows = Math.max(colRows(left), colRows(right))
  // The frame's top and bottom border cost two rows; past that the list is cut.
  const shownRows = Math.max(1, Math.min(bodyRows, maxRows - 2))

  return (
    <Fieldset
      width={termCols}
      color={theme.borderSubtle}
      title={[{ text: 'shortcuts', color: theme.primary }]}
      right={shownRows < bodyRows ? [{ text: 'make the window taller to see all', color: theme.textFaint }] : []}
      footer={[
        { text: '?', color: theme.textMuted },
        { text: ' or ', color: theme.textFaint },
        { text: 'esc', color: theme.textMuted },
        { text: ' close', color: theme.textFaint },
      ]}
    >
      <Box flexDirection="row" height={shownRows} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0} marginRight={right.length > 0 ? 3 : 0}>
          {left.map(g => <Group key={g.title} group={g} keyWidth={keyWidth} />)}
        </Box>
        {right.length > 0 && (
          <Box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
            {right.map(g => <Group key={g.title} group={g} keyWidth={keyWidth} />)}
          </Box>
        )}
      </Box>
    </Fieldset>
  )
}
