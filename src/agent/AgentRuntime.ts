import { EventEmitter } from 'events'
import * as os from 'os'
import { resolve } from 'path'
import { readFile } from 'fs/promises'
import { Message, ToolCall, ToolResult, Attachment } from '../shared/types'
import { LLMRouter } from '../llm/LLMRouter'
import { executeTool } from './tools'
import { ConfigManager } from '../config/ConfigManager'
import { CommandGuard } from '../security/CommandGuard'
import { AGENT_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, MAX_AGENT_ITERATIONS } from '../shared/constants'

// Short inputs that are clearly conversational — no tools needed
const CONVERSATIONAL = /^(hi|hey|hello|sup|yo|hallo|hej|ciao|howdy|how are you|what can you do|what are you|who are you|thanks|thank you|danke|ok|okay|cool|nice|great|good|yes|no|nope|yep|sure|help me|what\??)[\s!?.]*$/i

export class AgentRuntime extends EventEmitter {
  private aborted = false
  private confirmResolve: ((ok: boolean) => void) | null = null
  private injectionQueue: string[] = []

  abort(): void {
    this.aborted = true
    this.confirmResolve?.(false)
    this.confirmResolve = null
  }

  confirm(approved: boolean): void {
    this.confirmResolve?.(approved)
    this.confirmResolve = null
  }

  /** Inject a mid-task user message — picked up on the next agent iteration. */
  inject(message: string): void {
    this.injectionQueue.push(message)
  }

  async run(instruction: string, cwd?: string, attachments: Attachment[] = [], mode: 'build' | 'plan' = 'build'): Promise<void> {
    this.aborted = false
    const config = ConfigManager.getInstance().get()
    const workDir = cwd || config.workspaceDir || os.homedir()

    // Build user content: file attachments as prepended context blocks
    const fileContext = attachments
      .filter(a => a.type === 'file')
      .map(a => `<file path="${a.name}">\n${a.data}\n</file>`)
      .join('\n')
    const images = attachments.filter(a => a.type === 'image').map(a => a.data)

    // Pre-fetch image URLs found in the instruction text.
    // llama.cpp only supports vision tokens in the FIRST user message, so we must
    // resolve images here and replace the URL with a placeholder so the model
    // doesn't call web_fetch on it again (which would put an image in a later message).
    let cleanedInstruction = instruction
    const imageUrlRe = /https?:\/\/\S+/g
    const urlMatches = [...instruction.matchAll(imageUrlRe)]
    for (const match of urlMatches) {
      const url = match[0].replace(/[.,;!?)]+$/, '') // strip trailing punctuation
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
        const ct = res.headers.get('content-type') || ''
        if (ct.startsWith('image/')) {
          const buf = await res.arrayBuffer()
          images.push(Buffer.from(buf).toString('base64'))
          cleanedInstruction = cleanedInstruction.replace(url, '[attached image]')
        }
      } catch {}
    }

    const userContent = fileContext
      ? `${fileContext}\n\nTask: ${cleanedInstruction}\n\nWorking directory: ${workDir}`
      : `Task: ${cleanedInstruction}\n\nWorking directory: ${workDir}`

    // Short conversational inputs — skip the tool loop entirely
    if (CONVERSATIONAL.test(instruction.trim()) && !attachments.length) {
      this.emit('thinking')
      let fullResponse = ''
      const msgs: Message[] = [
        { role: 'system', content: 'You are LocalCode, a helpful AI coding agent. Reply concisely and directly. Do NOT call any tools. End your reply with DONE: <reply>.' },
        { role: 'user', content: instruction },
      ]
      try {
        await LLMRouter.stream(msgs, config.llm, (token: string) => {
          this.emit('token', token)
          fullResponse += token
        })
      } catch (err) {
        this.emit('error', friendlyLLMError(err, config.llm))
        this.emit('done', { response: '' })
        return
      }
      this.emit('done', { response: fullResponse || 'DONE: Hey! I\'m LocalCode. Give me a coding task and I\'ll get to work.' })
      return
    }

    // Plan mode: single LLM call, no tools, structured plan output
    if (mode === 'plan') {
      this.emit('thinking')
      let fullResponse = ''
      const planMsgs: Message[] = [
        { role: 'system', content: PLAN_SYSTEM_PROMPT },
        { role: 'user', content: userContent, ...(images.length ? { images } : {}) },
      ]
      try {
        await LLMRouter.stream(planMsgs, config.llm, (token: string) => {
          this.emit('token', token)
          fullResponse += token
        })
      } catch (err) {
        this.emit('error', friendlyLLMError(err, config.llm))
        this.emit('done', { response: '' })
        return
      }
      this.emit('done', { response: fullResponse })
      return
    }

    const messages: Message[] = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      { role: 'user', content: userContent, ...(images.length ? { images } : {}) },
    ]

    this.emit('start', { instruction, cwd: workDir })
    this.injectionQueue = []

    for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
      if (this.aborted) {
        this.emit('done', { response: 'Task aborted by user.', aborted: true })
        return
      }

      // Flush any mid-task messages the user sent while the agent was running
      while (this.injectionQueue.length > 0) {
        const injection = this.injectionQueue.shift()!
        this.emit('injection', { message: injection })
        messages.push({ role: 'user', content: `[User message during task]: ${injection}` })
      }

      this.emit('thinking')
      let fullResponse = ''

      try {
        await LLMRouter.stream(messages, config.llm, (token: string) => {
          this.emit('token', token)
          fullResponse += token
        })
      } catch (err) {
        const msg = friendlyLLMError(err, config.llm)
        this.emit('error', msg)
        this.emit('done', { response: '' })
        return
      }

      messages.push({ role: 'assistant', content: fullResponse })

      const toolCall = parseToolCall(fullResponse)

      if (!toolCall) {
        const clean = extractDoneSummary(fullResponse)
        this.emit('done', { response: clean })
        return
      }

      // Security: block dangerous shell commands before asking
      if (toolCall.tool === 'run_shell') {
        const command = String(toolCall.arguments.command || '')
        const guard = CommandGuard.check(command)
        if (!guard.safe) {
          const result: ToolResult = { success: false, output: '', error: `Blocked: ${guard.reason}` }
          this.emit('tool_call', { toolCall, blocked: true, reason: guard.reason })
          this.emit('tool_result', { toolCall, result })
          messages.push({
            role: 'user',
            content: `Command was blocked by security guard: ${guard.reason}. Choose a safer approach.`,
          })
          continue
        }
      }

      // Universal confirmation: ask for EVERY tool before executing
      let diffPreview: DiffPreview | undefined
      if (toolCall.tool === 'edit_file') {
        const filePath = String(toolCall.arguments.path || '')
        const oldStr = String(toolCall.arguments.old || '')
        const newStr = String(toolCall.arguments.new || '')
        try {
          const content = await readFile(resolve(workDir, filePath), 'utf-8')
          if (content.includes(oldStr)) {
            const idx = content.indexOf(oldStr)
            const startLine = content.slice(0, idx).split('\n').length
            const allLines = content.split('\n')
            const oldLines = oldStr.split('\n')
            const CONTEXT = 3
            diffPreview = {
              filePath,
              oldLines,
              newLines: newStr.split('\n'),
              startLine,
              contextBefore: allLines.slice(Math.max(0, startLine - 1 - CONTEXT), startLine - 1),
              contextAfter: allLines.slice(startLine - 1 + oldLines.length, startLine - 1 + oldLines.length + CONTEXT),
            }
          }
        } catch {}
      }

      const confirmReason = toolCallReason(toolCall)
      this.emit('confirm_required', { toolCall, reason: confirmReason, diffPreview })
      const confirmed = await this.waitForConfirmation()
      if (!confirmed) {
        const result: ToolResult = { success: false, output: '', error: 'Denied by user' }
        this.emit('tool_result', { toolCall, result })
        this.emit('done', { response: 'Task stopped — action denied by user.', aborted: true })
        return
      }

      this.emit('tool_call', { toolCall })
      const result = await executeTool(toolCall, workDir)
      this.emit('tool_result', { toolCall, result })

      // Never put images into tool-result messages — llama.cpp only supports vision
      // tokens in the first user message; images in later turns crash the tokenizer.
      const toolMsg: Message = {
        role: 'user',
        content: `Tool "${toolCall.tool}" result:\n${
          result.success ? result.output : `ERROR: ${result.error || 'Unknown error'}`
        }`,
      }
      messages.push(toolMsg)

      if (fullResponse.includes('DONE:')) {
        const summary = extractDoneSummary(fullResponse)
        if (summary) { this.emit('done', { response: summary }); return }
      }
    }

    this.emit('done', { response: 'Reached maximum iteration limit.' })
  }

  private waitForConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmResolve = resolve
      setTimeout(() => {
        if (this.confirmResolve) {
          this.confirmResolve = null
          resolve(false)
        }
      }, 30000)
    })
  }
}

function toolCallReason(tc: ToolCall): string {
  const a = tc.arguments
  switch (tc.tool) {
    case 'run_shell':     return `Shell: ${String(a.command || '')}`
    case 'read_file':     return `Read file: ${String(a.path || '')}`
    case 'write_file':    return `Write file: ${String(a.path || '')}`
    case 'append_file':   return `Append to file: ${String(a.path || '')}`
    case 'edit_file':     return `Edit file: ${String(a.path || '')}`
    case 'delete_file':   return `Delete: ${String(a.path || '')}`
    case 'move_file':     return `Move: ${String(a.from || '')} → ${String(a.to || '')}`
    case 'copy_file':     return `Copy: ${String(a.from || '')} → ${String(a.to || '')}`
    case 'create_dir':    return `Create directory: ${String(a.path || '')}`
    case 'list_files':    return `List files: ${String(a.path || '.')}`
    case 'find_files':    return `Find files: "${String(a.pattern || '')}" in ${String(a.path || '.')}`
    case 'search_files':  return `Search "${String(a.pattern || '')}" in ${String(a.path || '.')}`
    case 'git_status':    return 'git status'
    case 'git_diff':      return 'git diff'
    case 'git_log':       return `git log (last ${String(a.limit || 20)})`
    case 'git_commit':    return `git commit: ${String(a.message || '')}`
    case 'web_fetch':     return `Fetch URL: ${String(a.url || '')}`
    case 'http_request':  return `${String(a.method || 'GET')} ${String(a.url || '')}`
    case 'lsp_check':     return `LSP check: ${String(a.path || '.')}`
    default:              return tc.tool
  }
}

function extractDoneSummary(text: string): string {
  let s = text
  s = s.replace(/```json[\s\S]*?```/gi, '')
  s = s.replace(/\{[\s\S]*?"tool"\s*:[\s\S]*?"arguments"\s*:[\s\S]*?\}/g, '')
  // If there's text before DONE:, keep only that (model repeated itself after DONE:)
  const beforeDone = s.match(/^([\s\S]+?)\s*DONE:\s*(?:<[^>]*>)?/i)
  if (beforeDone && beforeDone[1].trim()) return beforeDone[1].trim()
  // Otherwise extract what's after DONE:
  const afterDone = s.match(/DONE:\s*(?:<([^>]*)>|([\s\S]*))/)
  if (afterDone) s = (afterDone[1] || afterDone[2] || '').trim()
  return s.trim()
}

function friendlyLLMError(err: unknown, cfg: { provider: string; baseURL?: string; model: string }): string {
  const raw = String(err)
  const low = raw.toLowerCase()

  if (low.includes('fetch failed') || low.includes('econnrefused') || low.includes('econnreset') || low.includes('network')) {
    if (cfg.provider === 'ollama') {
      return [
        'Ollama is not reachable.',
        '',
        '  • Start Ollama:  ollama serve',
        '  • Pull model:    ollama pull ' + cfg.model,
        '  • URL:           ' + (cfg.baseURL || 'http://localhost:11434'),
        '',
        '  Switch provider: /config provider lmstudio',
      ].join('\n')
    }
    if (cfg.provider === 'lmstudio') {
      return [
        'LM Studio is not reachable.',
        '',
        '  • Open LM Studio and start a Local Server',
        '  • URL:  ' + (cfg.baseURL || 'http://localhost:1234/v1'),
        '',
        '  Change URL: /config url http://localhost:1234/v1',
      ].join('\n')
    }
    return [
      `Connection failed (${cfg.provider}).`,
      '  Check URL: /config url <url>',
    ].join('\n')
  }

  if ((low.includes('model') && (low.includes('not found') || low.includes('does not exist'))) || low.includes('404')) {
    return [
      `Model "${cfg.model}" not found.`,
      '',
      '  • Switch model:  /config model <name>',
      '  • List models:   /models',
    ].join('\n')
  }

  return raw
}

function parseToolCall(text: string): ToolCall | null {
  // Find every '{' and try to parse a complete JSON object from that position.
  // This handles nested braces, strings with special characters, and code content.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    // Walk forward tracking depth, respecting string boundaries
    let depth = 0
    let inString = false
    let escape = false
    let j = i
    for (; j < text.length; j++) {
      const ch = text[j]
      if (escape) { escape = false; continue }
      if (ch === '\\' && inString) { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) break }
    }
    if (depth !== 0) continue
    const candidate = text.slice(i, j + 1)
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed.tool === 'string' && parsed.arguments !== null && typeof parsed.arguments === 'object') {
        return parsed as ToolCall
      }
    } catch {}
  }
  return null
}

export interface DiffPreview {
  filePath: string
  oldLines: string[]
  newLines: string[]
  startLine: number
  contextBefore: string[]
  contextAfter: string[]
}
