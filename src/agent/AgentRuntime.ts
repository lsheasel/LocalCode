import { EventEmitter } from 'events'
import * as os from 'os'
import { resolve, dirname } from 'path'
import { readFile } from 'fs/promises'

interface ConfirmResult { ok: boolean; trust: boolean }
import { Message, ToolCall, ToolResult, Attachment, ToolSchema, NativeToolCall, LLMConfig } from '../shared/types'
import { LLMRouter } from '../llm/LLMRouter'
import { toolsFor } from './toolSchemas'
import { loadInstructions } from './projectInstructions'
import { executeTool } from './tools'
import { planEdit } from './tools/fuzzyEdit'
import { parseToolCall, looksLikeToolCall } from './toolCallParser'
import { checkpoints } from './checkpoints'
import { ConfigManager } from '../config/ConfigManager'
import { CommandGuard } from '../security/CommandGuard'
import { MAX_AGENT_ITERATIONS } from '../shared/constants'
import { CONVERSATIONAL_SYSTEM_PROMPT, systemPrompt } from '../shared/prompts'
import { globalRegistry } from '../plugins/registry.js'

export type AgentMode = 'build' | 'plan' | 'debug'

// Short inputs that are clearly conversational — no tools needed
const CONVERSATIONAL = /^(hi|hey|hello|sup|yo|hallo|hej|ciao|howdy|how are you|what can you do|what are you|who are you|thanks|thank you|danke|ok|okay|cool|nice|great|good|yes|no|nope|yep|sure|help me|what\??)[\s!?.]*$/i

/** Unreadable tool calls in a row the model gets to fix before the task stops. */
const MAX_UNREADABLE = 2
/** Identical consecutive tool calls: warn the model at the 3rd, stop at the 5th. */
const REPEAT_WARN = 3
const REPEAT_STOP = 5

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_files', 'find_files', 'search_files',
  'git_status', 'git_diff', 'git_log', 'lsp_check',
  'lsp_hover', 'lsp_definition',
  'run_tests', 'web_search', 'web_fetch',
])

// Plan mode investigates the codebase before planning, but must not change it.
// Subset of READ_ONLY_TOOLS (no run_tests) so plan mode never triggers a
// confirmation dialog. Keep in sync with TOOLS_READONLY in shared/prompts.ts.
const PLAN_ALLOWED_TOOLS = new Set([
  'read_file', 'list_files', 'find_files', 'search_files',
  'git_status', 'git_diff', 'git_log',
  'lsp_check', 'lsp_hover', 'lsp_definition',
  'web_search', 'web_fetch',
])

export class AgentRuntime extends EventEmitter {
  private aborted = false
  private confirmResolve: ((result: ConfirmResult) => void) | null = null
  private injectionQueue: string[] = []

  abort(): void {
    this.aborted = true
    // Cancel the running request so the server stops generating — it would
    // otherwise keep the model busy and make the next request wait.
    this.requestCtl?.abort()
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

  async run(instruction: string, cwd?: string, attachments: Attachment[] = [], mode: AgentMode = 'build', history: Message[] = []): Promise<void> {
    this.aborted = false
    const config = ConfigManager.getInstance().get()
    // Plan / debug mode may run on a model of their own.
    const llm = LLMRouter.forMode(config.llm, mode)
    const workDir = cwd || config.workspaceDir || os.homedir()
    checkpoints.beginTask()
    this.genTokens = 0
    this.genMs = 0

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
    // Only a fresh conversation takes the shortcut: mid-conversation, "ok" or
    // "yes" answer a question the agent asked and need the history and tools.
    if (CONVERSATIONAL.test(instruction.trim()) && !attachments.length && history.length === 0) {
      this.emit('thinking')
      let fullResponse = ''
      const msgs: Message[] = [
        { role: 'system', content: CONVERSATIONAL_SYSTEM_PROMPT },
        { role: 'user', content: instruction },
      ]
      try {
        const result = await this.streamTimed(msgs, llm, (token: string) => {
          fullResponse += token
        })
        fullResponse = result.response || fullResponse
      } catch (err) {
        if (!this.aborted) this.emit('error', friendlyLLMError(err, llm))
        this.emitDone({ response: '', aborted: this.aborted })
        return
      }
      this.emitDone({ response: fullResponse || 'DONE: Hey! I\'m LocalCode. Give me a coding task and I\'ll get to work.' })
      return
    }

    // Plan mode runs the same loop, but may only observe — see PLAN_ALLOWED_TOOLS.
    const planMode = mode === 'plan'

    // Plugin tools can write, so they are not offered while planning.
    const registryTools = planMode ? [] : globalRegistry.listTools()
    const pluginSection = registryTools.length > 0
      ? '\n\n### Plugin Tools\n' + registryTools
          .map(t => `- **${t.name}**: ${t.description}\n  {"tool": "${t.name}", "arguments": {}}`)
          .join('\n')
      : ''

    // Tools go through the server's function-calling API when the model
    // supports it — no JSON to get wrong in the answer text. Otherwise they
    // are described in the prompt and parsed from the reply (text mode).
    let native = await wantsNativeTools(llm)
    const instructions = loadInstructions(workDir)
    if (instructions.sources.length) this.emit('instructions', { sources: instructions.sources })
    const promptFor = (nativeTools: boolean) =>
      systemPrompt(mode, { native: nativeTools, instructions: instructions.text }) + (nativeTools ? '' : pluginSection)
    const nativeTools: ToolSchema[] = toolsFor(
      (name) => !planMode || PLAN_ALLOWED_TOOLS.has(name),
      registryTools,
    )
    this.emit('tool_mode', { native })

    const messages: Message[] = [
      { role: 'system', content: promptFor(native) },
      ...history,
      { role: 'user', content: userContent, ...(images.length ? { images } : {}) },
    ]

    this.emit('start', { instruction, cwd: workDir })
    this.injectionQueue = []
    let accumulatedTokens = 0
    const debugMode = !!config.debugMode
    // Small models sometimes repeat the exact same call forever (seen: read_file
    // on the same file 25 times in a row). Track identical consecutive calls.
    let lastCallKey = ''
    let repeats = 0
    // Responses that tried to call a tool but couldn't be read, in a row.
    let unreadable = 0

    for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
      if (this.aborted) {
        this.emitDone({ response: 'Task aborted by user.', aborted: true })
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
      const iterStart = Date.now()

      const MAX_RETRIES = 3
      let lastErr: unknown
      let streamed = false
      let truncated = false
      let calls: NativeToolCall[] = []
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (this.aborted) break
        try {
          fullResponse = ''
          const result = await this.streamTimed(messages, llm, (token: string) => {
            fullResponse += token
          }, native ? nativeTools : undefined)
          fullResponse = result.response || fullResponse
          iterTokens = result.totalTokens
          truncated = !!result.truncated
          calls = result.toolCalls ?? []
          streamed = true
          break
        } catch (err) {
          lastErr = err
          if ((err as Error)?.name === 'ToolsNotSupportedError' && native) {
            // The server doesn't take tool definitions for this model: switch
            // to text mode for the rest of the session and try again at once.
            LLMRouter.markNoTools(llm)
            native = false
            messages[0] = { role: 'system', content: promptFor(false) }
            this.emit('tool_mode', { native: false })
            this.emit('notice', 'This model does not support native tool calling — using text mode.')
            attempt--
            continue
          }
          // Stopped by the user, or the server went silent: retrying would
          // only make the wait longer.
          if (this.aborted || (err as Error)?.name === 'StreamStalledError') break
          if (attempt < MAX_RETRIES - 1) {
            // brief pause before retry, emit a token so UI shows we're retrying
            this.emit('token', `\n[Retrying after error: ${String(err).split('\n')[0]}]\n`)
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
          }
        }
      }
      if (!streamed) {
        if (this.aborted) {
          this.emitDone({ response: '', aborted: true })
          return
        }
        const msg = friendlyLLMError(lastErr, llm)
        this.emit('error', msg)
        this.emitDone({ response: '' })
        return
      }

      if (iterTokens) accumulatedTokens += iterTokens
      if (debugMode) {
        this.emit('debug_info', { iteration: i + 1, tokens: iterTokens, elapsed: Date.now() - iterStart })
      }

      // Abort may have been triggered while streaming — check before acting on the response
      if (this.aborted) {
        this.emitDone({ response: '', aborted: true })
        return
      }

      // Native calls: one per turn. If the model sent several, only the first
      // goes into the history, so every call there has exactly one result.
      const call = calls[0]
      messages.push(call
        ? { role: 'assistant', content: fullResponse, tool_calls: [call] }
        : { role: 'assistant', content: fullResponse })
      // Feedback and results answer the call they belong to: a tool message
      // for a native call, a user message in text mode.
      const reply = (content: string) =>
        messages.push(call ? { role: 'tool', tool_call_id: call.id, content } : { role: 'user', content })

      const toolCall: ToolCall | null = call ? nativeToolCall(call) : parseToolCall(fullResponse)

      if (call && !toolCall) {
        // Arguments that are not valid JSON, even after repair.
        if (unreadable < MAX_UNREADABLE) {
          unreadable++
          this.emit('notice', truncated
            ? 'The answer hit the max-tokens limit — asking the model to write it in smaller parts.'
            : 'The tool call came back with invalid arguments — asking the model to send it again.')
          reply(truncated
            ? 'The call was cut off at the output token limit, so its arguments are incomplete and nothing was executed. Call it again with less content: for a long file, write_file the first part, then append_file the rest in further calls.'
            : 'The arguments of this call are not valid JSON, so nothing was executed. Call the tool again with valid arguments.')
          continue
        }
        this.emitDone({
          response: 'Stopped: the model could not produce a readable tool call. Try a smaller step, e.g. "create only index.html first".',
          tokenCount: accumulatedTokens || undefined,
        })
        return
      }

      if (!toolCall) {
        // A tool call that came back broken — or an answer cut off at the
        // token limit — is not the end of the task. Tell the model what went
        // wrong and let it try again instead of stopping without a word.
        if ((truncated || looksLikeToolCall(fullResponse)) && unreadable < MAX_UNREADABLE) {
          unreadable++
          this.emit('notice', truncated
            ? 'The answer hit the max-tokens limit — asking the model to write it in smaller parts.'
            : 'The tool call came back as invalid JSON — asking the model to send it again.')
          messages.push({
            role: 'user',
            content: truncated
              ? 'Your last response was cut off at the output token limit, so the tool call was incomplete and nothing happened. Send it again in smaller parts: for a long file, write_file the first part, then append_file the rest in further calls. Keep each call well under the limit.'
              : 'Your last tool call could not be read: it is not valid JSON (often a missing closing brace, or unescaped line breaks/quotes inside a string). Nothing was executed. Send exactly one tool call again as valid JSON: {"tool": "...", "arguments": {...}} — escape line breaks as \\n and quotes as \\" inside strings. For long file content, split it with write_file + append_file.',
          })
          continue
        }
        const clean = extractDoneSummary(fullResponse)
        this.emitDone({
          response: clean || (unreadable
            ? 'Stopped: the model could not produce a readable tool call. Try a smaller step, e.g. "create only index.html first".'
            : 'The model stopped without a final answer. Say "continue" (or "mach weiter") to let it go on.'),
          tokenCount: accumulatedTokens || undefined,
        })
        return
      }
      unreadable = 0

      const callKey = `${toolCall.tool}:${JSON.stringify(toolCall.arguments)}`
      repeats = callKey === lastCallKey ? repeats + 1 : 1
      lastCallKey = callKey
      if (repeats >= REPEAT_STOP) {
        this.emitDone({
          response: `Stopped: the model kept repeating the same step (${toolCall.tool} ${JSON.stringify(toolCall.arguments).slice(0, 80)}) without making progress. Try rephrasing the task${mode === 'plan' ? ', or switch to build mode (tab) to make changes' : ''}.`,
          tokenCount: accumulatedTokens || undefined,
        })
        return
      }
      if (repeats >= REPEAT_WARN) {
        reply(
          `You already called "${toolCall.tool}" with exactly these arguments ${repeats - 1} times and got the same result each time. Do not call it again — use the result you already have and take the next step${mode === 'plan' ? ' (in plan mode you cannot change files: write the plan, or tell the user to switch to build mode)' : ''}.`,
        )
        continue
      }

      // Plan mode may only observe. Reject anything that would change state and
      // feed the refusal back, so the model plans the change instead of making it.
      if (planMode && !PLAN_ALLOWED_TOOLS.has(toolCall.tool)) {
        const result: ToolResult = {
          success: false,
          output: '',
          error: `"${toolCall.tool}" is not available in plan mode (read-only).`,
        }
        this.emit('tool_call', { toolCall })
        this.emit('tool_result', { toolCall, result })
        reply(`Tool "${toolCall.tool}" was rejected: plan mode is read-only and cannot modify anything. Do not call it again. Keep investigating with the read-only tools, or write the final plan now and describe this change as one of its steps.`)
        continue
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
            // Same tolerant matching the edit itself will use, so the preview
            // shows exactly what is about to change.
            const outcome = planEdit(content, oldStr, newStr)
            if (outcome.ok) {
              const { startLine, oldLines, newLines } = outcome.plan
              const allLines = content.split(/\r?\n/)
              const CONTEXT = 3
              diffPreview = {
                filePath,
                oldLines,
                newLines,
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
            const result = await executeTool(toolCall, workDir, this.outputFor(toolCall))
            this.emit('tool_result', { toolCall, result })
            reply(resultText(toolCall, result, !!call))
            if (fullResponse.includes('DONE:')) {
              const summary = extractDoneSummary(fullResponse)
              if (summary) { this.emitDone({ response: summary, tokenCount: accumulatedTokens || undefined }); return }
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
          this.emitDone({
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
      const toolStart = Date.now()
      const result = await executeTool(toolCall, workDir, this.outputFor(toolCall))
      if (debugMode) {
        this.emit('debug_info', { tool: toolCall.tool, elapsed: Date.now() - toolStart, success: result.success })
      }
      this.emit('tool_result', { toolCall, result })

      // Never put images into tool-result messages — llama.cpp only supports vision
      // tokens in the first user message; images in later turns crash the tokenizer.
      reply(resultText(toolCall, result, !!call))

      if (fullResponse.includes('DONE:')) {
        const summary = extractDoneSummary(fullResponse)
        if (summary) { this.emitDone({ response: summary, tokenCount: accumulatedTokens || undefined }); return }
      }
    }

    this.emitDone({ response: 'Reached maximum iteration limit.', tokenCount: accumulatedTokens || undefined })
  }

  // ── Generation stats ──────────────────────────────────────────────────────
  // Tokens generated and the time spent generating them (first token to end
  // of each completion), summed over the task — gives an honest tokens/s.
  private genTokens = 0
  private genMs = 0
  /** The request in flight — aborted together with the task. */
  private requestCtl: AbortController | null = null

  /**
   * Stream one completion: forwards tokens to the UI, measures generation
   * speed, and reports how much of the context window the request used.
   */
  private async streamTimed(
    messages: Message[],
    llm: import('../shared/types').LLMConfig,
    onToken: (token: string) => void,
    tools?: ToolSchema[],
  ): Promise<import('../shared/types').StreamResult> {
    let first = 0
    let pieces = 0
    this.requestCtl = new AbortController()
    const result = await LLMRouter.stream(messages, llm, (token: string) => {
      if (!first) first = Date.now()
      pieces++
      this.emit('token', token)
      onToken(token)
    }, this.requestCtl.signal, tools, (text: string) => {
      // A native call being written: the UI sees it like a text-mode call
      // ({"tool": …}) and shows "Writing index.html… 3.2k chars".
      if (!first) first = Date.now()
      pieces++
      this.emit('token', text)
    })
    if (first) {
      this.genMs += Date.now() - first
      // Servers report generated tokens; the number of streamed pieces is a
      // close stand-in when they don't.
      this.genTokens += result.completionTokens ?? pieces
    }
    if (result.totalTokens) this.emit('usage', { contextTokens: result.totalTokens })
    return result
  }

  private emitDone(payload: { response: string; aborted?: boolean; tokenCount?: number }): void {
    const tokensPerSec = this.genMs > 250 ? this.genTokens / (this.genMs / 1000) : undefined
    // Tokens the model wrote for this task — the prompt resent each round is
    // not counted (the sidebar shows the context in use).
    const tokenCount = this.genTokens || undefined
    this.emit('done', { ...payload, tokenCount, tokensPerSec })
  }

  /** Live output of a running tool, for the UI. */
  private outputFor(toolCall: ToolCall): (chunk: string) => void {
    return (chunk: string) => this.emit('tool_output', { toolCall, chunk })
  }

  private waitForConfirmation(): Promise<{ confirmed: boolean; timedOut: boolean; trustFolder: boolean }> {
    return new Promise((resolve) => {
      this.confirmResolve = ({ ok, trust }) => resolve({ confirmed: ok, timedOut: false, trustFolder: trust })
    })
  }
}

/** Use the native tool API for this model? (config llm.toolMode, default auto) */
async function wantsNativeTools(llm: LLMConfig): Promise<boolean> {
  const mode = llm.toolMode ?? 'auto'
  if (mode === 'text') return false
  if (mode === 'native') return true
  return LLMRouter.supportsTools(llm)
}

/** A native call as a ToolCall; null if its arguments can't be read even after repair. */
function nativeToolCall(call: NativeToolCall): ToolCall | null {
  const raw = (call.arguments || '').trim() || '{}'
  try {
    const args = JSON.parse(raw)
    if (args && typeof args === 'object' && !Array.isArray(args)) return { tool: call.name, arguments: args }
  } catch {}
  // Same repair as text mode: missing closing braces, raw line breaks.
  const repaired = parseToolCall(`{"tool": ${JSON.stringify(call.name)}, "arguments": ${raw}`)
  return repaired && repaired.tool === call.name ? repaired : null
}

/** What the model gets back from a tool. */
function resultText(tc: ToolCall, result: ToolResult, native: boolean): string {
  if (native) {
    return result.success
      ? result.output || '(no output)'
      : `Error: ${result.error || 'Unknown error'}\n\nTry a different approach and continue the task.`
  }
  return result.success
    ? `Tool "${tc.tool}" result:\n${result.output}`
    : `Tool "${tc.tool}" failed with error:\n${result.error || 'Unknown error'}\n\nTry a different approach and continue the task.`
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
    case 'web_search':    return `Search the web: ${String(a.query || '')}`
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
  if ((err as Error)?.name === 'StreamStalledError') return (err as Error).message
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

export interface DiffPreview {
  filePath: string
  oldLines: string[]
  newLines: string[]
  startLine: number
  contextBefore: string[]
  contextAfter: string[]
}
