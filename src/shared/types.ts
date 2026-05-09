export type LLMProvider = 'ollama' | 'lmstudio'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  baseURL?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  meta?: {
    diffPath?: string
    diffOld?: string[]
    diffNew?: string[]
    diffStartLine?: number
    diffContextBefore?: string[]
    diffContextAfter?: string[]
  }
}

export interface AppConfig {
  llm: LLMConfig
  theme: 'dark'
  fontSize: number
  shell: string
  workspaceDir: string
  security: {
    allowDangerousCommands: boolean
    requireConfirmation: string[]
  }
}

export interface AgentMessage {
  id: string
  type: 'thinking' | 'text' | 'command' | 'tool_call' | 'tool_result' | 'error' | 'done'
  content: string
  commandTitle?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  timestamp: number
}
