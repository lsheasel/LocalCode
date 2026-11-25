import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { Fieldset } from './Fieldset'
import { ListRow } from './ListRow'
import { fuzzyScore, truncEnd } from '../shared/utils'
import { theme, ICON } from '../shared/theme'

export type PaletteKind = 'command' | 'model' | 'session' | 'file'

export interface PaletteItem {
  kind: PaletteKind
  /** What the item is called — searched and shown. */
  label: string
  /** Second column: what it does. */
  detail?: string
}

interface Props {
  width: number
  /** Rows the list may use. */
  maxRows: number
  commands: Array<{ cmd: string; description: string }>
  sessions: string[]
  loadModels: () => Promise<string[]>
  loadFiles: () => Promise<string[]>
  currentModel: string
  onPick: (item: PaletteItem) => void
  onCancel: () => void
}

const KIND_LABEL: Record<PaletteKind, string> = {
  command: 'cmd',
  model: 'model',
  session: 'session',
  file: 'file',
}

/**
 * Ctrl+P: one search over everything you can reach — commands, models on the
 * server, saved sessions and files in the project.
 */
export const CommandPalette: React.FC<Props> = ({
  width,
  maxRows,
  commands,
  sessions,
  loadModels,
  loadFiles,
  currentModel,
  onPick,
  onCancel,
}) => {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [models, setModels] = useState<string[]>([])
  const [files, setFiles] = useState<string[]>([])

  // Models and files are fetched once when the palette opens.
  useEffect(() => {
    let alive = true
    loadModels().then((m) => alive && setModels(m)).catch(() => undefined)
    loadFiles().then((f) => alive && setFiles(f.slice(0, 2000))).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const all: PaletteItem[] = useMemo(
    () => [
      ...commands.map((c) => ({ kind: 'command' as const, label: c.cmd.trim(), detail: c.description })),
      ...models.map((m) => ({ kind: 'model' as const, label: m, detail: m === currentModel ? 'in use' : 'switch to this model' })),
      ...sessions.map((s) => ({ kind: 'session' as const, label: s, detail: 'load this session' })),
      ...files.map((f) => ({ kind: 'file' as const, label: f, detail: 'attach' })),
    ],
    [commands, models, sessions, files, currentModel],
  )

  const results = useMemo(() => {
    if (!query.trim()) return all.filter((i) => i.kind === 'command').slice(0, 50)
    return all
      .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
      .filter((r): r is { item: PaletteItem; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r) => r.item)
  }, [all, query])

  const visible = Math.max(3, maxRows - 4)
  const sel = Math.min(selected, Math.max(0, results.length - 1))
  const top = Math.max(0, Math.min(sel - visible + 1, results.length - visible))
  const shown = results.slice(top, top + visible)

  useInput((_input, key) => {
    if (key.escape) return onCancel()
    if (key.upArrow) return setSelected((i) => Math.max(0, Math.min(i, results.length - 1) - 1))
    if (key.downArrow) return setSelected((i) => Math.min(results.length - 1, i + 1))
    if (key.return) {
      const item = results[sel]
      if (item) onPick(item)
    }
  })

  const labelW = Math.min(36, Math.max(12, Math.floor((width - 16) / 2)))

  return (
    <Fieldset
      width={width}
      color={theme.borderSubtle}
      title={[{ text: 'palette', color: theme.primary }]}
      right={[{ text: `${results.length} of ${all.length}`, color: theme.textFaint }]}
      footer={[
        { text: '↑↓', color: theme.textMuted },
        { text: ' select   ', color: theme.textFaint },
        { text: 'enter', color: theme.textMuted },
        { text: ' run   ', color: theme.textFaint },
        { text: 'esc', color: theme.textMuted },
        { text: ' close', color: theme.textFaint },
      ]}
    >
      <Box>
        <Text color={theme.primary}>{ICON.caret}</Text>
        <TextInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            setSelected(0)
          }}
          placeholder="Search commands, models, sessions and files"
          focus
        />
      </Box>
      <Text color={theme.thread}>{'─'.repeat(Math.max(0, width - 4))}</Text>
      {shown.length === 0 ? (
        <Text color={theme.textFaint}>Nothing matches “{query}”.</Text>
      ) : (
        shown.map((item, i) => {
          const isSel = top + i === sel
          return (
            <ListRow
              key={`${item.kind}:${item.label}`}
              selected={isSel}
              onHover={() => setSelected(top + i)}
              onClick={() => onPick(item)}
            >
              <Text color={theme.textFaint}>{KIND_LABEL[item.kind].padEnd(8)}</Text>
              <Text color={isSel ? theme.textBright : theme.textMuted} bold={isSel}>
                {truncEnd(item.label, labelW).padEnd(labelW)}
              </Text>
              <Text color={isSel ? theme.textMuted : theme.textFaint}>  {item.detail ?? ''}</Text>
            </ListRow>
          )
        })
      )}
    </Fieldset>
  )
}
