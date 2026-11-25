import React from 'react'
import { Box, Text } from 'ink'
import { theme, ICON } from '../shared/theme'
import { useHitbox } from '../shared/mouse'
import { mix, useTween } from '../shared/anim'

/**
 * One row of a pick list (/ menu, palette, model and file pickers). The mouse
 * selects what it points at and a click picks it, like a menu on a web page;
 * the selection marker fades over instead of jumping.
 */
export const ListRow: React.FC<{
  selected: boolean
  onHover?: () => void
  onClick?: () => void
  children: React.ReactNode
}> = ({ selected, onHover, onClick, children }) => {
  const [ref] = useHitbox({ onHover: (inside, moved) => inside && moved && onHover?.(), onClick })
  const t = useTween(selected ? 1 : 0, 140)
  return (
    <Box ref={ref}>
      <Text wrap="truncate-end">
        <Text color={mix(theme.textGhost, theme.primary, t)}>{t > 0.4 ? ICON.selected : ICON.unselected}</Text>
        {children}
      </Text>
    </Box>
  )
}

/** A colour for row text that brightens smoothly when the row is selected. */
export function useRowColor(selected: boolean, base: string = theme.textMuted, lit: string = theme.textBright): string {
  const t = useTween(selected ? 1 : 0, 140)
  return mix(base, lit, t)
}
