import { Message, LLMConfig, StreamResult, ToolSchema, NativeToolCall } from '../../shared/types'
import { ToolsNotSupportedError } from './LMStudioProvider'
import { streamGuard, StreamStalledError, STREAM_IDLE_MS } from '../streamGuard'

/** Ollama's context window when the model doesn't set num_ctx itself. */
const OLLAMA_DEFAULT_NUM_CTX = 4096

export class OllamaProvider {
  async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void,
    signal?: AbortSignal,
    tools?: ToolSchema[],
    /** Native tool calls as they are written, rendered as {"tool": …} text. */
    onToolDelta?: (text: string) => void,
  ): Promise<StreamResult> {
    const guard = streamGuard(signal)
    try {
      return await this.streamInner(messages, config, onToken, guard, tools, onToolDelta)
    } catch (err) {
      if (guard.stalled) throw new StreamStalledError(STREAM_IDLE_MS / 1000)
      throw err
    } finally {
      guard.dispose()
    }
  }

  private async streamInner(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void,
    guard: ReturnType<typeof streamGuard>,
    tools?: ToolSchema[],
    onToolDelta?: (text: string) => void,
  ): Promise<StreamResult> {
    const baseURL = config.baseURL || 'http://localhost:11434'
    let fullResponse = ''
    const toolCalls: NativeToolCall[] = []

    const response = await fetch(`${baseURL}/api/chat`, {
      method: 'POST',
      signal: guard.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model || 'deepseek-coder',
        messages: messages.map(m => {
          const msg: Record<string, unknown> = { role: m.role, content: m.content }
          if (m.images?.length) msg.images = m.images
          // Ollama takes tool-call arguments as an object, not as JSON text.
          if (m.tool_calls?.length) {
            msg.tool_calls = m.tool_calls.map((tc) => {
              let args: unknown = {}
              try { args = JSON.parse(tc.arguments) } catch {}
              return { function: { name: tc.name, arguments: args } }
            })
          }
          return msg
        }),
        ...(tools?.length
          ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
        stream: true,
        options: {
          temperature: config.temperature ?? 0.1,
          num_predict: config.maxTokens ?? 8192,
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      if (tools?.length && response.status >= 400 && response.status < 500 && /tool/i.test(text)) {
        throw new ToolsNotSupportedError(text.slice(0, 300))
      }
      throw new Error(`Ollama error ${response.status}: ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    // A JSON line can arrive split across two network chunks — keep the
    // incomplete tail until the rest arrives (it was dropped before).
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      guard.alive()

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines.filter(l => l.trim())) {
        try {
          const data = JSON.parse(line)
          const token = data.message?.content || ''
          if (token) {
            onToken(token)
            fullResponse += token
          }
          for (const tc of data.message?.tool_calls ?? []) {
            if (!tc.function?.name) continue
            const args = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {})
            toolCalls.push({ id: `call_${Date.now().toString(36)}_${toolCalls.length}`, name: tc.function.name, arguments: args })
            onToolDelta?.(`\n{"tool": ${JSON.stringify(tc.function.name)}, "arguments": ${args}}`)
          }
          if (data.done) {
            const promptTokens: number = data.prompt_eval_count ?? 0
            const completionTokens: number = data.eval_count ?? 0
            return {
              response: fullResponse,
              totalTokens: promptTokens + completionTokens || undefined,
              completionTokens: completionTokens || undefined,
              truncated: data.done_reason === 'length',
              ...(toolCalls.length ? { toolCalls } : {}),
            }
          }
        } catch {}
      }
    }

    return { response: fullResponse, ...(toolCalls.length ? { toolCalls } : {}) }
  }

  /** Whether the model can use the native tool API ("tools" capability). */
  async supportsTools(model: string, baseURL = 'http://localhost:11434'): Promise<boolean> {
    try {
      const res = await fetch(`${baseURL}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return false
      const data = await res.json() as { capabilities?: string[] }
      return !!data.capabilities?.includes('tools')
    } catch {
      return false
    }
  }

  /** The context window the model runs with, or null if unknown. */
  async contextLength(model: string, baseURL = 'http://localhost:11434'): Promise<number | null> {
    try {
      const res = await fetch(`${baseURL}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return null
      const data = await res.json() as { parameters?: string; model_info?: Record<string, unknown> }
      // An explicit num_ctx in the Modelfile is what Ollama actually uses.
      const m = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(data.parameters ?? '')
      if (m) return Number(m[1])
      return OLLAMA_DEFAULT_NUM_CTX
    } catch {
      return null
    }
  }

  async listModels(baseURL = 'http://localhost:11434'): Promise<string[]> {
    try {
      const res = await fetch(`${baseURL}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return []
      const data = await res.json() as { models?: { name: string }[] }
      return (data.models || []).map(m => m.name)
    } catch {
      return []
    }
  }

  async checkHealth(baseURL = 'http://localhost:11434'): Promise<boolean> {
    try {
      const res = await fetch(`${baseURL}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
