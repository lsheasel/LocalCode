import { Message, LLMConfig, StreamResult, ToolSchema, NativeToolCall } from '../../shared/types'
import { streamGuard, StreamStalledError, STREAM_IDLE_MS } from '../streamGuard'

const DEFAULT_BASE_URL = 'http://localhost:1234/v1'

/** Thrown when the server rejects the native tool API (so the caller can fall back to text mode). */
export class ToolsNotSupportedError extends Error {
  constructor(detail: string) {
    super(`The server rejected native tool calling: ${detail}`)
    this.name = 'ToolsNotSupportedError'
  }
}

/** A message in the OpenAI chat format LM Studio speaks. */
function toWire(m: Message): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
  if (m.role === 'assistant' && m.tool_calls?.length) {
    return {
      role: 'assistant',
      content: m.content || '',
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    }
  }
  if (!m.images?.length) return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: [
      { type: 'text', text: m.content },
      ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } })),
    ],
  }
}

export class LMStudioProvider {
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
    const baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
    let fullResponse = ''
    let totalTokens: number | undefined
    let completionTokens: number | undefined
    let truncated = false
    // Native tool calls arrive in pieces, keyed by index.
    const calls: Array<{ id?: string; name: string; arguments: string }> = []
    // Some setups send the reasoning in a separate field; the UI expects it
    // inside <think> … </think>, as when it comes inline.
    let inReasoning = false
    const emit = (text: string) => {
      onToken(text)
      fullResponse += text
    }

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      signal: guard.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(toWire),
        stream: true,
        stream_options: { include_usage: true },
        temperature: config.temperature ?? 0.1,
        max_tokens: config.maxTokens ?? 8192,
        ...(tools?.length
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
              tool_choice: 'auto',
            }
          : {}),
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      if (tools?.length && response.status >= 400 && response.status < 500 && /tool/i.test(text)) {
        throw new ToolsNotSupportedError(text.slice(0, 300))
      }
      throw new Error(`LM Studio error ${response.status}: ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const finish = (): StreamResult => {
      if (inReasoning) emit('</think>\n')
      const toolCalls: NativeToolCall[] = calls
        .filter((c) => c && c.name)
        .map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, arguments: c.arguments || '{}' }))
      return { response: fullResponse, totalTokens, completionTokens, truncated, ...(toolCalls.length ? { toolCalls } : {}) }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      guard.alive()

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return finish()

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          const delta = choice?.delta ?? {}
          if (delta.reasoning_content) {
            if (!inReasoning) {
              emit('<think>')
              inReasoning = true
            }
            emit(delta.reasoning_content)
          }
          if (delta.content) {
            if (inReasoning) {
              emit('</think>\n')
              inReasoning = false
            }
            emit(delta.content)
          }
          for (const tc of delta.tool_calls ?? []) {
            const i = typeof tc.index === 'number' ? tc.index : calls.length
            const fresh = !calls[i]
            const cur = (calls[i] ??= { name: '', arguments: '' })
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name += tc.function.name
            if (fresh && inReasoning) {
              emit('</think>\n')
              inReasoning = false
            }
            if (fresh) onToolDelta?.(`\n{"tool": ${JSON.stringify(cur.name)}, "arguments": `)
            if (tc.function?.arguments) {
              cur.arguments += tc.function.arguments
              onToolDelta?.(tc.function.arguments)
            }
          }
          if (choice?.finish_reason === 'length') truncated = true
          if (parsed.usage?.total_tokens) {
            totalTokens = parsed.usage.total_tokens
            completionTokens = parsed.usage.completion_tokens
          }
        } catch {}
      }
    }

    return finish()
  }

  /**
   * The context window the model is loaded with (or can be loaded with), from
   * LM Studio's own REST API next to the OpenAI-compatible one. Null if the
   * server doesn't tell.
   */
  async contextLength(model: string, baseURL?: string): Promise<number | null> {
    const info = await this.modelInfo(model, baseURL)
    return info?.loaded_context_length || info?.max_context_length || null
  }

  /** Whether the model can use the native tool API ("tool_use" capability). */
  async supportsTools(model: string, baseURL?: string): Promise<boolean> {
    const info = await this.modelInfo(model, baseURL)
    return !!info?.capabilities?.includes('tool_use')
  }

  private async modelInfo(model: string, baseURL?: string): Promise<{
    loaded_context_length?: number
    max_context_length?: number
    capabilities?: string[]
  } | null> {
    try {
      const root = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, '').replace(/\/v1$/, '')
      const res = await fetch(`${root}/api/v0/models/${model}`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return null
      return (await res.json()) as {
        loaded_context_length?: number
        max_context_length?: number
        capabilities?: string[]
      }
    } catch { return null }
  }

  async checkHealth(baseURL?: string): Promise<boolean> {
    try {
      const url = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
      const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch { return false }
  }

  async listModels(baseURL?: string): Promise<string[]> {
    try {
      const url = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
      const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return []
      const json = await res.json() as { data?: Array<{ id: string }> }
      return (json.data ?? []).map(m => m.id)
    } catch { return [] }
  }
}
