import { Message, LLMConfig } from '../../shared/types'

export class OllamaProvider {
  async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<{ response: string; totalTokens?: number }> {
    const baseURL = config.baseURL || 'http://localhost:11434'
    let fullResponse = ''

    const response = await fetch(`${baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model || 'deepseek-coder',
        messages: messages.map(m => {
          const msg: Record<string, unknown> = { role: m.role, content: m.content }
          if (m.images?.length) msg.images = m.images
          return msg
        }),
        stream: true,
        options: {
          temperature: config.temperature ?? 0.1,
          num_predict: config.maxTokens ?? 8192,
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama error ${response.status}: ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      for (const line of text.split('\n').filter(l => l.trim())) {
        try {
          const data = JSON.parse(line)
          const token = data.message?.content || ''
          if (token) {
            onToken(token)
            fullResponse += token
          }
          if (data.done) {
            const promptTokens: number = data.prompt_eval_count ?? 0
            const completionTokens: number = data.eval_count ?? 0
            const totalTokens = promptTokens + completionTokens || undefined
            return { response: fullResponse, totalTokens }
          }
        } catch {}
      }
    }

    return { response: fullResponse }
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
