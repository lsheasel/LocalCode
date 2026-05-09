import { Message, LLMConfig } from '../../shared/types'

export class ClaudeProvider {
  async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<string> {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || ''
    let fullResponse = ''

    const systemMsg = messages.find(m => m.role === 'system')
    const chatMessages = messages.filter(m => m.role !== 'system')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model || 'claude-3-5-sonnet-20241022',
        system: systemMsg?.content,
        messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: config.maxTokens ?? 8192,
        temperature: config.temperature ?? 0.1,
        stream: true,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Claude error ${response.status}: ${text}`)
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
        try {
          const parsed = JSON.parse(line.slice(6))
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            onToken(parsed.delta.text)
            fullResponse += parsed.delta.text
          }
        } catch {}
      }
    }

    return fullResponse
  }
}
