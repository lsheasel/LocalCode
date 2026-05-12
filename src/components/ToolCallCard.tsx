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
  run_shell:    '⚡',
  read_file:    '▸',
  write_file:   '✎',
  append_file:  '✎',
  edit_file:    '∿',
  delete_file:  '✗',
  move_file:    '→',
  copy_file:    '⊕',
  create_dir:   '⊞',
  list_files:   '▤',
  find_files:   '⊙',
  search_files: '⊕',
  git_status:   '⎇',
  git_diff:     '±',
  git_log:      '◎',
  git_commit:   '◆',
  git_branch:   '⎇',
  git_stash:    '◈',
  run_tests:    '▶',
  web_fetch:    '◉',
  http_request: '◉',
  lsp_check:    '⊛',
}

export const ToolCallCard: React.FC<Props> = ({ toolCall, result, blocked, blockReason }) => {
  const icon = TOOL_ICONS[toolCall.tool] || '●'

  const argSummary = (() => {
    const a = toolCall.arguments
    switch (toolCall.tool) {
      case 'run_shell':    return String(a.command || '')
      case 'read_file':
      case 'write_file':
      case 'edit_file':
      case 'append_file':
      case 'delete_file':  return String(a.path || '')
      case 'move_file':
      case 'copy_file':    return `${String(a.from || '')} → ${String(a.to || '')}`
      case 'create_dir':   return String(a.path || '')
      case 'list_files':   return String(a.path || '.')
      case 'find_files':   return `"${String(a.pattern || '')}" in ${String(a.path || '.')}`
      case 'search_files': return `"${String(a.pattern || '')}" in ${String(a.path || '.')}`
      case 'git_status':   return ''
      case 'git_diff':     return a.staged ? 'staged' : ''
      case 'git_log':      return `last ${String(a.limit || 20)}`
      case 'git_commit':   return String(a.message || '')
      case 'git_branch':   return `${String(a.action || 'list')}${a.name ? ` ${String(a.name)}` : ''}`
      case 'git_stash':    return `${String(a.action || 'push')}${a.message ? ` "${String(a.message)}"` : ''}`
      case 'run_tests':    return ''
      case 'web_fetch':    return String(a.url || '')
      case 'http_request': return `${String(a.method || 'GET')} ${String(a.url || '')}`
      case 'lsp_check':    return String(a.path || '.')
      default:             return JSON.stringify(a).slice(0, 50)
    }
  })()

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={blocked ? '#EF4444' : '#2563EB'}>{blocked ? '⊘' : icon} </Text>
        <Text color={blocked ? '#EF4444' : '#3B82F6'} bold>{toolCall.tool}</Text>
        {argSummary && <Text color="#374151"> › </Text>}
        {argSummary && <Text color="#9CA3AF">{argSummary.slice(0, 70)}</Text>}
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
