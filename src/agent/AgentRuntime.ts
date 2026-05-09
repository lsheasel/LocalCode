import { EventEmitter } from 'events'
import * as os from 'os'
import { resolve } from 'path'
import { readFile } from 'fs/promises'
import { Message, ToolCall, ToolResult } from '../shared/types'
import { LLMRouter } from '../llm/LLMRouter'
import { executeTool } from './tools'
import { ConfigManager } from '../config/ConfigManager'
import { CommandGuard } from '../security/CommandGuard'
import { AGENT_SYSTEM_PROMPT, MAX_AGENT_ITERATIONS } from '../shared/constants'

// Short inputs that are clearly conversational — no tools needed
const CONVERSATIONAL = /^(hi|hey|hello|sup|yo|hallo|hej|ciao|howdy|how are you|what can you do|what are you|who are you|thanks|thank you|danke|ok|okay|cool|nice|great|good|yes|no|nope|yep|sure|help me|what\??)[\s!?.]*$/i

export class AgentRuntime extends EventEmitter {
  private aborted = false
  private confirmResolve: ((ok: boolean) => void) | null = null

  abort(): void {
    this.aborted = true
    this.confirmResolve?.(false)
    this.confirmResolve = null
  }

  confirm(approved: boolean): void {
    this.confirmResolve?.(approved)
    this.confirmResolve = null
  }

  async run(instruction: string, cwd?: string): Promise<void> {
    this.aborted = false
    const config = ConfigManager.getInstance().get()
    const workDir = cwd || config.workspaceDir || os.homedir()

    // Short conversational inputs — skip the tool loop entirely
    if (CONVERSATIONAL.test(instruction.trim())) {
      this.emit('thinking')
      let fullResponse = ''
      const msgs: Message[] = [
        { role: 'system', content: 'You are ERPCode, a helpful AI coding agent. Reply concisely and directly. Do NOT call any tools. End your reply with DONE: <reply>.' },
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

    const messages: Message[] = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      { role: 'user', content: `Task: ${instruction}\n\nWorking directory: ${workDir}` },
    ]

    this.emit('start', { instruction, cwd: workDir })

    for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
      if (this.aborted) {
        this.emit('done', { response: 'Task aborted by user.', aborted: true })
        return
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

      // ── Tool-Call zuerst prüfen (bevor DONE: check) ──────────────────────
      const toolCall = parseToolCall(fullResponse)

      if (!toolCall) {
        // Kein Tool-Call → als finale Antwort ausgeben (DONE: prefix entfernen)
        const clean = extractDoneSummary(fullResponse)
        this.emit('done', { response: clean })
        return
      }

      // Security: check shell commands
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

        if (guard.requiresConfirmation && !config.security.allowDangerousCommands) {
          this.emit('confirm_required', { toolCall, reason: `Shell: ${command}` })
          const ok = await this.waitForConfirmation()
          if (!ok) {
            const result: ToolResult = { success: false, output: '', error: 'Denied by user' }
            this.emit('tool_result', { toolCall, result })
            messages.push({ role: 'user', content: 'User denied the command. Try a different approach.' })
            continue
          }
        }
      }

      // Confirmation for file write / edit
      if (toolCall.tool === 'write_file' || toolCall.tool === 'edit_file') {
        const filePath = String(toolCall.arguments.path || '')
        const action = toolCall.tool === 'write_file' ? 'Datei erstellen/überschreiben' : 'Datei bearbeiten'

        let diffPreview: DiffPreview | undefined
        if (toolCall.tool === 'edit_file') {
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

        this.emit('confirm_required', { toolCall, reason: `${action}: ${filePath}`, diffPreview })
        const ok = await this.waitForConfirmation()
        if (!ok) {
          const result: ToolResult = { success: false, output: '', error: 'Vom User abgelehnt' }
          this.emit('tool_result', { toolCall, result })
          messages.push({ role: 'user', content: 'User hat die Datei-Operation abgelehnt. Wähle einen anderen Ansatz.' })
          continue
        }
      }

      // Confirmation for reading files outside the workspace
      if (toolCall.tool === 'read_file') {
        const filePath = String(toolCall.arguments.path || '')
        const resolved = resolve(workDir, filePath)
        const workDirNorm = resolve(workDir)
        if (!resolved.startsWith(workDirNorm)) {
          this.emit('confirm_required', { toolCall, reason: `Datei außerhalb des Workspace lesen: ${resolved}` })
          const ok = await this.waitForConfirmation()
          if (!ok) {
            const result: ToolResult = { success: false, output: '', error: 'Vom User abgelehnt' }
            this.emit('tool_result', { toolCall, result })
            messages.push({ role: 'user', content: 'User hat das Lesen der Datei abgelehnt. Wähle einen anderen Ansatz.' })
            continue
          }
        }
      }

      this.emit('tool_call', { toolCall })
      const result = await executeTool(toolCall, workDir)
      this.emit('tool_result', { toolCall, result })

      messages.push({
        role: 'user',
        content: `Tool "${toolCall.tool}" result:\n${
          result.success ? result.output : `ERROR: ${result.error || 'Unknown error'}`
        }`,
      })

      // Modell hat Tool-Call + DONE: in einer Antwort → direkt fertig
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

// Extrahiert die menschlich lesbare Zusammenfassung aus einer Modellantwort:
// - entfernt rohe JSON Tool-Calls (auch wenn in ```json ... ``` verpackt)
// - entfernt DONE: Präfix
function extractDoneSummary(text: string): string {
  let s = text
  // Entferne ```json ... ``` Blöcke
  s = s.replace(/```json[\s\S]*?```/gi, '')
  // Entferne nackte JSON Tool-Call Objekte
  s = s.replace(/\{[\s\S]*?"tool"\s*:[\s\S]*?"arguments"\s*:[\s\S]*?\}/g, '')
  // Extrahiere Text nach DONE: wenn vorhanden
  const doneMatch = s.match(/DONE:\s*([\s\S]*)/)
  if (doneMatch) s = doneMatch[1]
  return s.trim()
}

function friendlyLLMError(err: unknown, cfg: { provider: string; baseURL?: string; model: string }): string {
  const raw = String(err)
  const low = raw.toLowerCase()

  if (low.includes('fetch failed') || low.includes('econnrefused') || low.includes('econnreset') || low.includes('network')) {
    if (cfg.provider === 'ollama') {
      return [
        'Ollama ist nicht erreichbar.',
        '',
        '  • Ollama starten:   ollama serve',
        '  • Modell laden:     ollama pull ' + cfg.model,
        '  • URL:              ' + (cfg.baseURL || 'http://localhost:11434'),
        '',
        '  Alternativ: /config provider lmstudio',
      ].join('\n')
    }
    if (cfg.provider === 'lmstudio') {
      return [
        'LM Studio ist nicht erreichbar.',
        '',
        '  • LM Studio öffnen und einen lokalen Server starten',
        '  • URL:   ' + (cfg.baseURL || 'http://localhost:1234/v1'),
        '',
        '  URL anpassen: /config url http://localhost:1234/v1',
      ].join('\n')
    }
    return [
      `Verbindung fehlgeschlagen (${cfg.provider}).`,
      '  URL prüfen: /config url <url>',
    ].join('\n')
  }

  if ((low.includes('model') && (low.includes('not found') || low.includes('does not exist'))) || low.includes('404')) {
    return [
      `Modell "${cfg.model}" nicht gefunden.`,
      '',
      '  • Modell wechseln:  /config model <name>',
      '  • Liste:            /models',
    ].join('\n')
  }

  return raw
}

function parseToolCall(text: string): ToolCall | null {
  const patterns = [
    // Standalone JSON object
    /^\s*(\{"tool"\s*:[\s\S]*?"arguments"\s*:[\s\S]*?\})\s*$/,
    // JSON in markdown code block
    /```(?:json)?\s*(\{"tool"\s*:[\s\S]*?"arguments"\s*:[\s\S]*?\})\s*```/,
    // JSON anywhere with tool key
    /(\{"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\})/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      try {
        const parsed = JSON.parse(match[1])
        if (typeof parsed.tool === 'string' && parsed.arguments !== null && typeof parsed.arguments === 'object') {
          return parsed as ToolCall
        }
      } catch {}
    }
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
