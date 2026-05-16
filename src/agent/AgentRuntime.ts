import { EventEmitter } from 'events'
import * as os from 'os'
import { resolve, dirname } from 'path'
import { readFile } from 'fs/promises'

interface ConfirmResult { ok: boolean; trust: boolean }
import { Message, ToolCall, ToolResult, Attachment } from '../shared/types'
import { LLMRouter } from '../llm/LLMRouter'
import { executeTool } from './tools'
import { ConfigManager } from '../config/ConfigManager'
import { CommandGuard } from '../security/CommandGuard'
import { AGENT_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, MAX_AGENT_ITERATIONS } from '../shared/constants'
import { globalRegistry } from '../plugins/registry.js'

// Short inputs that are clearly conversational — no tools needed
const CONVERSATIONAL = /^(hi|hey|hello|sup|yo|hallo|hej|ciao|howdy|how are you|what can you do|what are you|who are you|thanks|thank you|danke|ok|okay|cool|nice|great|good|yes|no|nope|yep|sure|help me|what\??)[\s!?.]*$/i

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_files', 'find_files', 'search_files',
  'git_status', 'git_diff', 'git_log', 'lsp_check',
  'lsp_hover', 'lsp_definition',
  'run_tests', 'web_fetch',
])

export class AgentRuntime extends EventEmitter {
  private aborted = false
  private confirmResolve: ((result: ConfirmResult) => void) | null = null
  private injectionQueue: string[] = []

  abort(): void {
    this.aborted = true
    this.confirmResolve?.({ ok: false, trust: false })
    this.confirmResolve = null
  }

  confirm(approved: boolean, trustFolder = false): void {
    this.confirmResolve?.({ ok: approved, trust: trustFolder })
    this.confirmResolve = null
  }

  /** Inject a mid-task user message — picked up on the next agent iteration. */
  inject(message: string): void {
    this.injectionQueue.push(message)
  }

  async run(instruction: string, cwd?: string, attachments: Attachment[] = [], mode: 'build' | 'plan' = 'build', history: Message[] = []): Promise<void> {
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
        const result = await LLMRouter.stream(msgs, config.llm, (token: string) => {
          this.emit('token', token)
          fullResponse += token
        })
        fullResponse = result.response || fullResponse
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
        const result = await LLMRouter.stream(planMsgs, config.llm, (token: string) => {
          this.emit('token', token)
          fullResponse += token
        })
        fullResponse = result.response || fullResponse
        this.emit('done', { response: fullResponse, tokenCount: result.totalTokens })
      } catch (err) {
        this.emit('error', friendlyLLMError(err, config.llm))
        this.emit('done', { response: '' })
      }
      return
    }

    const registryTools = globalRegistry.listTools()
    const pluginSection = registryTools.length > 0
      ? '\n\n### Plugin Tools\n' + registryTools
          .map(t => `- **${t.name}**: ${t.description}\n  {"tool": "${t.name}", "arguments": {}}`)
          .join('\n')
      : ''

    const messages: Message[] = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT + pluginSection },
      ...history,
      { role: 'user', content: userContent, ...(images.length ? { images } : {}) },
    ]

    this.emit('start', { instruction, cwd: workDir })
    this.injectionQueue = []
    let accumulatedTokens = 0

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
      let iterTokens: number | undefined

      const MAX_RETRIES = 3
      let lastErr: unknown
      let streamed = false
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (this.aborted) break
        try {
          fullResponse = ''
          const result = await LLMRouter.stream(messages, config.llm, (token: string) => {
            this.emit('token', token)
            fullResponse += token
          })
          fullResponse = result.response || fullResponse
          iterTokens = result.totalTokens
          streamed = true
          break
        } catch (err) {
          lastErr = err
          if (attempt < MAX_RETRIES - 1) {
            // brief pause before retry, emit a token so UI shows we're retrying
            this.emit('token', `\n[Retrying after error: ${String(err).split('\n')[0]}]\n`)
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
          }
        }
      }
      if (!streamed) {
        const msg = friendlyLLMError(lastErr, config.llm)
        this.emit('error', msg)
        this.emit('done', { response: '' })
        return
      }

      if (iterTokens) accumulatedTokens += iterTokens

      // Abort may have been triggered while streaming — check before acting on the response
      if (this.aborted) {
        this.emit('done', { response: '', aborted: true })
        return
      }

      messages.push({ role: 'assistant', content: fullResponse })

      const toolCall = parseToolCall(fullResponse)

      if (!toolCall) {
        const clean = extractDoneSummary(fullResponse)
        this.emit('done', { response: clean, tokenCount: accumulatedTokens || undefined })
        return
      }

      // Read-only tools: skip confirmation entirely — they have no side effects
      if (!READ_ONLY_TOOLS.has(toolCall.tool)) {
        // Dangerous shell command? Ask the user explicitly with a warning before proceeding.
        let dangerous = false
        let dangerReason = ''
        if (toolCall.tool === 'run_shell') {
          const command = String(toolCall.arguments.command || '')
          const guard = CommandGuard.check(command)
          if (!guard.safe) {
            dangerous = true
            dangerReason = guard.reason ?? ''
          }
        }

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
        } else if (toolCall.tool === 'write_file') {
          const filePath = String(toolCall.arguments.path || '')
          const newContent = String(toolCall.arguments.content || '')
          try {
            const oldContent = await readFile(resolve(workDir, filePath), 'utf-8')
            // Show a simplified diff preview (first changed region)
            const oldLines = oldContent.split('\n')
            const newLines = newContent.split('\n')
            let start = 0
            while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++
            let oldEnd = oldLines.length - 1, newEnd = newLines.length - 1
            while (oldEnd > start && newEnd > start && oldLines[oldEnd] === newLines[newEnd]) { oldEnd--; newEnd-- }
            const CONTEXT = 3
            diffPreview = {
              filePath,
              oldLines: oldLines.slice(start, oldEnd + 1),
              newLines: newLines.slice(start, newEnd + 1),
              startLine: start + 1,
              contextBefore: oldLines.slice(Math.max(0, start - CONTEXT), start),
              contextAfter: newLines.slice(newEnd + 1, newEnd + 1 + CONTEXT),
            }
          } catch {}  // file doesn't exist yet → no preview needed
        }

        // Skip confirmation for trusted paths (dangerous ops always require confirm)
        if (!dangerous) {
          // For shell commands there is no file path — check workDir itself
          const targetPath = toolCall.tool === 'run_shell'
            ? workDir
            : resolve(workDir, String(toolCall.arguments.path || toolCall.arguments.from || ''))
          if (ConfigManager.getInstance().isTrusted(targetPath)) {
            // auto-approved — skip dialog
            this.emit('tool_call', { toolCall })
            const result = await executeTool(toolCall, workDir)
            this.emit('tool_result', { toolCall, result })
            const toolMsg: Message = {
              role: 'user',
              content: result.success
                ? `Tool "${toolCall.tool}" result:\n${result.output}`
                : `Tool "${toolCall.tool}" failed with error:\n${result.error || 'Unknown error'}\n\nTry a different approach and continue the task.`,
            }
            messages.push(toolMsg)
            if (fullResponse.includes('DONE:')) {
              const summary = extractDoneSummary(fullResponse)
              if (summary) { this.emit('done', { response: summary, tokenCount: accumulatedTokens || undefined }); return }
            }
            continue
          }
        }

        const confirmReason = dangerous ? dangerReason : toolCallReason(toolCall)
        this.emit('confirm_required', { toolCall, reason: confirmReason, diffPreview, dangerous })
        const { confirmed, timedOut, trustFolder } = await this.waitForConfirmation()
        // If user chose "trust folder", trust the whole working directory
        // so all subsequent operations (file writes AND shell commands) are auto-approved
        if (confirmed && trustFolder) {
          ConfigManager.getInstance().trustPath(workDir)
        }
        if (!confirmed) {
          const result: ToolResult = { success: false, output: '', error: timedOut ? 'Confirmation timed out' : 'Denied by user' }
          this.emit('tool_result', { toolCall, result })
          this.emit('done', {
            response: timedOut
              ? 'No response in 30 seconds — task stopped.'
              : dangerous
                ? 'Task stopped — dangerous command denied.'
                : 'Task stopped — action denied by user.',
            aborted: true,
          })
          return
        }
      }

      this.emit('tool_call', { toolCall })
      const result = await executeTool(toolCall, workDir)
      this.emit('tool_result', { toolCall, result })

      // Never put images into tool-result messages — llama.cpp only supports vision
      // tokens in the first user message; images in later turns crash the tokenizer.
      const toolMsg: Message = {
        role: 'user',
        content: result.success
          ? `Tool "${toolCall.tool}" result:\n${result.output}`
          : `Tool "${toolCall.tool}" failed with error:\n${result.error || 'Unknown error'}\n\nTry a different approach and continue the task.`,
      }
      messages.push(toolMsg)

      if (fullResponse.includes('DONE:')) {
        const summary = extractDoneSummary(fullResponse)
        if (summary) { this.emit('done', { response: summary, tokenCount: accumulatedTokens || undefined }); return }
      }
    }

    this.emit('done', { response: 'Reached maximum iteration limit.', tokenCount: accumulatedTokens || undefined })
  }

  private waitForConfirmation(): Promise<{ confirmed: boolean; timedOut: boolean; trustFolder: boolean }> {
    return new Promise((resolve) => {
      this.confirmResolve = ({ ok, trust }) => resolve({ confirmed: ok, timedOut: false, trustFolder: trust })
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
    case 'git_branch':    return `git branch ${String(a.action || 'list')}${a.name ? ` ${String(a.name)}` : ''}`
    case 'git_stash':     return `git stash ${String(a.action || 'push')}${a.message ? ` "${String(a.message)}"` : ''}`
    case 'run_tests':     return 'Run tests'
    case 'web_fetch':     return `Fetch URL: ${String(a.url || '')}`
    case 'http_request':  return `${String(a.method || 'GET')} ${String(a.url || '')}`
    case 'lsp_check':     return `LSP check: ${String(a.path || '.')}`
    default:              return tc.tool
  }
}

function extractDoneSummary(text: string): string {
  let s = text
  // Strip thinking blocks first (provider may omit opening tag, keep closing tag)
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '')
  if (s.includes('</thinking>')) s = s.replace(/^[\s\S]*<\/thinking>\s*/i, '')
  if (s.includes('</think>')) s = s.replace(/^[\s\S]*<\/think>\s*/i, '')
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
