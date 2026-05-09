import React from 'react'
import { Box, Text } from 'ink'
import { ToolCall, ToolResult } from '../shared/types'

interface Props {
  toolCall: ToolCall
  result?: ToolResult
  blocked?: boolean
  blockReason?: string
}

const TOOL_ICONS: Record<string, string> = {
  run_shell: '⚡',
  read_file: '▸',
  write_file: '✎',
  edit_file: '∿',
  list_files: '▤',
  search_files: '⊕',
  git_status: '⎇',
  git_diff: '±',
  git_commit: '◆',
}

export const ToolCallCard: React.FC<Props> = ({ toolCall, result, blocked, blockReason }) => {
  const icon = TOOL_ICONS[toolCall.tool] || '●'

  const argSummary = (() => {
    const a = toolCall.arguments
    if (toolCall.tool === 'run_shell') return String(a.command || '')
    if (['read_file', 'write_file', 'edit_file'].includes(toolCall.tool)) return String(a.path || '')
    if (toolCall.tool === 'list_files') return String(a.path || '.')
    if (toolCall.tool === 'search_files') return `"${a.pattern}" in ${a.path || '.'}`
    return JSON.stringify(a).slice(0, 50)
  })()

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={blocked ? '#EF4444' : '#2563EB'}>{blocked ? '⊘' : icon} </Text>
        <Text color={blocked ? '#EF4444' : '#3B82F6'} bold>{toolCall.tool}</Text>
        <Text color="#374151"> › </Text>
        <Text color="#9CA3AF">{argSummary.slice(0, 70)}</Text>
        {!result && !blocked && <Text color="#F59E0B"> ⟳</Text>}
      </Box>

      {result && (
        <Box marginLeft={2}>
          {result.success ? (
            <Text color="#22C55E">
              {'✓ '}
              {result.output.split('\n')[0].slice(0, 72)}
              {result.output.split('\n').length > 1 ? ' …' : ''}
            </Text>
          ) : (
            <Text color="#EF4444">{'✗ '}{(result.error || '').slice(0, 80)}</Text>
          )}
        </Box>
      )}

      {blocked && blockReason && (
        <Box marginLeft={2}>
          <Text color="#EF4444">{'⛔ '}{blockReason}</Text>
        </Box>
      )}
    </Box>
  )
}
