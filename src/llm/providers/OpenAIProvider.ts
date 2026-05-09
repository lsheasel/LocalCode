import { Message, LLMConfig } from '../../shared/types'

export class OpenAIProvider {
  async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<string> {
    const baseURL = config.baseURL || 'https://api.openai.com/v1'
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY || ''
    let fullResponse = ''

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        temperature: config.temperature ?? 0.1,
        max_tokens: config.maxTokens ?? 8192,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenAI error ${response.status}: ${text}`)
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
          if (token) {
            onToken(token)
            fullResponse += token
          }
        } catch {}
      }
    }

    return fullResponse
  }
}
