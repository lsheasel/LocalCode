import { Message, LLMConfig } from '../../shared/types'

const DEFAULT_BASE_URL = 'http://localhost:1234/v1'

export class LMStudioProvider {
  async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<string> {
    const baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
    let fullResponse = ''

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        temperature: config.temperature ?? 0.1,
        max_tokens: config.maxTokens ?? 8192,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`LM Studio Fehler ${response.status}: ${text}`)
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
        if (data === '[DONE]') return fullResponse

        try {
          const parsed = JSON.parse(data)
          const token = parsed.choices?.[0]?.delta?.content
          if (token) { onToken(token); fullResponse += token }
        } catch {}
      }
    }

    return fullResponse
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
