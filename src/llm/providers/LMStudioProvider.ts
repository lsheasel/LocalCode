import { Message, LLMConfig } from '../../shared/types'

const DEFAULT_BASE_URL = 'http://localhost:1234/v1'

export class LMStudioProvider {
  async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<{ response: string; totalTokens?: number }> {
    const baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
    let fullResponse = ''
    let totalTokens: number | undefined

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(m => {
          if (!m.images?.length) return { role: m.role, content: m.content }
          return {
            role: m.role,
            content: [
              { type: 'text', text: m.content },
              ...m.images.map(img => ({
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${img}` },
              })),
            ],
          }
        }),
        stream: true,
        stream_options: { include_usage: true },
        temperature: config.temperature ?? 0.1,
        max_tokens: config.maxTokens ?? 8192,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`LM Studio error ${response.status}: ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return { response: fullResponse, totalTokens }

        try {
          const parsed = JSON.parse(data)
          const token = parsed.choices?.[0]?.delta?.content
          if (token) { onToken(token); fullResponse += token }
          if (parsed.usage?.total_tokens) {
            totalTokens = parsed.usage.total_tokens
          }
        } catch {}
      }
    }

    return { response: fullResponse, totalTokens }
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
