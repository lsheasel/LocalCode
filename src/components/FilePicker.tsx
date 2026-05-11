import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { extname } from 'path'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])

interface Props {
  files: string[]
  onSelect: (path: string) => void
  onCancel: () => void
}

export const FilePicker: React.FC<Props> = ({ files, onSelect, onCancel }) => {
  const [search, setSearch]           = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)

  const filtered = files
    .filter(f => f.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8)

  useInput((_, inp) => {
    if (inp.upArrow)   { setSelectedIdx(i => Math.max(0, i - 1)); return }
    if (inp.downArrow) { setSelectedIdx(i => Math.min(filtered.length - 1, i + 1)); return }
    if (inp.escape)    { onCancel(); return }
    if (inp.return) {
      const file = filtered[Math.min(selectedIdx, filtered.length - 1)]
      if (file) onSelect(file)
      return
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#22C55E" marginX={1}>
      <Box paddingX={2}>
        <Text color="#22C55E" bold> @ Attach </Text>
        <Text color="#4B5563">› Datei oder Bild auswählen</Text>
      </Box>

      <Box paddingX={2} borderStyle="single" borderTop borderColor="#15803D">
        <Text color="#6B7280">/ </Text>
        <TextInput
          value={search}
          onChange={v => { setSearch(v); setSelectedIdx(0) }}
          placeholder="Search file..."
          focus
        />
      </Box>

      {filtered.length === 0 ? (
        <Box paddingX={4} paddingY={1}>
          <Text color="#6B7280">No files found</Text>
        </Box>
      ) : (
        filtered.map((f, i) => {
          const sel     = i === selectedIdx
          const isImage = IMAGE_EXTS.has(extname(f).toLowerCase())
          return (
            <Box key={f} paddingX={2}>
              <Text color={sel ? '#22C55E' : '#374151'}>{sel ? '▶ ' : '  '}</Text>
              <Text color={sel ? '#86EFAC' : '#9CA3AF'}>
                {isImage ? '[img] ' : '[file] '}{f}
              </Text>
            </Box>
          )
        })
      )}

      <Box paddingX={2} borderStyle="single" borderTop borderColor="#15803D">
        <Text color="#374151">↑↓ </Text><Text color="#4B5563">select  </Text>
        <Text color="#374151">enter </Text><Text color="#4B5563">attach  </Text>
        <Text color="#374151">esc </Text><Text color="#4B5563">close</Text>
      </Box>
    </Box>
  )
}
