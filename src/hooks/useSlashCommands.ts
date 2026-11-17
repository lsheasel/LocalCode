import { useCallback, useRef, MutableRefObject } from 'react'
import { AgentMessage, Attachment, ToolCall, ToolResult } from '../shared/types'
import { AgentRuntime, DiffPreview } from '../agent/AgentRuntime'
import { ConfigManager } from '../config/ConfigManager'
import { runShell } from '../agent/tools/shell'
import { checkpoints, displayPath } from '../agent/checkpoints'
import { describeTool } from '../shared/toolText'
import { LLMRouter } from '../llm/LLMRouter'
import { lspCheck } from '../lsp/LspRunner'
import { LspManager } from '../lsp/LspManager'
import {
  installPlugin,
  removePlugin,
  listInstalledPlugins,
} from '../plugins/installer.js'
import { globalRegistry, globalCommandRegistry } from '../plugins/registry.js'
import { loadPlugins, reloadPlugin } from '../plugins/loader.js'
import { COMPACT_SUMMARY_PROMPT } from '../shared/prompts'
import { INSTRUCTIONS_TEMPLATE, projectInstructionsPath } from '../agent/projectInstructions'
import { writeFileSync } from 'fs'
import { join, basename } from 'path'
import { loadAttachment, listCwdFiles } from '../shared/attachments'
import { parseThinking } from '../shared/utils'
import { Message } from '../shared/types'

interface ConfirmRequest {
  toolCall: ToolCall
  reason: string
  diffPreview?: DiffPreview
  dangerous?: boolean
}

interface SlashCommandsState {
  agentStatus: string
  isRunning: boolean
  attachments: Attachment[]
  mode: 'build' | 'plan' | 'debug'
  pickerIdx: number
  messages: AgentMessage[]
  convHistory: Message[]
  debugMode: boolean
}

interface SlashCommandsOptions {
  cwd: string
  exit: () => void
  addMsg: (msg: Omit<AgentMessage, 'id' | 'timestamp'>) => void
  showInfo: (title: string, lines: string[]) => void
  setInputValue: (v: string) => void
  setHistIndex: (n: number) => void
  setPickerIdx: (n: number) => void
  setAgentStatus: (s: 'idle' | 'running' | 'thinking' | 'error') => void
  setCurrentTokens: (s: string) => void
  setTokenCount: (n: number) => void
  setHistory: (h: string[]) => void
  setMessages: (msgs: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[])) => void
  setConvHistory: (h: Message[] | ((prev: Message[]) => Message[])) => void
  setAttachments: (a: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void
  setMode: (m: 'build' | 'plan' | 'debug') => void
  setConnectPopup: (b: boolean) => void
  setModelPicker: (b: boolean) => void
  setModelLoading: (b: boolean) => void
  setModelList: (l: string[]) => void
  setFilePicker: (b: boolean) => void
  setFileList: (l: string[]) => void
  setConfirm: (c: ConfirmRequest | null) => void
  setPluginCmds: (cmds: Array<{ cmd: string; description: string }>) => void
  setInfoScroll: (n: number) => void
  /** Context the last request used, in tokens. */
  setContextTokens: (n: number) => void
  /** Live output of the command or tool that is running right now. */
  setLiveOutput: (o: { title: string; text: string } | null) => void
  s: MutableRefObject<SlashCommandsState>
  agentRef: MutableRefObject<AgentRuntime | null>
  taskQueueRef: MutableRefObject<string[]>
  crashCompactRef: MutableRefObject<boolean>
  tokenBufRef: MutableRefObject<string>
  tokenCntRef: MutableRefObject<number>
  tokenFlushRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  toolMsgsRef: MutableRefObject<Message[]>
  streamInThinkingRef: MutableRefObject<boolean>
  agentStartTimeRef: MutableRefObject<number>
}

/**
 * "Carry out the plan" in German or English: umsetzen, setz … um, mach nach
 * Plan, wie geplant, implement, mach das, los, go ahead, follow the plan …
 */
const IMPLEMENT_INTENT =
  /\b(umsetzen|setz\w*\b.*\bum\b|implementier(e|en|st|t)?|implement|ausf(ü|ue)hren|f(ü|ue)hr\w*\b.*\baus\b|mach\w*\s+(es|das|mal|los|weiter|nach|so)|nach\s+(dem\s+|deinem\s+|diesem\s+)?plan|wie\s+geplant|leg\s+los|los\s+geht|go\s+ahead|do\s+it|execute|build\s+it|apply\s+(it|the\s+plan)|follow\s+(the|this|your)\s+plan|according\s+to\s+(the|this|your)\s+plan|start\s+(coding|building))\b|^(go|los|mach|ja\s+mach|yes\s+do\s+it)[\s!.]*$/i

/** Shell passthrough output kept in the transcript; the rest is summarised. */
const SHELL_OUTPUT_LINES = 200

export function useSlashCommands(opts: SlashCommandsOptions) {
  const {
    cwd, exit, addMsg, showInfo,
    setInputValue, setHistIndex, setPickerIdx,
    setAgentStatus, setCurrentTokens, setTokenCount,
    setHistory, setMessages, setConvHistory, setAttachments,
    setMode, setConnectPopup, setModelPicker, setModelLoading,
    setModelList, setFilePicker, setFileList, setConfirm,
    setPluginCmds, setInfoScroll, setContextTokens, setLiveOutput,
    s, agentRef, taskQueueRef, crashCompactRef,
    tokenBufRef, tokenCntRef, tokenFlushRef, toolMsgsRef,
    streamInThinkingRef, agentStartTimeRef,
  } = opts

  const cm = ConfigManager.getInstance()

  // Live output arrives in many small chunks; repaint at most ~10× a second.
  const liveRef = useRef<{ title: string; text: string; timer: ReturnType<typeof setTimeout> | null }>({
    title: '',
    text: '',
    timer: null,
  })
  const pushLive = (title: string, chunk: string) => {
    const live = liveRef.current
    if (live.title !== title) live.text = ''
    live.title = title
    live.text = (live.text + chunk).slice(-20000)
    if (!live.timer) {
      live.timer = setTimeout(() => {
        live.timer = null
        setLiveOutput({ title: live.title, text: live.text })
      }, 100)
    }
  }
  const endLive = () => {
    const live = liveRef.current
    if (live.timer) clearTimeout(live.timer)
    live.timer = null
    live.text = ''
    live.title = ''
    setLiveOutput(null)
  }

  const handleSubmit = useCallback(
    async (rawInput: string) => {
      const { agentStatus, isRunning, attachments, mode, messages } = s.current

      const input = rawInput.trim()
      if (!input) return
      setInputValue('')
      setHistIndex(-1)
      setPickerIdx(0)

      // ── /debug toggle ─────────────────────────────────────────────────────────
      if (input === '/debug') {
        const newMode = s.current.mode === 'debug' ? 'build' : 'debug'
        setMode(newMode)
        cm.set({ debugMode: newMode === 'debug' })
        addMsg({
          type: 'done',
          content: newMode === 'debug'
            ? 'Debug mode ON — full tool args, trust decisions, and raw errors are shown.'
            : 'Debug mode OFF',
        })
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── /config slash command ──────────────────────────────────────────────────
      if (input.startsWith('/config') || input.toLowerCase() === '/config') {
        const rest = input.slice(7).trim()
        const [sub, ...rest2] = rest.split(/\s+/)
        const val = rest2.join(' ').trim()

        if (!sub) {
          const cfg = cm.get()
          showInfo('config', [
            `  config path : ${cm.getConfigPath()}`,
            '',
            `  provider    : ${cfg.llm.provider}`,
            `  model       : ${cfg.llm.model}`,
            `  url         : ${cfg.llm.baseURL || '(default)'}`,
            `  temperature : ${cfg.llm.temperature ?? 0.1}`,
            '',
            '**Commands**',
            '  /config provider ollama      Use Ollama  (localhost:11434)',
            '  /config provider lmstudio    Use LM Studio  (localhost:1234)',
            '  /config model <name>         Switch model',
            '  /config url <url>            Override base URL',
            '  /config temperature <val>    Set temperature  (0.0–1.0)',
          ])
        } else {
          switch (sub.toLowerCase()) {
            case 'model':
              if (!val) {
                addMsg({
                  type: 'error',
                  content: 'Usage: /config model <model-name>',
                })
                break
              }
              cm.setLLM({ model: val })
              addMsg({ type: 'done', content: `Model → ${val}` })
              break
            case 'provider': {
              if (!val || !['ollama', 'lmstudio'].includes(val.toLowerCase())) {
                addMsg({
                  type: 'error',
                  content:
                    'Available providers: ollama  lmstudio\n  /config provider ollama\n  /config provider lmstudio',
                })
                break
              }
              const defaults =
                val === 'lmstudio'
                  ? {
                      provider: 'lmstudio' as any,
                      baseURL: 'http://localhost:1234/v1',
                      model: cm.get().llm.model,
                    }
                  : {
                      provider: 'ollama' as any,
                      baseURL: 'http://localhost:11434',
                      model: cm.get().llm.model,
                    }
              cm.setLLM(defaults)
              addMsg({
                type: 'done',
                content: `Provider → ${val}\nURL → ${defaults.baseURL}`,
              })
              break
            }
            case 'url':
            case 'baseurl':
            case 'base-url':
              if (!val) {
                addMsg({ type: 'error', content: 'Usage: /config url <url>' })
                break
              }
              cm.setLLM({ baseURL: val })
              addMsg({ type: 'done', content: `Base URL → ${val}` })
              break
            case 'temperature':
            case 'temp':
              if (!val) {
                addMsg({
                  type: 'error',
                  content: 'Usage: /config temperature <0.0–1.0>',
                })
                break
              }
              cm.setLLM({ temperature: parseFloat(val) })
              addMsg({ type: 'done', content: `Temperature → ${val}` })
              break
            default:
              addMsg({
                type: 'error',
                content: `Unknown subcommand. Type /config for an overview.`,
              })
          }
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── exit / clear (also without slash) ────────────────────────────────────
      if (input === '/exit' || input === 'exit' || input === 'quit') {
        exit()
        return
      }
      if (input === '/clear' || input === 'clear') {
        setMessages([])
        setConvHistory([])
        setInfoScroll(0)
        return
      }

      // ── /trust ────────────────────────────────────────────────────────────────
      if (input === '/trust' || input.startsWith('/trust ')) {
        const rest = input.slice(6).trim()
        const [sub, ...r2] = rest.split(/\s+/)
        const arg = r2.join(' ').trim() || sub

        if (!sub || sub === 'list') {
          const list = cm.listTrusted()
          showInfo(
            'trusted paths',
            list.length
              ? [
                  '**Trusted paths** (write ops auto-approved)',
                  '',
                  ...list.map((p) => `  • ${p}`),
                  '',
                  '  /trust remove <path>   Remove trust',
                ]
              : [
                  '  No trusted paths yet.',
                  '',
                  '  /trust <path>   Trust a folder',
                  '  /trust .         Trust current working directory',
                ],
          )
        } else if (sub === 'remove') {
          if (!arg || arg === 'remove') {
            addMsg({ type: 'error', content: 'Usage: /trust remove <path>' })
            return
          }
          const { resolve: nodeResolve } = await import('path')
          cm.untrustPath(nodeResolve(cwd, arg))
          addMsg({ type: 'done', content: `Removed trust: ${arg}` })
        } else {
          const { resolve: nodeResolve } = await import('path')
          const abs = nodeResolve(cwd, sub)
          cm.trustPath(abs)
          addMsg({
            type: 'done',
            content: `Trusted: ${abs}\nAll write operations in this folder and subfolders will be auto-approved.`,
          })
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── /lsp ──────────────────────────────────────────────────────────────────
      // (hover / def are handled below and must not be swallowed here)
      if (
        (input === '/lsp' || input.startsWith('/lsp ')) &&
        !input.startsWith('/lsp hover') &&
        !input.startsWith('/lsp def')
      ) {
        const targetArg = input.slice(4).trim() || '.'
        setAgentStatus('thinking')
        setCurrentTokens('')
        const { diagnostics, tool, error } = await lspCheck(
          cwd,
          targetArg === '.' ? undefined : targetArg,
        )
        setAgentStatus('idle')
        setCurrentTokens('')
        if (error && diagnostics.length === 0) {
          addMsg({ type: 'error', content: error })
        } else if (diagnostics.length === 0) {
          addMsg({
            type: 'command',
            commandTitle: `lsp (${tool})`,
            content: '  ✓ No issues found',
          })
        } else {
          const errors = diagnostics.filter(
            (d) => d.severity === 'error',
          ).length
          const warnings = diagnostics.filter(
            (d) => d.severity === 'warning',
          ).length
          const lines = [
            `  ${tool}: ${errors} error${errors !== 1 ? 's' : ''}, ${warnings} warning${warnings !== 1 ? 's' : ''}`,
            '',
            ...diagnostics
              .slice(0, 40)
              .map(
                (d) =>
                  `  ${d.file}:${d.line}:${d.col}  ${d.severity}  ${d.message}${d.code ? `  [${d.code}]` : ''}`,
              ),
            ...(diagnostics.length > 40
              ? [`  … and ${diagnostics.length - 40} more`]
              : []),
          ]
          addMsg({
            type: 'command',
            commandTitle: `lsp (${tool})`,
            content: lines.join('\n'),
          })
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── /lsp hover / /lsp def ─────────────────────────────────────────────────
      if (input.startsWith('/lsp hover ') || input.startsWith('/lsp def ')) {
        const isHover = input.startsWith('/lsp hover ')
        const rest = isHover ? input.slice(11).trim() : input.slice(9).trim()
        const m = rest.match(/^(.+):(\d+):(\d+)$/)
        if (!m) {
          addMsg({ type: 'error', content: `Usage: /lsp ${isHover ? 'hover' : 'def'} <file>:<line>:<col>\n  e.g. /lsp ${isHover ? 'hover' : 'def'} src/auth.ts:42:15` })
          cm.addHistory(input)
          setHistory(cm.getHistory())
          return
        }
        const [, filePath, lineStr, colStr] = m
        const line = parseInt(lineStr, 10)
        const col = parseInt(colStr, 10)
        setAgentStatus('thinking')
        setCurrentTokens('')
        try {
          const mgr = LspManager.getInstance()
          if (isHover) {
            const result = await mgr.hover(filePath, line, col, cwd)
            setAgentStatus('idle')
            if (!result) {
              addMsg({ type: 'error', content: `No hover info at ${filePath}:${line}:${col}\nMake sure the LSP server is installed (typescript-language-server / rust-analyzer / gopls / pylsp).` })
            } else {
              addMsg({ type: 'command', commandTitle: `hover (${result.server})  ${filePath}:${line}:${col}`, content: result.text })
            }
          } else {
            const result = await mgr.definition(filePath, line, col, cwd)
            setAgentStatus('idle')
            if (!result) {
              addMsg({ type: 'error', content: `No definition found at ${filePath}:${line}:${col}` })
            } else {
              addMsg({ type: 'command', commandTitle: `definition (${result.server})`, content: `  ${result.targetFile}:${result.targetLine}` })
            }
          }
        } catch (e) {
          setAgentStatus('idle')
          addMsg({ type: 'error', content: String(e) })
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── /continue ─────────────────────────────────────────────────────────────
      if (input === '/continue') {
        const loaded = cm.loadSession(cm.autosaveName(cwd))
        if (!loaded?.length) {
          addMsg({ type: 'error', content: 'There is no earlier session in this folder to continue.' })
        } else {
          setMessages(loaded)
          setConvHistory(conversationFrom(loaded))
        }
        return
      }

      // ── /init ─────────────────────────────────────────────────────────────────
      if (input === '/init') {
        const existing = projectInstructionsPath(cwd)
        if (existing) {
          addMsg({ type: 'error', content: `${basename(existing)} already exists in this folder — edit it to change the project instructions.` })
        } else {
          const file = join(cwd, 'LOCALCODE.md')
          try {
            writeFileSync(file, INSTRUCTIONS_TEMPLATE, 'utf8')
            addMsg({
              type: 'command',
              commandTitle: 'created LOCALCODE.md',
              content: [
                '  Project instructions — sent to the model with every task.',
                '  Fill in commands, conventions and what to avoid; keep it short.',
                '  Preferences for all projects go in ~/.localcode/LOCALCODE.md.',
              ].join('\n'),
            })
          } catch (err) {
            addMsg({ type: 'error', content: `Could not create LOCALCODE.md: ${(err as Error).message}` })
          }
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── /undo ─────────────────────────────────────────────────────────────────
      if (input === '/undo' || input === '/undo all') {
        const all = input === '/undo all'
        const undone = all ? await checkpoints.undoTask() : await checkpoints.undoLast()
        if (undone.length === 0) {
          addMsg({ type: 'error', content: 'Nothing to undo — no file changes recorded in this session.' })
        } else {
          addMsg({
            type: 'command',
            commandTitle: all ? 'undo all changes of the last task' : 'undo last change',
            content: undone
              .map((u) => `  ${u.action === 'removed' ? 'removed ' : 'restored'}  ${displayPath(u.path, cwd)}`)
              .join('\n'),
          })
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── /attach ───────────────────────────────────────────────────────────────
      if (input === '/attach') {
        setFilePicker(true)
        ;(async () => {
          setFileList(await listCwdFiles(cwd))
        })()
        return
      }

      // ── /compact ──────────────────────────────────────────────────────────────
      if (input === '/compact') {
        if (messages.length === 0) {
          addMsg({ type: 'error', content: 'Nothing to compact.' })
          return
        }
        setAgentStatus('thinking')
        setCurrentTokens('')
        const summary = messages
          .map((m) => {
            if (m.type === 'text' && m.content.startsWith('> '))
              return `User: ${m.content.slice(2)}`
            if (m.type === 'done')
              return `Assistant: ${m.content.replace(/^DONE:\s*/i, '').trim()}`
            if (m.type === 'tool_call' && m.toolCall)
              return `  [${m.toolCall.tool}]`
            return null
          })
          .filter(Boolean)
          .join('\n')
        const summaryMsgs = [
          { role: 'system' as const, content: COMPACT_SUMMARY_PROMPT },
          { role: 'user' as const, content: summary },
        ]
        let compacted = ''
        try {
          const result = await LLMRouter.stream(summaryMsgs, cm.get().llm, (t) => {
            compacted += t
            setCurrentTokens(compacted)
          })
          compacted = result.response || compacted
        } catch {}
        setCurrentTokens('')
        setAgentStatus('idle')
        setMessages([])
        setContextTokens(0)
        // Keep the summary as the agent's context — otherwise /compact would
        // silently wipe everything the agent knew about the conversation.
        const { response: summaryText } = parseThinking(compacted)
        setConvHistory(
          summaryText.trim()
            ? [{ role: 'assistant' as const, content: `Summary of the conversation so far:\n${summaryText.trim()}` }]
            : [],
        )
        addMsg({ type: 'done', content: `[Compacted]\n${compacted}` })
        return
      }

      // ── /session ──────────────────────────────────────────────────────────────
      if (input.startsWith('/session')) {
        const rest = input.slice(8).trim()
        const [sub, ...rest2] = rest.split(/\s+/)
        const name = rest2.join(' ').trim() || sub

        if (!sub || sub === 'list') {
          const sessions = cm.listSessions()
          showInfo(
            'sessions',
            sessions.length
              ? [
                  '**Saved sessions**',
                  '',
                  ...sessions.map((s) => `  • ${s}`),
                  '',
                  '  /session load <name>   Restore  ·  /session delete <name>   Remove',
                ]
              : [
                  '  No sessions saved yet.',
                  '',
                  '  /session save <name>   Bookmark this conversation',
                ],
          )
        } else if (sub === 'save') {
          if (!name || name === 'save') {
            addMsg({ type: 'error', content: 'Usage: /session save <name>' })
            return
          }
          cm.saveSession(name, messages)
          addMsg({
            type: 'done',
            content: `Session "${name}" saved  (${messages.length} messages)`,
          })
        } else if (sub === 'load') {
          if (!name || name === 'load') {
            addMsg({ type: 'error', content: 'Usage: /session load <name>' })
            return
          }
          const loaded = cm.loadSession(name)
          if (!loaded) {
            addMsg({ type: 'error', content: `Session "${name}" not found.` })
            return
          }
          setMessages(loaded)
          setConvHistory(conversationFrom(loaded))
          addMsg({
            type: 'done',
            content: `Session "${name}" loaded  (${loaded.length} messages)`,
          })
        } else if (sub === 'delete') {
          if (!name || name === 'delete') {
            addMsg({ type: 'error', content: 'Usage: /session delete <name>' })
            return
          }
          cm.deleteSession(name)
          addMsg({ type: 'done', content: `Session "${name}" deleted` })
        } else {
          addMsg({
            type: 'error',
            content:
              'Usage: /session [list|save <name>|load <name>|delete <name>]',
          })
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── /connect ──────────────────────────────────────────────────────────────
      if (input === '/connect') {
        setInputValue('')
        setConnectPopup(true)
        return
      }

      // ── /model ────────────────────────────────────────────────────────────────
      if (input === '/model reset') {
        const cfg = cm.get().llm
        if (mode === 'build' || !cfg.modeModels?.[mode]) {
          addMsg({ type: 'error', content: `${mode} mode already uses the default model (${cfg.model}).` })
        } else {
          const { [mode]: _dropped, ...rest } = cfg.modeModels
          cm.setLLM({ modeModels: rest })
          addMsg({ type: 'done', content: `${mode} mode uses the default model again (${cfg.model}).` })
        }
        return
      }
      if (input === '/model') {
        setInputValue('')
        setModelPicker(true)
        setModelLoading(true)
        setModelList([])
        ;(async () => {
          const cfg = cm.get()
          const isOllama = cfg.llm.provider === 'ollama'
          const list = isOllama
            ? await LLMRouter.getOllamaProvider().listModels(cfg.llm.baseURL)
            : await LLMRouter.getLMStudioProvider().listModels(cfg.llm.baseURL)
          setModelList(list)
          setModelLoading(false)
        })()
        return
      }

      // ── /plugin ───────────────────────────────────────────────────────────────
      if (input === '/plugin' || input.startsWith('/plugin ')) {
        const rest = input.slice(7).trim()
        const [sub, ...rest2] = rest.split(/\s+/)
        const arg = rest2.join(' ').trim()

        if (!sub || sub === 'list') {
          const entries = await listInstalledPlugins(
            globalRegistry,
            cm.listDisabledPlugins(),
          )
          const lines: string[] = ['**Plugins**', '']
          if (entries.length === 0) {
            lines.push('  No plugins installed.')
            lines.push('')
            lines.push('  /plugin install <user/repo>   Install from GitHub')
            lines.push(
              '  /plugin install <path>        Install from local path',
            )
          } else {
            for (const e of entries) {
              const status = !e.enabled
                ? '[disabled]'
                : e.loaded
                  ? '[active]  '
                  : '[inactive]'
              lines.push(
                `  ${status} ${e.name}  v${e.version}  by ${e.author}  — ${e.description}`,
              )
              if (e.tools.length > 0)
                lines.push(`    tools    : ${e.tools.join(', ')}`)
              if (e.commands.length > 0)
                lines.push(`    commands : ${e.commands.join(', ')}`)
            }
          }
          showInfo('plugins', lines)
        } else if (sub === 'install') {
          if (!arg) {
            addMsg({
              type: 'error',
              content: 'Usage: /plugin install <user/repo|url|path>',
            })
            cm.addHistory(input)
            setHistory(cm.getHistory())
            return
          }
          setAgentStatus('thinking')
          const result = await installPlugin(
            arg,
            globalRegistry,
            globalCommandRegistry,
          )
          setAgentStatus('idle')
          if (result.ok) {
            setPluginCmds(
              globalCommandRegistry
                .listCommands()
                .map((c) => ({ cmd: c.cmd, description: c.description })),
            )
            const detail = [
              result.toolCount ? `${result.toolCount} tool(s)` : '',
              result.commandCount ? `${result.commandCount} command(s)` : '',
            ]
              .filter(Boolean)
              .join(', ')
            addMsg({
              type: 'done',
              content: `Plugin "${result.name}" installed${detail ? ` (${detail})` : ''}`,
            })
          } else {
            addMsg({
              type: 'error',
              content: `Install failed: ${result.error}`,
            })
          }
        } else if (sub === 'remove') {
          if (!arg) {
            addMsg({ type: 'error', content: 'Usage: /plugin remove <name>' })
            cm.addHistory(input)
            setHistory(cm.getHistory())
            return
          }
          setAgentStatus('thinking')
          const result = await removePlugin(
            arg,
            globalRegistry,
            globalCommandRegistry,
          )
          setAgentStatus('idle')
          if (result.ok) {
            setPluginCmds(
              globalCommandRegistry
                .listCommands()
                .map((c) => ({ cmd: c.cmd, description: c.description })),
            )
            addMsg({ type: 'done', content: `Plugin "${arg}" removed` })
          } else {
            addMsg({ type: 'error', content: result.error ?? 'Remove failed' })
          }
        } else if (sub === 'reload') {
          globalRegistry
            .listTools()
            .filter((t) => t.pluginName !== undefined)
            .forEach((t) => globalRegistry.removeTool(t.name))
          globalCommandRegistry
            .listCommands()
            .forEach((c) => globalCommandRegistry.removeCommand(c.cmd))
          const results = await loadPlugins(
            globalRegistry,
            globalCommandRegistry,
          )
          const loaded = results.filter((r) => r.success).length
          setPluginCmds(
            globalCommandRegistry
              .listCommands()
              .map((c) => ({ cmd: c.cmd, description: c.description })),
          )
          addMsg({
            type: 'done',
            content: `Plugins reloaded (${loaded} loaded)`,
          })
        } else if (sub === 'disable') {
          if (!arg) {
            addMsg({ type: 'error', content: 'Usage: /plugin disable <name>' })
            cm.addHistory(input)
            setHistory(cm.getHistory())
            return
          }
          if (cm.isPluginDisabled(arg)) {
            addMsg({
              type: 'error',
              content: `Plugin "${arg}" is already disabled`,
            })
          } else {
            cm.disablePlugin(arg)
            globalRegistry.removePluginTools(arg)
            globalCommandRegistry.removePluginCommands(arg)
            setPluginCmds(
              globalCommandRegistry
                .listCommands()
                .map((c) => ({ cmd: c.cmd, description: c.description })),
            )
            addMsg({ type: 'done', content: `Plugin "${arg}" disabled` })
          }
        } else if (sub === 'enable') {
          if (!arg) {
            addMsg({ type: 'error', content: 'Usage: /plugin enable <name>' })
            cm.addHistory(input)
            setHistory(cm.getHistory())
            return
          }
          if (!cm.isPluginDisabled(arg)) {
            addMsg({
              type: 'error',
              content: `Plugin "${arg}" is not disabled`,
            })
          } else {
            cm.enablePlugin(arg)
            setAgentStatus('thinking')
            const result = await reloadPlugin(
              arg,
              globalRegistry,
              globalCommandRegistry,
            )
            setAgentStatus('idle')
            setPluginCmds(
              globalCommandRegistry
                .listCommands()
                .map((c) => ({ cmd: c.cmd, description: c.description })),
            )
            if (result.success) {
              addMsg({ type: 'done', content: `Plugin "${arg}" enabled` })
            } else {
              addMsg({
                type: 'error',
                content: `Plugin "${arg}" enabled but failed to load: ${result.error}`,
              })
            }
          }
        } else {
          addMsg({
            type: 'error',
            content:
              'Usage: /plugin [list | install <source> | remove <name> | reload | enable <name> | disable <name>]',
          })
        }
        cm.addHistory(input)
        setHistory(cm.getHistory())
        return
      }

      // ── Plugin slash-command routing ──────────────────────────────────────────
      if (input.startsWith('/')) {
        const trimmed = input.trim()
        const matched = globalCommandRegistry.getCommand(trimmed)
        if (matched) {
          const key = matched.cmd.trimEnd()
          const args = trimmed.slice(key.length).trim()
          setAgentStatus('thinking')
          try {
            const result = await matched.handler(args, { cwd })
            setAgentStatus('idle')
            if (result.type === 'error') {
              addMsg({ type: 'error', content: result.content })
            } else if (result.type === 'command') {
              addMsg({
                type: 'command',
                commandTitle: result.title,
                content: result.content,
              })
            } else {
              addMsg({ type: 'done', content: result.content })
            }
          } catch (e) {
            setAgentStatus('idle')
            addMsg({ type: 'error', content: `Plugin error: ${String(e)}` })
          }
          cm.addHistory(input)
          setHistory(cm.getHistory())
          return
        }
      }

      switch (input.trim().toLowerCase()) {
        case 'exit':
        case 'quit':
          exit()
          return
        case 'clear':
          setMessages([])
          return
        case 'help':
        case '/help':
          showInfo('help', [
            '**Attachments**',
            '  /attach                        Attach file or image (@-picker)',
            '  @path/to/file                  Include file in message',
            '',
            '**Session**',
            '  /session                       List saved sessions',
            '  /session save <name>           Save conversation',
            '  /session load <name>           Load conversation',
            '  /session delete <name>         Delete session',
            '  /continue                      Pick up the last session in this folder',
            '  /init                          Create LOCALCODE.md (project instructions)',
            '  /compact                       Summarize & compress conversation',
            '',
            '**Changes**',
            '  /undo                          Revert the last file change',
            '  /undo all                      Revert every change of the last task',
            '',
            '**Connection**',
            '  /connect                       Connect to server (popup)',
            '  /model                         Select the model for the current mode',
            '  /model reset                   Plan/debug mode: back to the default model',
            '',
            '**Configuration**',
            '  /config                        Show current configuration',
            '  /config provider ollama        Use Ollama  (localhost:11434)',
            '  /config provider lmstudio      Use LM Studio  (localhost:1234)',
            '  /config model <name>           Switch model',
            '  /config url <url>              Set base URL',
            '  /config temperature <val>      Set temperature (0.0–1.0)',
            '',
            '**System**',
            '  /lsp                           Run diagnostics (tsc/cargo/go vet/eslint)',
            '  /lsp hover <file>:<line>:<col>  Hover info via LSP server',
            '  /lsp def <file>:<line>:<col>    Go-to-definition via LSP server',
            '  /models                        List available models',
            '  /doctor                        Check connection & status',
            '  /clear                         Clear screen',
            '  /exit                          Quit',
            '',
            '**Keyboard shortcuts**',
            '  ctrl+c                         Abort agent  /  clear input  /  quit',
            '  ctrl+p                         Palette: commands, models, sessions, files',
            '  alt+enter  /  ctrl+j           New line in the prompt',
            '  ctrl+l                         Clear screen and chat',
            '  ctrl+k                         Clear input line',
            '  ↑ ↓                            Lines in the prompt, then input history',
            '  tab                            Autocomplete / cycle build → plan → debug',
            '  wheel  /  PgUp PgDn            Scroll the conversation',
            '  shift+drag                     Select text to copy',
            '',
            '**Shell**',
            '  $ <cmd>   or   ! <cmd>         e.g.: $ npm test',
            '',
            '**Plugins**',
            '  /plugin                        List installed plugins',
            '  /plugin install <path>         Install plugin',
            '  /plugin remove <name>          Uninstall a plugin',
            '  /plugin reload                 Reload all plugins',
          ])
          break
        case 'doctor':
        case '/doctor': {
          showInfo('doctor', ['  Checking…'])
          const cfg = cm.get()
          const isOllama = cfg.llm.provider === 'ollama'
          const healthy = isOllama
            ? await LLMRouter.getOllamaProvider().checkHealth(cfg.llm.baseURL)
            : await LLMRouter.getLMStudioProvider().checkHealth(
                cfg.llm.baseURL,
              )
          const provName = isOllama ? 'Ollama' : 'LM Studio'
          const provHint = isOllama
            ? 'ollama serve'
            : 'LM Studio → start Local Server'
          showInfo('doctor', [
            `  Node.js   : ✓ ${process.version}`,
            `  Platform  : ✓ ${process.platform}`,
            `  ${provName.padEnd(9)}: ${healthy ? '✓ Reachable' : `✗ Not reachable — ${provHint}`}`,
            `  Provider  : ${cfg.llm.provider}`,
            `  Model     : ${cfg.llm.model}`,
            `  URL       : ${cfg.llm.baseURL || '(default)'}`,
            `  Config    : ${cm.getConfigPath()}`,
          ])
          break
        }
        case 'models':
        case '/models': {
          showInfo('models', ['  Loading…'])
          const cfg = cm.get()
          const isOllama = cfg.llm.provider === 'ollama'
          const models = isOllama
            ? await LLMRouter.getOllamaProvider().listModels(cfg.llm.baseURL)
            : await LLMRouter.getLMStudioProvider().listModels(cfg.llm.baseURL)
          const provName = isOllama ? 'Ollama' : 'LM Studio'
          showInfo(
            'models',
            models.length
              ? [
                  '**Available models**',
                  '',
                  ...models.map((m) => `  • ${m}`),
                  '',
                  `  /config model <name>  to switch`,
                ]
              : isOllama
                ? [
                    '  No Ollama models found.',
                    '',
                    '  $ ollama pull deepseek-coder',
                  ]
                : [
                    '  No LM Studio models found.',
                    '',
                    '  Open LM Studio and load a model.',
                  ],
          )
          break
        }
        default: {
          // Shell passthrough: run it and show the output. (It used to be
          // written into a hidden PTY whose output nothing ever read.)
          if (input.startsWith('$') || input.startsWith('!')) {
            const command = input.slice(1).trim()
            if (!command) return
            setAgentStatus('running')
            const result = await runShell(command, cwd, (chunk) => pushLive(`$ ${command}`, chunk))
            endLive()
            setAgentStatus('idle')
            const text = result.success
              ? result.output
              : [result.output, result.error].filter(Boolean).join('\n')
            const lines = text.split('\n')
            const shown = lines.length > SHELL_OUTPUT_LINES
              ? [...lines.slice(0, SHELL_OUTPUT_LINES), `… ${lines.length - SHELL_OUTPUT_LINES} more lines`]
              : lines
            addMsg({
              type: result.success ? 'command' : 'error',
              ...(result.success ? { commandTitle: `$ ${command}` } : {}),
              content: result.success ? shown.join('\n') : `$ ${command}\n${shown.join('\n')}`,
            })
            break
          }

          if (isRunning && agentRef.current) {
            if (input.length < 120) {
              agentRef.current.inject(input)
              addMsg({ type: 'text', content: `> [btw] ${input}` })
            } else {
              taskQueueRef.current.push(input)
              addMsg({ type: 'text', content: `> [queued] ${input}` })
            }
            break
          }

          const strippedForPath = input.trim().replace(/^["']|["']$/g, '')
          const isLocalPath =
            /^[A-Za-z]:[\\\/].{2,}/.test(strippedForPath) ||
            /^\/[^\s]{2,}/.test(strippedForPath)
          if (isLocalPath) {
            const att = await loadAttachment(strippedForPath, cwd)
            if (att) {
              setAttachments((prev) => [...prev, att])
              return
            }
          }

          // An unknown "/word" is a mistyped command, not a prompt for the model.
          if (/^\/[\w-]+(\s|$)/.test(input)) {
            addMsg({
              type: 'error',
              content: `Unknown command: ${input.split(/\s/)[0]}  —  type /help for the list`,
            })
            return
          }

          const atPattern = /@([^\s]+)/g
          const pendingAtts: Promise<Attachment | null>[] = []
          let cleanInput = input
          let m
          while ((m = atPattern.exec(input)) !== null) {
            pendingAtts.push(loadAttachment(m[1], cwd))
            cleanInput = cleanInput.replace(m[0], `[${m[1]}]`)
          }
          const resolved = await Promise.all(pendingAtts)
          const mentionAtts = resolved.filter(
            (a): a is Attachment => a !== null,
          )
          const allAtts = [...attachments, ...mentionAtts]

          setAgentStatus('thinking')
          setCurrentTokens('')
          setTokenCount(0)
          // The whole task, from sending it to the answer.
          agentStartTimeRef.current = Date.now()

          const attLabel = allAtts.length
            ? `  [${allAtts.map((a) => a.name).join(', ')}]`
            : ''
          addMsg({ type: 'text', content: `> ${cleanInput}${attLabel}` })
          setAttachments([])

          const agent = new AgentRuntime()
          agentRef.current = agent

          tokenBufRef.current = ''
          tokenCntRef.current = 0
          toolMsgsRef.current = []
          streamInThinkingRef.current = false
          if (tokenFlushRef.current) {
            clearTimeout(tokenFlushRef.current)
            tokenFlushRef.current = null
          }

          const flushTokens = () => {
            tokenFlushRef.current = null
            setCurrentTokens(tokenBufRef.current)
            setTokenCount(tokenCntRef.current)
          }

          agent.on('thinking', () => {
            setAgentStatus('thinking')
            setCurrentTokens('')
          })
          agent.on('token', (token: string) => {
            if (s.current.agentStatus !== 'running') setAgentStatus('running')
            const wasEmpty = tokenBufRef.current === ''
            tokenBufRef.current += token
            tokenCntRef.current += token.length
            if (wasEmpty) {
              streamInThinkingRef.current = true
            }
            if (
              streamInThinkingRef.current &&
              (tokenBufRef.current.includes('</think>') ||
                tokenBufRef.current.includes('</thinking>'))
            ) {
              streamInThinkingRef.current = false
            }
            if (wasEmpty) {
              flushTokens()
            } else if (!tokenFlushRef.current) {
              tokenFlushRef.current = setTimeout(flushTokens, 150)
            }
          })
          agent.on('tool_call', ({ toolCall }: { toolCall: ToolCall }) => {
            const buf = tokenBufRef.current
            if (buf) {
              const { thinking } = parseThinking(buf)
              if (thinking.trim()) {
                addMsg({ type: 'thinking', content: thinking })
              }
            }
            if (tokenFlushRef.current) {
              clearTimeout(tokenFlushRef.current)
              tokenFlushRef.current = null
            }
            tokenBufRef.current = ''
            tokenCntRef.current = 0
            setCurrentTokens('')
            addMsg({ type: 'tool_call', content: toolCall.tool, toolCall })
          })
          agent.on(
            'tool_result',
            ({
              toolCall,
              result,
            }: {
              toolCall: ToolCall
              result: ToolResult
            }) => {
              endLive()
              const toolCallJson = JSON.stringify({
                tool: toolCall.tool,
                arguments: toolCall.arguments,
              })
              const toolOut = result.success
                ? (result.output || '').slice(0, 3000)
                : `error: ${result.error || 'unknown'}`
              toolMsgsRef.current.push(
                { role: 'assistant', content: toolCallJson },
                {
                  role: 'user',
                  content: `Tool "${toolCall.tool}" result:\n${toolOut}`,
                },
              )
              addMsg({
                type: 'tool_result',
                content: '',
                toolCall,
                toolResult: result,
              })
            },
          )
          agent.on(
            'confirm_required',
            ({
              toolCall,
              reason,
              diffPreview,
              dangerous,
            }: {
              toolCall: ToolCall
              reason: string
              diffPreview?: DiffPreview
              dangerous?: boolean
            }) => {
              setConfirm({ toolCall, reason, diffPreview, dangerous })
            },
          )
          agent.on(
            'debug_info',
            ({
              iteration,
              tokens,
              elapsed,
              tool,
              success,
            }: {
              iteration?: number
              tokens?: number
              elapsed?: number
              tool?: string
              success?: boolean
            }) => {
              const content = tool
                ? `tool:${tool}  ${elapsed}ms  ${success ? '✓' : '✗'}`
                : `iter:${iteration}  ${tokens != null ? tokens + ' tok' : '?tok'}  ${elapsed}ms`
              addMsg({ type: 'debug', content })
            },
          )
          agent.on('notice', (text: string) => {
            addMsg({ type: 'thinking', content: text })
          })
          agent.on('usage', ({ contextTokens }: { contextTokens: number }) => {
            setContextTokens(contextTokens)
          })
          agent.on('tool_output', ({ toolCall, chunk }: { toolCall: ToolCall; chunk: string }) => {
            const [verb, target] = describeTool(toolCall.tool, toolCall.arguments)
            pushLive(`${verb} ${target}`.trim(), chunk)
          })
          agent.on('injection', ({ message }: { message: string }) => {
            // Already shown in the UI when inject() was called; just acknowledge
          })
          agent.on('error', (msg: string) => {
            if (tokenFlushRef.current) {
              clearTimeout(tokenFlushRef.current)
              tokenFlushRef.current = null
            }
            tokenBufRef.current = ''
            tokenCntRef.current = 0
            setAgentStatus('error')
            addMsg({ type: 'error', content: msg })
          })
          agent.on(
            'done',
            ({
              response,
              aborted,
              tokenCount: actualTokenCount,
              tokensPerSec,
            }: {
              response: string
              aborted?: boolean
              tokenCount?: number
              tokensPerSec?: number
            }) => {
              endLive()
              if (tokenFlushRef.current) {
                clearTimeout(tokenFlushRef.current)
                tokenFlushRef.current = null
              }
              const charCount = tokenCntRef.current
              tokenBufRef.current = ''
              tokenCntRef.current = 0
              setCurrentTokens('')
              setTokenCount(0)
              setAgentStatus('idle')
              setConfirm(null)
              agentRef.current = null
              if (!aborted && response) {
                addMsg({
                  type: 'done',
                  content: response,
                  tokenCount: actualTokenCount || charCount || undefined,
                  tokensPerSec,
                  durationMs: agentStartTimeRef.current
                    ? Date.now() - agentStartTimeRef.current
                    : undefined,
                })
                setConvHistory((prev) =>
                  [
                    ...prev,
                    { role: 'user' as const, content: cleanInput },
                    ...toolMsgsRef.current,
                    { role: 'assistant' as const, content: response },
                  ].slice(-60),
                )
              }
              if (!aborted && taskQueueRef.current.length > 0) {
                const next = taskQueueRef.current.shift()!
                setTimeout(() => handleSubmit(next), 50)
              }
            },
          )
          const { convHistory } = s.current
          // Plan mode can only read. Asked to carry out the plan, switch to build
          // mode instead of letting the agent go round in circles.
          let runMode = mode
          const isQuestion = /\?\s*$/.test(cleanInput)
          if (mode === 'plan' && convHistory.length > 0 && !isQuestion && IMPLEMENT_INTENT.test(cleanInput)) {
            runMode = 'build'
            setMode('build')
            cm.set({ debugMode: false })
            addMsg({ type: 'done', content: 'Switched to build mode to carry out the plan — file changes still ask for your permission.' })
          }
          agent
            .run(cleanInput, cwd, allAtts, runMode, convHistory)
            .catch((err: Error) => {
              setAgentStatus('error')
              addMsg({ type: 'error', content: String(err) })
              agentRef.current = null
              if (s.current.messages.length > 3 && !crashCompactRef.current) {
                crashCompactRef.current = true
                addMsg({ type: 'text', content: '> [auto-compact after crash]' })
                setTimeout(() => {
                  crashCompactRef.current = false
                  handleSubmit('/compact')
                }, 400)
              }
            })
          break
        }
      }

      cm.addHistory(input)
      setHistory(cm.getHistory())
    },
    [addMsg, cwd, exit],
  )

  return { handleSubmit }
}

/**
 * Rebuild what the agent should remember from a saved transcript: your
 * prompts and its answers. Loading a session used to restore only the
 * screen, so the agent started from nothing.
 */
export function conversationFrom(messages: AgentMessage[]): Message[] {
  const out: Message[] = []
  for (const m of messages) {
    if (m.type === 'text' && m.content.startsWith('> ') && !m.content.startsWith('> [')) {
      out.push({ role: 'user', content: m.content.slice(2) })
    } else if (m.type === 'done' && m.content.trim()) {
      out.push({ role: 'assistant', content: parseThinking(m.content).response.trim() || m.content })
    }
  }
  return out.slice(-60)
}
