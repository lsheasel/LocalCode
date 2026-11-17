import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { Fieldset } from './Fieldset'
import { theme, ICON, modeColors, Mode } from '../shared/theme'
import { truncEnd } from '../shared/utils'

const MAX_VISIBLE = 8

interface Props {
  width: number
  models: string[]
  loading: boolean
  currentModel: string
  /** The mode the choice applies to — plan/debug can run on their own model. */
  mode: Mode
  onSelect: (model: string) => void
  onCancel: () => void
}

const HINTS = [
  { text: '↑↓', color: theme.textMuted },
  { text: ' select   ', color: theme.textFaint },
  { text: 'enter', color: theme.textMuted },
  { text: ' use   ', color: theme.textFaint },
  { text: 'esc', color: theme.textMuted },
  { text: ' close', color: theme.textFaint },
]

export const ModelPicker: React.FC<Props> = ({ width: widthProp, models, loading, currentModel, mode, onSelect, onCancel }) => {
  const [search, setSearch] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const width = Math.max(30, widthProp)

  const filtered = models.filter((m) => m.toLowerCase().includes(search.toLowerCase()))
  const sel = Math.min(selectedIdx, Math.max(0, filtered.length - 1))
  const top = Math.max(0, Math.min(sel - MAX_VISIBLE + 1, filtered.length - MAX_VISIBLE))
  const visible = filtered.slice(top, top + MAX_VISIBLE)

  useInput((_ch, key) => {
    if (key.escape) return onCancel()
    if (loading) return
    if (key.upArrow) return setSelectedIdx((i) => Math.max(0, Math.min(i, filtered.length - 1) - 1))
    if (key.downArrow) return setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1))
    if (key.return) {
      const model = filtered[sel]
      if (model) onSelect(model)
    }
  })

  return (
    <Fieldset
      width={width}
      color={theme.borderSubtle}
      title={[{ text: 'model', color: theme.primary }]}
      right={[
        { text: 'for ', color: theme.textFaint },
        { text: modeColors[mode].label, color: modeColors[mode].accent },
        { text: ' mode', color: theme.textFaint },
      ]}
      footer={HINTS}
    >
      <Box>
        <Text color={theme.primary}>{ICON.caret}</Text>
        <TextInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setSelectedIdx(0)
          }}
          placeholder="Search models"
          focus={!loading}
        />
      </Box>
      <Text color={theme.thread}>{'─'.repeat(Math.max(0, width - 4))}</Text>
      {loading ? (
        <Text color={theme.textDim}>Loading models from the server…</Text>
      ) : visible.length === 0 ? (
        <Text color={theme.textDim}>
          {models.length === 0 ? 'No models found — is the server running? Try /doctor.' : 'Nothing matches.'}
        </Text>
      ) : (
        visible.map((m, i) => {
          const isSel = top + i === sel
          const current = m === currentModel
          return (
            <Text key={m} wrap="truncate-end">
              <Text color={isSel ? theme.primary : theme.textGhost}>{isSel ? ICON.selected : ICON.unselected}</Text>
              <Text color={isSel ? theme.textBright : theme.textMuted} bold={isSel}>{truncEnd(m, width - 16)}</Text>
              {current && <Text color={theme.primary}>  {ICON.ok} in use</Text>}
            </Text>
          )
        })
      )}
      {filtered.length > MAX_VISIBLE && (
        <Text color={theme.textFaint}>
          {top + visible.length} of {filtered.length}
        </Text>
      )}
    </Fieldset>
  )
}
