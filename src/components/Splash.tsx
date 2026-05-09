import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { AppConfig } from '../shared/types'
import { COMMAND_SUGGESTIONS, BUILTIN_COMMANDS } from '../shared/constants'

// ASCII art — "local" gray, "code" blue
const LOCAL_LINES = [
  '██╗      ██████╗  ██████╗  █████╗ ██╗     ',
  '██║     ██╔═══██╗██╔════╝ ██╔══██╗██║     ',
  '██║     ██║   ██║██║      ███████║██║     ',
  '██║     ██║   ██║██║      ██╔══██║██║     ',
  '███████╗╚██████╔╝╚██████╗ ██║  ██║███████╗',
  '╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝',
]

const CODE_LINES = [
  '    ██████╗ ██████╗ ██████╗ ███████╗',
  '   ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '   ██║     ██║   ██║██║  ██║█████╗  ',
  '   ██║     ██║   ██║██║  ██║██╔══╝  ',
  '   ╚██████╗╚██████╔╝██████╔╝███████╗',
  '    ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
]

const TIPS = [
  'Starten Sie in einem Projektordner für Kontext zur Codebasis',
  'Shell-Befehle direkt ausführen: $ npm test  oder  ! git status',
  'LM Studio: /config provider lmstudio  |  Ollama: /config provider ollama',
  'Probieren Sie: auth bug fixen  ·  Architektur analysieren  ·  Tests hinzufügen',
]

function getSuggestion(input: string, history: string[]): string {
  if (input.length < 2) return ''
  const h = history.find(s => s !== input && s.toLowerCase().startsWith(input.toLowerCase()))
  if (h) return h.slice(input.length)
  const c = BUILTIN_COMMANDS.find(b => b.cmd.startsWith(input) && b.cmd !== input)
  if (c) return c.cmd.slice(input.length)
  const a = COMMAND_SUGGESTIONS.find(s => s.startsWith(input) && s !== input)
  if (a) return a.slice(input.length)
  return ''
}

interface Props {
  config: AppConfig
  history: string[]
  onSubmit: (v: string) => void
}

export const Splash: React.FC<Props> = ({ config, history, onSubmit }) => {
  const [value, setValue] = useState('')
  const [histIdx, setHistIdx] = useState(-1)

  const tip = TIPS[new Date().getDate() % TIPS.length]
  const suggestion = getSuggestion(value, history)

  useInput((_ch, key) => {
    if (key.tab && suggestion) { setValue(value + suggestion); return }
    if (key.upArrow) {
      const next = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(next)
      if (history[next]) setValue(history[next])
    }
    if (key.downArrow) {
      const next = Math.max(histIdx - 1, -1)
      setHistIdx(next)
      setValue(next === -1 ? '' : history[next] || '')
    }
    if (key.escape) { setValue(''); setHistIdx(-1) }
  })

  const handleChange = useCallback((v: string) => { setValue(v); setHistIdx(-1) }, [])
  const handleSubmit = useCallback((v: string) => {
    if (!v.trim()) return
    setHistIdx(-1)
    onSubmit(v.trim())
    setValue('')
  }, [onSubmit])

  const topPad = Math.max(1, Math.floor((process.stdout.rows || 24) / 2) - 10)

  return (
    <Box flexDirection="column" alignItems="center">
      {/* Vertical centering spacer */}
      {Array.from({ length: topPad }).map((_, i) => (
        <Text key={i}> </Text>
      ))}

      {/* Logo */}
      {LOCAL_LINES.map((localLine, i) => (
        <Box key={i}>
          <Text color="#4B5563">{localLine}</Text>
          <Text color="#3B82F6">{CODE_LINES[i]}</Text>
        </Box>
      ))}

      <Text> </Text>

      {/* Input panel — opencode style: left accent bar │ */}
      <Box flexDirection="row">
        <Text color="#3B82F6" bold>│</Text>
        <Box flexDirection="column" paddingLeft={1} minWidth={56}>
          {/* Input line */}
          <Box>
            <TextInput
              value={value}
              onChange={handleChange}
              onSubmit={handleSubmit}
              placeholder='Ask anything... "Fix a TODO in the codebase"'
            />
            {suggestion && <Text color="#374151">{suggestion}</Text>}
          </Box>
          {/* Model info line */}
          <Box>
            <Text color="#3B82F6" bold>Build</Text>
            <Text color="white"> {config.llm.model} </Text>
            <Text color="#6B7280">({config.llm.provider})</Text>
          </Box>
        </Box>
      </Box>

      {/* Keyboard hints */}
      <Box paddingLeft={2} marginTop={1}>
        <Text color="#374151">tab </Text>
        <Text color="#6B7280">complete   </Text>
        <Text color="#374151">ctrl+c </Text>
        <Text color="#6B7280">quit   </Text>
        <Text color="#374151">↑↓ </Text>
        <Text color="#6B7280">history</Text>
      </Box>

      <Text> </Text>

      {/* Tip */}
      <Box paddingLeft={2}>
        <Text color="#F59E0B" bold>● Tip </Text>
        <Text color="#4B5563">{tip}</Text>
      </Box>
    </Box>
  )
}
