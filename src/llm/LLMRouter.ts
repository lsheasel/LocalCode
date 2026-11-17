import { Message, LLMConfig, StreamResult, ToolSchema } from '../shared/types'
import { OllamaProvider } from './providers/OllamaProvider'
import { LMStudioProvider } from './providers/LMStudioProvider'

const ollama   = new OllamaProvider()
const lmstudio = new LMStudioProvider()
const toolSupport = new Map<string, Promise<boolean>>()

export class LLMRouter {
  static async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void,
    /** Aborting it cancels the request on the server too. */
    signal?: AbortSignal,
    /** Offered through the native tool API; omit for text mode. */
    tools?: ToolSchema[],
    onToolDelta?: (text: string) => void,
  ): Promise<StreamResult> {
    switch (config.provider) {
      case 'ollama':
        return ollama.stream(messages, config, onToken, signal, tools, onToolDelta)
      case 'lmstudio':
        return lmstudio.stream(messages, config, onToken, signal, tools, onToolDelta)
      default:
        throw new Error(`Unknown provider: ${config.provider}. Use "ollama" or "lmstudio".`)
    }
  }

  /** The model's context window in tokens, or null if the server won't say. */
  static async contextLength(config: LLMConfig): Promise<number | null> {
    switch (config.provider) {
      case 'ollama':
        return ollama.contextLength(config.model, config.baseURL)
      case 'lmstudio':
        return lmstudio.contextLength(config.model, config.baseURL)
      default:
        return null
    }
  }

  /**
   * Whether native tool calling really works for this model. The server's
   * capability flag is not enough: a custom prompt template (seen in LM
   * Studio) can drop the tool definitions, and the model never sees them.
   * So a model that claims support gets one tiny test call. Checked once per
   * model and process; concurrent callers share the same check.
   */
  static supportsTools(config: LLMConfig): Promise<boolean> {
    const key = `${config.provider}|${config.baseURL ?? ''}|${config.model}`
    let known = toolSupport.get(key)
    if (!known) {
      known = (async () => {
        const claims =
          config.provider === 'ollama' ? await ollama.supportsTools(config.model, config.baseURL)
          : config.provider === 'lmstudio' ? await lmstudio.supportsTools(config.model, config.baseURL)
          : false
        return claims && (await LLMRouter.probeTools(config))
      })()
      toolSupport.set(key, known)
    }
    return known
  }

  /** One short request offering a "ping" tool: does the model call it? */
  private static async probeTools(config: LLMConfig): Promise<boolean> {
    try {
      const result = await LLMRouter.stream(
        [{ role: 'user', content: 'Call the ping tool now. Do not answer with text.' }],
        { ...config, maxTokens: 512, temperature: 0 },
        () => {},
        AbortSignal.timeout(30_000),
        [{ name: 'ping', description: 'Check that tool calling works.', parameters: { type: 'object', properties: {}, required: [] } }],
      )
      return !!result.toolCalls?.some((c) => c.name === 'ping')
    } catch {
      return false
    }
  }

  /** Remember that the server rejected native tools for this model. */
  static markNoTools(config: LLMConfig): void {
    toolSupport.set(`${config.provider}|${config.baseURL ?? ''}|${config.model}`, Promise.resolve(false))
  }

  /** The LLM settings for a mode: plan/debug may name their own model. */
  static forMode(config: LLMConfig, mode: string): LLMConfig {
    const override = config.modeModels?.[mode as 'plan' | 'debug']
    return override ? { ...config, model: override } : config
  }

  static getOllamaProvider():   OllamaProvider   { return ollama }
  static getLMStudioProvider(): LMStudioProvider { return lmstudio }
}
