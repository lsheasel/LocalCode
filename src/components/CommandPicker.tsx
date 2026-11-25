import React from 'react'
import { Text } from 'ink'
import { Fieldset } from './Fieldset'
import { ListRow } from './ListRow'
import { theme } from '../shared/theme'

export interface PickerCommand {
  cmd: string
  description: string
}

interface Props {
  commands: PickerCommand[]
  selectedIdx: number
  width: number
  /** The mouse points at a command. */
  onHover?: (index: number) => void
  /** A command was clicked. */
  onPick?: (index: number) => void
}

/**
 * The slash-command list. Two aligned columns — command, then what it does —
 * one row each; descriptions are cut, never wrapped.
 */
export const CommandPicker: React.FC<Props> = ({ commands, selectedIdx, width, onHover, onPick }) => {
  const cmdW = Math.max(...commands.map((c) => c.cmd.trimEnd().length)) + 3
  return (
    <Fieldset width={width} color={theme.borderSubtle} title={[{ text: 'commands', color: theme.primary }]}>
      {commands.map((cmd, i) => {
        const sel = i === selectedIdx
        return (
          <ListRow key={cmd.cmd} selected={sel} onHover={() => onHover?.(i)} onClick={() => onPick?.(i)}>
            <Text color={sel ? theme.textBright : theme.textMuted} bold={sel}>
              {cmd.cmd.trimEnd().padEnd(cmdW)}
            </Text>
            <Text color={sel ? theme.textMuted : theme.textFaint}>{cmd.description}</Text>
          </ListRow>
        )
      })}
    </Fieldset>
  )
}
