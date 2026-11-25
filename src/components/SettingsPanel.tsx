import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { Fieldset } from './Fieldset'
import { ConfigManager } from '../config/ConfigManager'
import { SETTINGS, SettingDef, nextChoice, stepNumber } from '../shared/settings'
import { theme, ICON } from '../shared/theme'
import { truncEnd } from '../shared/utils'
import { useHitbox } from '../shared/mouse'
import { mix, useTween, useColorTween } from '../shared/anim'

interface Props {
  width: number
  /** Rows the panel may use, frame included. */
  maxRows: number
  /** An "action" setting was chosen (model, trusted, rules). */
  onAction: (id: string) => void
  /** A setting was stored; the app applies what needs applying right away. */
  onChanged: (id: string) => void
  onClose: () => void
}

type Row = { kind: 'group'; title: string } | { kind: 'setting'; def: SettingDef; index: number }

const ROWS: Row[] = (() => {
  const out: Row[] = []
  let group = ''
  SETTINGS.forEach((def, index) => {
    if (def.group !== group) {
      group = def.group
      out.push({ kind: 'group', title: group })
    }
    out.push({ kind: 'setting', def, index })
  })
  return out
})()

const LABEL_W = 26

/**
 *   ○──── off        ────● on
 * A switch whose knob slides across when it flips.
 */
const Switch: React.FC<{ on: boolean; active: boolean }> = ({ on, active }) => {
  const t = useTween(on ? 1 : 0, 200)
  const pos = Math.round(t * 4)
  const color = mix(theme.textFaint, active ? theme.primaryBright : theme.primary, t)
  return (
    <Text>
      <Text color={color}>{'━'.repeat(pos)}</Text>
      <Text color={on ? color : theme.textMuted}>●</Text>
      <Text color={theme.textGhost}>{'─'.repeat(4 - pos)}</Text>
      <Text color={on ? theme.textBright : theme.textFaint}> {on ? 'on' : 'off'}</Text>
    </Text>
  )
}

const SettingRow: React.FC<{
  def: SettingDef
  selected: boolean
  editing: boolean
  draft: string
  setDraft: (v: string) => void
  width: number
  onHover: () => void
  onClick: () => void
}> = ({ def, selected, editing, draft, setDraft, width, onHover, onClick }) => {
  const [ref, hover] = useHitbox({ onHover: (inside, moved) => inside && moved && onHover(), onClick })
  const cfg = ConfigManager.getInstance().get()
  const marker = useColorTween(selected ? theme.primary : hover ? theme.textDim : theme.panel, 140)
  const labelColor = useColorTween(selected ? theme.textBright : hover ? theme.text : theme.textMuted, 140)
  const valueW = Math.max(8, width - LABEL_W - 6)

  let value: React.ReactNode
  if (editing) {
    value = <TextInput value={draft} onChange={setDraft} focus />
  } else if (def.kind === 'toggle') {
    value = <Switch on={!!def.on?.(cfg)} active={selected} />
  } else {
    const text = def.show(cfg)
    const arrows = selected && (def.kind === 'choice' || def.kind === 'number')
    value = (
      <Text wrap="truncate-end">
        {arrows && <Text color={theme.textFaint}>‹ </Text>}
        <Text color={selected ? theme.primaryBright : theme.textMuted}>{truncEnd(text, valueW - 4)}</Text>
        {arrows && <Text color={theme.textFaint}> ›</Text>}
        {def.kind === 'action' && <Text color={selected ? theme.primary : theme.textGhost}>  {ICON.enter}</Text>}
      </Text>
    )
  }

  return (
    <Box ref={ref}>
      <Box flexShrink={0}>
        <Text color={marker}>{selected ? '▍' : ' '} </Text>
        <Text color={labelColor} bold={selected}>{def.label.padEnd(LABEL_W)}</Text>
      </Box>
      <Box flexGrow={1} minWidth={0}>
        {value}
      </Box>
    </Box>
  )
}

/**
 * /settings: every setting in one place, changed right there. ↑↓ picks, enter
 * or a click flips a switch, cycles a choice or edits text, ← → steps
 * choices and numbers.
 */
export const SettingsPanel: React.FC<Props> = ({ width, maxRows, onAction, onChanged, onClose }) => {
  const cm = ConfigManager.getInstance()
  const [sel, setSel] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [, rerender] = useState(0)

  const store = (def: SettingDef, value: string | number | boolean) => {
    def.set?.(cm, value)
    rerender((n) => n + 1)
    onChanged(def.id)
  }

  const activate = (def: SettingDef) => {
    const cfg = cm.get()
    switch (def.kind) {
      case 'toggle':
        return store(def, !def.on?.(cfg))
      case 'choice':
        return store(def, nextChoice(def, String(def.raw?.(cfg) ?? ''), 1))
      case 'number':
        return store(def, stepNumber(def, Number(def.raw?.(cfg) ?? 0), 1))
      case 'text':
        setDraft(String(def.raw?.(cfg) ?? ''))
        setEditing(true)
        return
      case 'action':
        return onAction(def.id)
    }
  }

  const step = (def: SettingDef, dir: number) => {
    const cfg = cm.get()
    if (def.kind === 'choice') store(def, nextChoice(def, String(def.raw?.(cfg) ?? ''), dir))
    else if (def.kind === 'number') store(def, stepNumber(def, Number(def.raw?.(cfg) ?? 0), dir))
    else if (def.kind === 'toggle') store(def, dir > 0)
  }

  const current = SETTINGS[sel]

  useInput((input, key) => {
    if (editing) {
      if (key.escape) setEditing(false)
      else if (key.return) {
        store(current, draft)
        setEditing(false)
      }
      return
    }
    if (key.escape || input === 'q') return onClose()
    if (key.upArrow) return setSel((i) => (i - 1 + SETTINGS.length) % SETTINGS.length)
    if (key.downArrow) return setSel((i) => (i + 1) % SETTINGS.length)
    if (key.leftArrow) return step(current, -1)
    if (key.rightArrow) return step(current, 1)
    if (key.return || input === ' ') return activate(current)
  })

  // Rows that fit: the frame (2) and the hint under the list (2) cost four.
  const room = Math.max(4, maxRows - 4)
  const selRow = ROWS.findIndex((r) => r.kind === 'setting' && r.index === sel)
  const top = Math.max(0, Math.min(selRow - Math.floor(room / 2), ROWS.length - room))
  const shown = ROWS.slice(top, top + room)

  return (
    <Fieldset
      width={width}
      color={theme.borderSubtle}
      title={[{ text: 'settings', color: theme.primary }]}
      right={[{ text: cm.getConfigPath().replace(/^.*[\\/](\.localcode[\\/])/, '~/$1').replace(/\\/g, '/'), color: theme.textFaint }]}
      footer={
        editing
          ? [
              { text: 'enter', color: theme.textMuted },
              { text: ' save   ', color: theme.textFaint },
              { text: 'esc', color: theme.textMuted },
              { text: ' cancel', color: theme.textFaint },
            ]
          : [
              { text: '↑↓', color: theme.textMuted },
              { text: ' select   ', color: theme.textFaint },
              { text: 'enter', color: theme.textMuted },
              { text: ' change   ', color: theme.textFaint },
              { text: '←→', color: theme.textMuted },
              { text: ' adjust   ', color: theme.textFaint },
              { text: 'esc', color: theme.textMuted },
              { text: ' close', color: theme.textFaint },
            ]
      }
    >
      {shown.map((row, i) =>
        row.kind === 'group' ? (
          <Box key={`g:${row.title}`} marginTop={i > 0 ? 0 : 0}>
            <Text color={theme.textFaint}>{row.title.toLowerCase()}</Text>
          </Box>
        ) : (
          <SettingRow
            key={row.def.id}
            def={row.def}
            selected={row.index === sel}
            editing={editing && row.index === sel}
            draft={draft}
            setDraft={setDraft}
            width={width - 4}
            onHover={() => !editing && setSel(row.index)}
            onClick={() => {
              if (editing) return
              setSel(row.index)
              activate(row.def)
            }}
          />
        ),
      )}
      <Text color={theme.thread}>{'─'.repeat(Math.max(0, width - 4))}</Text>
      <Text color={theme.textDim} wrap="truncate-end">{current.hint}</Text>
    </Fieldset>
  )
}
