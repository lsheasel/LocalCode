import { Message, LLMConfig } from '../shared/types'
import { OllamaProvider } from './providers/OllamaProvider'
import { LMStudioProvider } from './providers/LMStudioProvider'

const ollama   = new OllamaProvider()
const lmstudio = new LMStudioProvider()

export class LLMRouter {
  static async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<{ response: string; totalTokens?: number }> {
    switch (config.provider) {
      case 'ollama':
        return ollama.stream(messages, config, onToken)
      case 'lmstudio':
        return lmstudio.stream(messages, config, onToken)
      default:
        throw new Error(`Unknown provider: ${config.provider}. Use "ollama" or "lmstudio".`)
    }
  }

  static getOllamaProvider():   OllamaProvider   { return ollama }
  static getLMStudioProvider(): LMStudioProvider { return lmstudio }
}
