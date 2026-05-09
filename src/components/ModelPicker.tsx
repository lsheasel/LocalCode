import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'

interface Props {
  models: string[]
  loading: boolean
  currentModel: string
  onSelect: (model: string) => void
  onCancel: () => void
}

export const ModelPicker: React.FC<Props> = ({ models, loading, currentModel, onSelect, onCancel }) => {
  const [search, setSearch]           = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)

  const filtered = models.filter(m => m.toLowerCase().includes(search.toLowerCase()))

  useInput((ch, inp) => {
    if (loading) {
      if (inp.escape) { onCancel(); return }
      return
    }
    if (inp.upArrow)   { setSelectedIdx(i => Math.max(0, i - 1)); return }
    if (inp.downArrow) { setSelectedIdx(i => Math.min(filtered.length - 1, i + 1)); return }
    if (inp.escape)    { onCancel(); return }
    if (inp.return) {
      const model = filtered[Math.min(selectedIdx, filtered.length - 1)]
      if (model) onSelect(model)
      return
    }
  })

  const visibleModels = filtered.slice(0, 8)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#6366F1" marginX={1}>

      {/* Header */}
      <Box paddingX={2}>
        <Text color="#6366F1" bold> Model </Text>
        <Text color="#4B5563">› Wähle ein Model  </Text>
        <Text color="#374151">aktuell: </Text>
        <Text color="#9CA3AF">{currentModel}</Text>
      </Box>

      {/* Searchbar */}
      <Box paddingX={2} borderStyle="single" borderTop borderColor="#312E81">
        <Text color="#6B7280">/ </Text>
        <TextInput
          value={search}
          onChange={v => { setSearch(v); setSelectedIdx(0) }}
          placeholder="Model suchen …"
          focus={!loading}
        />
      </Box>

      {/* List */}
      {loading ? (
        <Box paddingX={4} paddingY={1}>
          <Text color="#6B7280">Lade Models vom Server …</Text>
        </Box>
      ) : visibleModels.length === 0 ? (
        <Box paddingX={4} paddingY={1}>
          <Text color="#6B7280">
            {models.length === 0 ? 'Keine Models gefunden — Server erreichbar?' : 'Keine Treffer'}
          </Text>
        </Box>
      ) : (
        visibleModels.map((m, i) => {
          const sel     = i === selectedIdx
          const current = m === currentModel
          return (
            <Box key={m} paddingX={2}>
              <Text color={sel ? '#6366F1' : '#374151'}>{sel ? '▶ ' : '  '}</Text>
              {current
                ? <Text color={sel ? '#A5B4FC' : '#6366F1'} bold>✓ {m}</Text>
                : <Text color={sel ? '#A5B4FC' : '#9CA3AF'}>  {m}</Text>
              }
            </Box>
          )
        })
      )}

      {filtered.length > 8 && (
        <Box paddingX={4}>
          <Text color="#374151">… {filtered.length - 8} weitere (Suche verfeinern)</Text>
        </Box>
      )}

      {/* Footer */}
      <Box paddingX={2} borderStyle="single" borderTop borderColor="#312E81">
        <Text color="#374151">↑↓ </Text><Text color="#4B5563">wählen  </Text>
        <Text color="#374151">enter </Text><Text color="#4B5563">übernehmen  </Text>
        <Text color="#374151">esc </Text><Text color="#4B5563">schließen</Text>
      </Box>

    </Box>
  )
}
