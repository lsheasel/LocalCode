import React from 'react'
import { Box, Text, Static } from 'ink'
import { AgentMessage } from '../shared/types'
import { ToolCallCard } from './ToolCallCard'
import { ThinkingDots } from './ThinkingDots'

interface Props {
  messages: AgentMessage[]
  isThinking: boolean
  currentTokens: string
}

const MAX_DISPLAY = 20

export const AgentOutput: React.FC<Props> = ({ messages, isThinking, currentTokens }) => {
  const display = messages.slice(-MAX_DISPLAY)

  return (
    <Box flexDirection="column">
      <Text color="#3B82F6" bold> ▸ Agent</Text>

      {display.map(msg => (
        <Box key={msg.id} flexDirection="column" marginLeft={2}>
          <MessageRow msg={msg} />
        </Box>
      ))}

      {currentTokens && (
        <Box marginLeft={2}>
          <Text color="#E5E7EB" wrap="wrap">{currentTokens}</Text>
          <Text color="#3B82F6">█</Text>
        </Box>
      )}

      {isThinking && !currentTokens && (
        <Box marginLeft={2}>
          <ThinkingDots />
        </Box>
      )}
    </Box>
  )
}

const MessageRow: React.FC<{ msg: AgentMessage }> = ({ msg }) => {
  switch (msg.type) {
    case 'text':
      if (msg.content.startsWith('> ')) {
        return (
          <Box>
            <Text color="#3B82F6" bold>› </Text>
            <Text color="#9CA3AF">{msg.content.slice(2)}</Text>
          </Box>
        )
      }
      return <Text color="#E5E7EB" wrap="wrap">{msg.content}</Text>

    case 'error':
      return <Text color="#EF4444">✗ {msg.content}</Text>

    case 'done':
      return (
        <Box flexDirection="column">
          <Text color="#22C55E" bold>✓ Done</Text>
          {msg.content && !msg.content.startsWith('✓') && (
            <Text color="#9CA3AF" wrap="wrap">
              {msg.content.replace(/^DONE:\s*/i, '').slice(0, 200)}
            </Text>
          )}
        </Box>
      )

    case 'tool_call':
    case 'tool_result':
      return msg.toolCall ? (
        <ToolCallCard
          toolCall={msg.toolCall}
          result={msg.type === 'tool_result' ? msg.toolResult : undefined}
        />
      ) : null

    default:
      return null
  }
}
