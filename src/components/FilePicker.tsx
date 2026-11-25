import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { extname } from 'path'
import { Fieldset } from './Fieldset'
import { ListRow } from './ListRow'
import { theme, ICON } from '../shared/theme'
import { truncStart } from '../shared/utils'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])
const MAX_VISIBLE = 8

interface Props {
  width: number
  files: string[]
  onSelect: (path: string) => void
  onCancel: () => void
}

export const FilePicker: React.FC<Props> = ({ width: widthProp, files, onSelect, onCancel }) => {
  const [search, setSearch] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const width = Math.max(30, widthProp)

  const filtered = files.filter((f) => f.toLowerCase().includes(search.toLowerCase()))
  const sel = Math.min(selectedIdx, Math.max(0, filtered.length - 1))
  const top = Math.max(0, Math.min(sel - MAX_VISIBLE + 1, filtered.length - MAX_VISIBLE))
  const visible = filtered.slice(top, top + MAX_VISIBLE)

  useInput((_ch, key) => {
    if (key.escape) return onCancel()
    if (key.upArrow) return setSelectedIdx((i) => Math.max(0, Math.min(i, filtered.length - 1) - 1))
    if (key.downArrow) return setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1))
    if (key.return) {
      const file = filtered[sel]
      if (file) onSelect(file)
    }
  })

  return (
    <Fieldset
      width={width}
      color={theme.borderSubtle}
      title={[{ text: 'attach', color: theme.primary }]}
      right={[{ text: `${filtered.length} files`, color: theme.textFaint }]}
      footer={[
        { text: '↑↓', color: theme.textMuted },
        { text: ' select   ', color: theme.textFaint },
        { text: 'enter', color: theme.textMuted },
        { text: ' attach   ', color: theme.textFaint },
        { text: 'esc', color: theme.textMuted },
        { text: ' close', color: theme.textFaint },
      ]}
    >
      <Box>
        <Text color={theme.primary}>{ICON.caret}</Text>
        <TextInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setSelectedIdx(0)
          }}
          placeholder="Search files"
          focus
        />
      </Box>
      <Text color={theme.thread}>{'─'.repeat(Math.max(0, width - 4))}</Text>
      {visible.length === 0 ? (
        <Text color={theme.textDim}>No files found.</Text>
      ) : (
        visible.map((f, i) => {
          const isSel = top + i === sel
          const isImage = IMAGE_EXTS.has(extname(f).toLowerCase())
          return (
            <ListRow key={f} selected={isSel} onHover={() => setSelectedIdx(top + i)} onClick={() => onSelect(f)}>
              <Text color={theme.textFaint}>{isImage ? 'image ' : 'file  '}</Text>
              <Text color={isSel ? theme.textBright : theme.textMuted} bold={isSel}>{truncStart(f, width - 14)}</Text>
            </ListRow>
          )
        })
      )}
    </Fieldset>
  )
}
