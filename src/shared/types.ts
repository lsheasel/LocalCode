export type LLMProvider = 'ollama' | 'lmstudio'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  baseURL?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  /**
   * How tools reach the model: 'native' uses the server's tool API, 'text'
   * describes them in the prompt and parses JSON from the answer, 'auto'
   * (default) picks native when the model supports it.
   */
  toolMode?: 'auto' | 'native' | 'text'
  /** Model to use in plan / debug mode instead of `model` (build mode). */
  modeModels?: Partial<Record<'plan' | 'debug', string>>
}

/** What one streamed completion returns. */
export interface StreamResult {
  response: string
  /** Prompt + completion tokens of this request — the context in use. */
  totalTokens?: number
  /** Tokens the model generated in this request. */
  completionTokens?: number
  /** The answer was cut off at the max-tokens limit. */
  truncated?: boolean
  /** Calls made through the native tool API (when tools were offered). */
  toolCalls?: NativeToolCall[]
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]   // base64-encoded images for multimodal models
  /** Assistant message: tool calls made through the native tool API. */
  tool_calls?: NativeToolCall[]
  /** Tool message: which call this is the result of. */
  tool_call_id?: string
}

/** A tool call as the native (OpenAI-style) tool API returns it. */
export interface NativeToolCall {
  id: string
  name: string
  /** JSON text, exactly as the model produced it. */
  arguments: string
}

/** A tool offered through the native tool API. */
export interface ToolSchema {
  name: string
  description: string
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>
}

export interface Attachment {
  path: string
  name: string
  type: 'image' | 'file'
  data: string        // base64 for images, text content for files
  mimeType?: string
}

export interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  images?: string[]   // base64 screenshots / images returned by a tool
  meta?: {
    diffPath?: string
    diffOld?: string[]
    diffNew?: string[]
    diffStartLine?: number
    diffContextBefore?: string[]
    diffContextAfter?: string[]
    diffIsNew?: boolean   // true when the file was created (not updated)
  }
}

export interface AppConfig {
  llm: LLMConfig
  theme: 'dark'
  fontSize: number
  shell: string
  workspaceDir: string
  trustedPaths: string[]   // paths where write ops are auto-approved (+ all subpaths)
  disabledPlugins: string[]
  debugMode?: boolean
  /** Terminal UI. Unset means on. */
  ui?: {
    /** Hover fades, glows, the shimmer while thinking, smooth scrolling. */
    animations?: boolean
    /** Mouse: hover, clicks and drag-to-copy. Off leaves the mouse to the terminal. */
    mouse?: boolean
  }
  /** Discord status ("Rich Presence"). Off unless turned on. */
  discord?: { enabled?: boolean }
  /** Look for a new version at start. Unset means on. */
  updates?: { check?: boolean }
  /** Language servers for lsp_hover / lsp_definition. */
  lsp?: {
    /** Install a missing language server on first use. Unset means on. */
    autoInstall?: boolean
  }
  security: {
    allowDangerousCommands: boolean
    requireConfirmation: string[]
  }
}

export interface AgentMessage {
  id: string
  type: 'thinking' | 'text' | 'command' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'debug'
  content: string
  commandTitle?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  timestamp: number
  tokenCount?: number
  durationMs?: number
  /** Generation speed of the answer, in tokens per second. */
  tokensPerSec?: number
  debugInfo?: {
    iteration?: number
    tokens?: number
    elapsed?: number
    tool?: string
    success?: boolean
  }
}
