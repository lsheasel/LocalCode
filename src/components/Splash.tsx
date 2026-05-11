import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { AppConfig } from '../shared/types'
import { COMMAND_SUGGESTIONS, BUILTIN_COMMANDS } from '../shared/constants'

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
  'Start inside a project folder so the agent has codebase context',
  'Run shell commands directly: $ npm test  or  ! git status',
  'LM Studio: /config provider lmstudio  |  Ollama: /config provider ollama',
  'Try: fix auth bug  ·  analyze architecture  ·  add unit tests',
  'Drag & drop a file into the terminal to attach it automatically',
  'Type @filename to attach a file inline — e.g.  @src/app.ts explain this',
  'Use /model to browse and switch models from the running server',
  'Tab autocompletes commands or toggles BUILD ↔ PLAN mode',
  '/compact summarizes long conversations to free up context window',
  '/session save <name> to bookmark a conversation, /session load to resume',
  '/doctor checks your LLM connection and shows current configuration',
  'Plan before you build: tab to switch to PLAN mode, then describe the feature',
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
  mode: 'build' | 'plan'
  onSubmit: (v: string) => void
  onToggleMode: () => void
}

export const Splash: React.FC<Props> = ({ config, history, mode, onSubmit, onToggleMode }) => {
  const [value, setValue] = useState('')
  const [histIdx, setHistIdx] = useState(-1)

  const tip = TIPS[new Date().getDate() % TIPS.length]
  const suggestion = getSuggestion(value, history)

  useInput((_ch, key) => {
    if (key.tab) {
      if (suggestion) { setValue(value + suggestion) }
      else { onToggleMode() }
      return
    }
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
  const isPlan = mode === 'plan'

  return (
    <Box flexDirection="column" alignItems="center">
      {Array.from({ length: topPad }).map((_, i) => (
        <Text key={i}> </Text>
      ))}

      {LOCAL_LINES.map((localLine, i) => (
        <Box key={i}>
          <Text color="#d8d8d8">{localLine}</Text>
          <Text color="#3B82F6">{CODE_LINES[i]}</Text>
        </Box>
      ))}

      <Text> </Text>

      {/* Input panel */}
      <Box flexDirection="column" borderStyle="single" borderColor={isPlan ? '#14532D' : '#1E3A5F'} minWidth={60}>
        <Box paddingX={1}>
          <Text color={isPlan ? '#22C55E' : '#3B82F6'} bold>{'> '}</Text>
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder={isPlan ? 'describe what to plan…' : 'ask anything  ·  / for commands  ·  @ to attach'}
          />
          {suggestion && <Text color="#1F2937">{suggestion}</Text>}
        </Box>
        <Box paddingX={1} justifyContent="space-between">
          <Box>
            <Text color="#4B5563">↵ </Text>
            <Text color="#6B7280">send  </Text>
            <Text color="#4B5563">tab </Text>
            <Text color="#6B7280">{suggestion ? 'complete' : 'switch mode'}</Text>
          </Box>
          <Box>
            <Text backgroundColor={isPlan ? '#166534' : '#1D4ED8'} color={isPlan ? '#86EFAC' : '#BFDBFE'}>
              {' '}{isPlan ? 'PLAN' : 'BUILD'}{' '}
            </Text>
            <Text color="#374151">  </Text>
            <Text color="#9CA3AF">{config.llm.model.length > 20 ? config.llm.model.slice(0, 20) + '…' : config.llm.model}</Text>
          </Box>
        </Box>
      </Box>

      <Box paddingLeft={2} marginTop={1}>
        <Text color="#4B5563">↑↓ </Text>
        <Text color="#6B7280">history  </Text>
        <Text color="#4B5563">tab </Text>
        <Text color="#6B7280">mode  </Text>
        <Text color="#4B5563">@ </Text>
        <Text color="#6B7280">attach  </Text>
        <Text color="#4B5563">ctrl+c </Text>
        <Text color="#6B7280">quit</Text>
      </Box>

      <Text> </Text>

      <Box paddingLeft={2}>
        <Text color="#F59E0B" bold>● Tip </Text>
        <Text color="#4B5563">{tip}</Text>
      </Box>
    </Box>
  )
}
