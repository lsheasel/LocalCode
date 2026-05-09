import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { COMMAND_SUGGESTIONS, BUILTIN_COMMANDS } from '../shared/constants'

interface Props {
  onSubmit: (value: string) => void
  isAgentRunning: boolean
  history: string[]
}

function getSuggestion(input: string, history: string[]): string {
  if (input.length < 2) return ''
  const histMatch = history.find(h => h !== input && h.toLowerCase().startsWith(input.toLowerCase()))
  if (histMatch) return histMatch.slice(input.length)
  const cmdMatch = BUILTIN_COMMANDS.find(b => b.cmd.startsWith(input) && b.cmd !== input)
  if (cmdMatch) return cmdMatch.cmd.slice(input.length)
  const aiMatch = COMMAND_SUGGESTIONS.find(s => s.startsWith(input) && s !== input)
  if (aiMatch) return aiMatch.slice(input.length)
  return ''
}

export const InputBar: React.FC<Props> = ({ onSubmit, isAgentRunning, history }) => {
  const [value, setValue] = useState('')
  const [histIndex, setHistIndex] = useState(-1)

  const suggestion = isAgentRunning ? '' : getSuggestion(value, history)
  const cols = process.stdout.columns || 80

  useInput((_ch, key) => {
    if (key.tab && suggestion && !isAgentRunning) {
      setValue(value + suggestion)
      return
    }
    if (key.upArrow && !isAgentRunning) {
      const next = Math.min(histIndex + 1, history.length - 1)
      setHistIndex(next)
      if (history[next]) setValue(history[next])
    }
    if (key.downArrow && !isAgentRunning) {
      const next = Math.max(histIndex - 1, -1)
      setHistIndex(next)
      setValue(next === -1 ? '' : history[next] || '')
    }
    if (key.escape) { setValue(''); setHistIndex(-1) }
  })

  const handleSubmit = useCallback((val: string) => {
    if (!val.trim() || isAgentRunning) return
    setHistIndex(-1)
    onSubmit(val.trim())
    setValue('')
  }, [onSubmit, isAgentRunning])

  const handleChange = useCallback((val: string) => {
    setValue(val)
    setHistIndex(-1)
  }, [])

  const promptColor = isAgentRunning ? '#F59E0B' : '#3B82F6'
  const promptChar = isAgentRunning ? '⟳' : '›'

  return (
    <Box flexDirection="column">
      <Text color="#1E3A8A">{'─'.repeat(cols)}</Text>
      <Box>
        <Text color={promptColor} bold> {promptChar} </Text>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={
            isAgentRunning
              ? 'Running… Ctrl+C to abort'
              : 'Ask AI or enter command…'
          }
          focus={!isAgentRunning}
        />
        {suggestion && <Text color="#374151">{suggestion}</Text>}
      </Box>
    </Box>
  )
}
