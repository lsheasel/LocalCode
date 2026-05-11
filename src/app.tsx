import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, extname, basename, join } from 'path'
import { Splash } from './components/Splash'
import { StatusBar } from './components/StatusBar'
import { ThinkingDots } from './components/ThinkingDots'
import { DiffView } from './components/DiffView'
import { MarkdownText } from './components/MarkdownText'
import { ConnectPopup } from './components/ConnectPopup'
import { ModelPicker } from './components/ModelPicker'
import { FilePicker } from './components/FilePicker'
import { InfoPopup } from './components/InfoPopup'
import { AgentRuntime, DiffPreview } from './agent/AgentRuntime'
import { ConfigManager } from './config/ConfigManager'
import { PtyManager } from './pty/PtyManager'
import { LLMRouter } from './llm/LLMRouter'
import { lspCheck } from './lsp/LspRunner'
import { AgentMessage, ToolCall, ToolResult, Attachment } from './shared/types'
import { BUILTIN_COMMANDS, COMMAND_SUGGESTIONS } from './shared/constants'
import { PluginLoader } from './plugins/PluginLoader'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])
const SKIP_DIRS  = new Set(['node_modules', '.git', 'dist', '__pycache__', '.next', 'build', 'target'])

async function loadAttachment(filePath: string, cwd: string): Promise<Attachment | null> {
  const resolved = resolve(cwd, filePath)
  if (!existsSync(resolved)) return null
  const name = basename(resolved)
  const ext  = extname(resolved).toLowerCase()
  if (IMAGE_EXTS.has(ext)) {
    const buf  = await readFile(resolved)
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return { path: resolved, name, type: 'image', data: buf.toString('base64'), mimeType: mime }
  }
  const data = await readFile(resolved, 'utf-8').catch(() => null)
  if (data === null) return null
  return { path: resolved, name, type: 'file', data }
}

async function listCwdFiles(cwd: string, maxDepth = 2): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string, rel: string, depth: number) {
    if (depth > maxDepth || results.length > 300) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        results.push(relPath + '/')
        await walk(join(dir, e.name), relPath, depth + 1)
      } else {
        results.push(relPath)
      }
    }
  }
  await walk(cwd, '', 0)
  return results
}

let _id = 0
const nextId = () => String(++_id)

type AgentStatus = 'idle' | 'running' | 'thinking' | 'error'
interface ConfirmRequest { toolCall: ToolCall; reason: string; diffPreview?: DiffPreview; dangerous?: boolean }
interface AppProps { initialCommand?: string; cwd: string; onStatusChange?: (status: string, cwd: string) => void }

// ── Turn grouping ─────────────────────────────────────────────────────────────
type Turn = { type: 'user'; content: string; timestamp: number } | { type: 'agent'; messages: AgentMessage[] }

function groupIntoTurns(messages: AgentMessage[]): Turn[] {
  const turns: Turn[] = []
  let agentMsgs: AgentMessage[] = []

  const flush = () => {
    if (agentMsgs.length > 0) { turns.push({ type: 'agent', messages: agentMsgs }); agentMsgs = [] }
  }

  for (const msg of messages) {
    if (msg.type === 'text' && msg.content.startsWith('> ')) {
      flush()
      turns.push({ type: 'user', content: msg.content.slice(2), timestamp: msg.timestamp })
    } else {
      agentMsgs.push(msg)
    }
  }
  flush()
  return turns
}

// ── Line-height estimation ────────────────────────────────────────────────────
function countLines(text: string, width: number): number {
  return text.split('\n').reduce((s, l) => s + Math.max(1, Math.ceil((l.length || 1) / Math.max(1, width))), 0)
}

function estimateTurnLines(turn: Turn, innerWidth: number): number {
  if (turn.type === 'user') return 4  // box border + content + timestamp + margin

  let lines = 0
  for (const msg of turn.messages) {
    if (msg.type === 'error') {
      lines += countLines(msg.content, innerWidth)
    } else if (msg.type === 'command') {
      lines += msg.content.split('\n').length + (msg.commandTitle ? 1 : 0) + 2
    } else if (msg.type === 'text') {
      lines += countLines(msg.content, innerWidth)
    } else if (msg.type === 'done' && msg.content) {
      lines += countLines(msg.content.replace(/^DONE:\s*/i, '').trim(), innerWidth)
    } else if (msg.type === 'tool_result' && msg.toolCall?.tool === 'edit_file' && msg.toolResult?.meta) {
      const m = msg.toolResult.meta
      lines += (m.diffContextBefore?.length ?? 0) + (m.diffOld?.length ?? 0) +
               (m.diffNew?.length ?? 0) + (m.diffContextAfter?.length ?? 0) + 4
    } else {
      lines += 1
    }
  }
  return Math.max(2, lines + 2)  // +1 footer, +1 margin
}

function getVisibleTurns(
  turns: Turn[], availRows: number, innerWidth: number, scrollOffset: number
): { visible: Turn[]; hiddenAbove: number; hiddenBelow: number } {
  const result: Turn[] = []
  let used = 0
  const endIdx = Math.max(0, turns.length - scrollOffset)
  const hiddenBelow = turns.length - endIdx

  for (let i = endIdx - 1; i >= 0; i--) {
    const h = estimateTurnLines(turns[i], innerWidth)
    if (used + h > availRows) {
      // Always show at least the most recent turn — even if it's taller than
      // the available space (Ink will render it and scroll the terminal buffer).
      if (result.length === 0) {
        result.unshift(turns[i])
        return { visible: result, hiddenAbove: i, hiddenBelow }
      }
      return { visible: result, hiddenAbove: i + 1, hiddenBelow }
    }
    result.unshift(turns[i])
    used += h
  }
  return { visible: result, hiddenAbove: 0, hiddenBelow }
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── User message block ────────────────────────────────────────────────────────
const UserBlock: React.FC<{ content: string; timestamp: number }> = ({ content, timestamp }) => (
  <Box flexDirection="column" marginBottom={1} marginX={1} borderStyle="single" borderColor="#1D4ED8">
    <Box paddingX={1}>
      <Text color="#3B82F6" bold># </Text>
      <Text color="#E5E7EB" bold>{content}</Text>
    </Box>
    <Box paddingX={1}>
      <Text color="#374151">{fmtTime(timestamp)}</Text>
    </Box>
  </Box>
)

// ── Single message row (inside agent block) ───────────────────────────────────
const MsgRow: React.FC<{ msg: AgentMessage; maxLines?: number }> = ({ msg, maxLines }) => {
  switch (msg.type) {
    case 'text':
      return <MarkdownText content={msg.content} />
    case 'command': {
      const lines = msg.content.split('\n')
      return (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          {msg.commandTitle && (
            <Box marginBottom={0}>
              <Text color="#6B7280">┌─ </Text>
              <Text color="#9CA3AF" bold>{msg.commandTitle}</Text>
            </Box>
          )}
          <Box flexDirection="column" borderStyle="single" borderColor="#374151" paddingX={1}>
            {lines.map((line, i) => {
              if (line.startsWith('  /') || line.startsWith('  $') || line.startsWith('  !')) {
                const spaceIdx = line.search(/\s{2,}/)
                const cmd = spaceIdx > 0 ? line.slice(0, spaceIdx) : line
                const desc = spaceIdx > 0 ? line.slice(spaceIdx).trim() : ''
                return (
                  <Box key={i}>
                    <Text color="#3B82F6">{cmd}</Text>
                    {desc ? <Text color="#6B7280">  {desc}</Text> : null}
                  </Box>
                )
              }
              if (line.startsWith('**') && line.endsWith('**')) {
                return <Text key={i} color="#9CA3AF" bold>{line.replace(/\*\*/g, '')}</Text>
              }
              if (line === '') return <Text key={i}> </Text>
              const isKv = /^\s{2}\S.*\s:\s/.test(line)
              if (isKv) {
                const colonIdx = line.indexOf(' : ')
                const key = line.slice(0, colonIdx)
                const val = line.slice(colonIdx + 3)
                return (
                  <Box key={i}>
                    <Text color="#6B7280">{key} </Text>
                    <Text color="#374151">: </Text>
                    <Text color="#E5E7EB">{val}</Text>
                  </Box>
                )
              }
              return <Text key={i} color="#9CA3AF">{line}</Text>
            })}
          </Box>
        </Box>
      )
    }
    case 'tool_call': {
      if (!msg.toolCall) return null
      const a = msg.toolCall.arguments
      const cols = process.stdout.columns || 80
      const maxPath = Math.max(20, cols - 20)
      const tp = (s: unknown) => { const str = String(s || ''); return str.length > maxPath ? '…' + str.slice(-(maxPath - 1)) : str }
      const label = (() => {
        switch (msg.toolCall.tool) {
          case 'run_shell':     return `$ ${String(a.command || '').slice(0, cols - 10)}`
          case 'read_file':     return `Read  ${tp(a.path)}`
          case 'write_file':    return `Write  ${tp(a.path)}`
          case 'append_file':   return `Append  ${tp(a.path)}`
          case 'edit_file':     return null
          case 'delete_file':   return `Delete  ${tp(a.path)}`
          case 'move_file':     return `Move  ${tp(a.from)}  →  ${tp(a.to)}`
          case 'copy_file':     return `Copy  ${tp(a.from)}  →  ${tp(a.to)}`
          case 'create_dir':    return `mkdir  ${tp(a.path)}`
          case 'list_files':    return `ls  ${tp(a.path || '.')}`
          case 'find_files':    return `find  ${tp(a.pattern)}`
          case 'search_files':  return `grep  "${tp(a.pattern)}"`
          case 'git_status':    return 'git status'
          case 'git_diff':      return 'git diff'
          case 'git_log':       return 'git log'
          case 'git_commit':    return `git commit  "${String(a.message || '').slice(0, 40)}"`
          case 'web_fetch':     return `fetch  ${tp(a.url)}`
          case 'http_request':  return `${a.method || 'GET'}  ${tp(a.url)}`
          case 'lsp_check':     return `lsp  ${tp(a.path || '.')}`
          default:              return msg.toolCall.tool
        }
      })()
      if (!label) return null
      return (
        <Box flexDirection="row" paddingLeft={1}>
          <Text color="#374151">  </Text>
          <Text color="#6B7280" wrap="truncate-end">{label}</Text>
        </Box>
      )
    }
    case 'tool_result': {
      if (!msg.toolCall) return null
      if (msg.toolCall.tool === 'edit_file') return null
      if (!msg.toolResult?.success) {
        const errText = (msg.toolResult?.error || 'error').split('\n')[0]
        return (
          <Box flexDirection="row" paddingLeft={1}>
            <Text color="#EF4444" wrap="truncate-end">  ✗  {errText}</Text>
          </Box>
        )
      }
      const outLines = (msg.toolResult.output || '').split('\n').filter(Boolean)
      // skip trivial single-line outputs that are just the path echoed back
      const summary = outLines.length > 1
        ? `${outLines.length} lines`
        : (outLines[0] || '').slice(0, 60)
      if (!summary) return null
      return (
        <Box flexDirection="row" paddingLeft={1}>
          <Text color="#374151">  </Text>
          <Text color="#4B5563" wrap="truncate-end">{summary}</Text>
        </Box>
      )
    }
    case 'error':
      return <Text color="#EF4444" wrap="wrap">  ✗ {msg.content}</Text>
    case 'done': {
      let clean = msg.content
        .replace(/```json[\s\S]*?```/gi, '')
        .replace(/\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, '')
        .replace(/\s*DONE:\s*<[^>]*>/gi, '')
        .replace(/\s*DONE:\s*.*/gi, '')
        .trim()
      if (!clean) return null
      if (maxLines) {
        const allLines = clean.split('\n')
        if (allLines.length > maxLines) {
          const hidden = allLines.length - maxLines
          clean = allLines.slice(-maxLines).join('\n')
          return (
            <Box flexDirection="column">
              <Text color="#4B5563">  ↑ {hidden} more lines above (scroll up to read)…</Text>
              <MarkdownText content={clean} />
            </Box>
          )
        }
      }
      return <MarkdownText content={clean} />
    }
    default:
      return null
  }
}

// ── Agent turn block (blue left bar, splits on DiffViews) ─────────────────────
const AgentBlock: React.FC<{ messages: AgentMessage[]; model: string; maxLines?: number }> = ({ messages, model, maxLines }) => {
  type Section = { type: 'content'; msgs: AgentMessage[] } | { type: 'diff'; msg: AgentMessage }
  const sections: Section[] = []
  let buf: AgentMessage[] = []

  const flushBuf = () => { if (buf.length) { sections.push({ type: 'content', msgs: buf }); buf = [] } }

  for (const msg of messages) {
    if (msg.type === 'tool_result' && msg.toolCall?.tool === 'edit_file' && msg.toolResult?.meta?.diffPath) {
      flushBuf()
      sections.push({ type: 'diff', msg })
    } else {
      buf.push(msg)
    }
  }
  flushBuf()

  const doneMsg = messages.find(m => m.type === 'done')
  const ts = doneMsg?.timestamp ?? messages[messages.length - 1]?.timestamp

  const hasContent = messages.some(m =>
    (m.type === 'text' && m.content && !m.content.startsWith('> ')) ||
    m.type === 'error' ||
    (m.type === 'done' && m.content) ||
    (m.type === 'tool_result' && m.toolCall?.tool === 'edit_file')
  )

  return (
    <Box flexDirection="column" marginBottom={1}>
      {sections.map((sec, i) => {
        if (sec.type === 'diff') {
          const m = sec.msg.toolResult!.meta!
          return (
            <DiffView
              key={i}
              filePath={m.diffPath!}
              oldLines={m.diffOld!}
              newLines={m.diffNew!}
              startLine={m.diffStartLine!}
              contextBefore={m.diffContextBefore ?? []}
              contextAfter={m.diffContextAfter ?? []}
            />
          )
        }
        const isLast = i === sections.length - 1
        return (
          <Box key={i}>
            <Text color="#3B82F6">  │ </Text>
            <Box flexDirection="column" flexGrow={1}>
              {sec.msgs.map((msg, mi) => <MsgRow key={msg.id} msg={msg} maxLines={isLast && mi === sec.msgs.length - 1 ? maxLines : undefined} />)}
              {isLast && hasContent && ts && (
                <Box marginTop={0}>
                  <Text color="#374151">{model}</Text>
                  <Text color="#1D4ED8">  </Text>
                  <Text color="#374151">({fmtTime(ts)})</Text>
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

// ── Thinking tag parser ───────────────────────────────────────────────────────
function parseThinking(tokens: string): { thinking: string; response: string; stillThinking: boolean } {
  const start = tokens.indexOf('<think>')
  if (start === -1) return { thinking: '', response: tokens, stillThinking: false }

  const end = tokens.indexOf('</think>', start)
  if (end === -1) {
    return { thinking: tokens.slice(start + 7), response: '', stillThinking: true }
  }

  return {
    thinking: tokens.slice(start + 7, end),
    response: tokens.slice(end + 8).trimStart(),
    stillThinking: false,
  }
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
function getSuggestion(input: string, history: string[]): string {
  if (input.length < 2) return ''
  const h = history.find(s => s !== input && s.toLowerCase().startsWith(input.toLowerCase()))
  if (h) return h.slice(input.length)
  const c = BUILTIN_COMMANDS.find(b => b.cmd.startsWith(input) && b.cmd !== input)
  if (c) return c.cmd.slice(input.length)
  const a = COMMAND_SUGGESTIONS.find(s => s.startsWith(input) && s !== input)
  if (a) return a.slice(input.length)
  return ''
}

// ── App ───────────────────────────────────────────────────────────────────────
export const App: React.FC<AppProps> = ({ initialCommand, cwd, onStatusChange }) => {
  const { exit } = useApp()
  const cm = ConfigManager.getInstance()

  const [messages, setMessages]           = useState<AgentMessage[]>([])
  const [agentStatus, setAgentStatus]     = useState<AgentStatus>('idle')
  const [currentTokens, setCurrentTokens] = useState('')
  const [tokenCount, setTokenCount]       = useState(0)
  const [history, setHistory]             = useState<string[]>(() => cm.getHistory())
  const [confirm, setConfirm]             = useState<ConfirmRequest | null>(null)
  const [inputValue, setInputValue]       = useState('')
  const [histIndex, setHistIndex]         = useState(-1)
  const [pickerIdx, setPickerIdx]         = useState(0)
  const [scrollOffset, setScrollOffset]   = useState(0)  // turns vom Ende überspringen

  const [connectPopup, setConnectPopup]   = useState(false)
  const [modelPicker, setModelPicker]     = useState(false)
  const [modelList, setModelList]         = useState<string[]>([])
  const [modelLoading, setModelLoading]   = useState(false)
  const [filePicker, setFilePicker]       = useState(false)
  const [fileList, setFileList]           = useState<string[]>([])
  const [attachments, setAttachments]     = useState<Attachment[]>([])
  const [mode, setMode]                   = useState<'build' | 'plan'>('build')
  const [pluginCmds, setPluginCmds]       = useState<Array<{ cmd: string; description: string }>>([])
  const [convHistory, setConvHistory]     = useState<import('./shared/types').Message[]>([])
  const [infoPopup, setInfoPopup]         = useState<{ title: string; content: string } | null>(null)
  const [infoScroll, setInfoScroll]       = useState(0)

  const taskQueueRef   = useRef<string[]>([])  // tasks queued while agent is running
  const agentRef       = useRef<AgentRuntime | null>(null)
  const ptyRef         = useRef<PtyManager | null>(null)
  const hiddenAboveRef = useRef(0)
  // Token buffering: accumulate in a ref, flush to state at most every 100 ms
  // so the terminal doesn't repaint on every single token (ruins text selection).
  const tokenBufRef    = useRef('')
  const tokenCntRef    = useRef(0)
  const tokenFlushRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [termRows, setTermRows] = useState(process.stdout.rows || 24)
  const [termCols, setTermCols] = useState(process.stdout.columns || 80)

  // Stable ref that holds the latest state values — lets handleSubmit (useCallback)
  // always read fresh values without changing its identity every render.
  const s = useRef({ agentStatus, isRunning: false, attachments, mode, pickerIdx, messages, convHistory })
  s.current = { agentStatus, isRunning: agentStatus === 'thinking' || agentStatus === 'running', attachments, mode, pickerIdx, messages, convHistory }

  const showSplash = messages.length === 0 && agentStatus === 'idle' && !confirm && !connectPopup && !modelPicker && !filePicker && !infoPopup

  // Slash-command picker: filter BUILTIN_COMMANDS when input starts with /
  const allSlashCmds = [...BUILTIN_COMMANDS, ...pluginCmds]
  const slashCmds = (inputValue.startsWith('/') && agentStatus === 'idle' && !showSplash && !connectPopup && !modelPicker)
    ? allSlashCmds.filter(c => c.cmd.toLowerCase().startsWith(inputValue.toLowerCase())).slice(0, 7)
    : []
  const showPicker = slashCmds.length > 0

  const suggestion = !showSplash && !showPicker && !connectPopup && !modelPicker && agentStatus === 'idle'
    ? getSuggestion(inputValue, history) : ''
  const isRunning = agentStatus === 'thinking' || agentStatus === 'running'

  useEffect(() => {
    onStatusChange?.(agentStatus, cwd)
  }, [agentStatus])

  useEffect(() => {
    const onResize = () => { setTermRows(process.stdout.rows || 24); setTermCols(process.stdout.columns || 80) }
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize) }
  }, [])


  useEffect(() => {
    try { ptyRef.current = new PtyManager(cwd, cm.get().shell) } catch {}
    return () => { ptyRef.current?.kill() }
  }, [])

  useEffect(() => {
    if (initialCommand) {
      const t = setTimeout(() => handleSubmit(initialCommand), 150)
      return () => clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    const loader = PluginLoader.getInstance()
    loader.load()
    setPluginCmds(loader.getCommands().map(c => ({ cmd: c.cmd, description: c.description })))
  }, [])

  const showInfo = useCallback((title: string, lines: string[]) => {
    setInfoPopup({ title, content: lines.join('\n') })
    setInfoScroll(0)
  }, [])

  const addMsg = useCallback((msg: Omit<AgentMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, { ...msg, id: nextId(), timestamp: Date.now() }])
    setScrollOffset(0)  // auto-scroll nach unten
  }, [])

  const handleInputChange = useCallback((v: string) => {
    // Drag-and-drop detection: terminals paste the file path when a file is dropped.
    // Strip surrounding quotes that some terminals add (Windows Terminal, PowerShell).
    const trimmed = v.trim().replace(/^["']|["']$/g, '')
    const isWindowsPath = /^[A-Za-z]:[\\\/].{2,}/.test(trimmed)
    const isUnixPath    = /^\/[^\s\/]+\/[^\s]*/.test(trimmed)

    if (isWindowsPath || isUnixPath) {
      // Clear input immediately so the raw path doesn't flash on screen
      setInputValue('')
      setHistIndex(-1)
      setPickerIdx(0)
      loadAttachment(trimmed, cwd).then(att => {
        if (att) {
          setAttachments(prev => [...prev, att])
        } else {
          // Not a readable file — restore the typed value so user can edit it
          setInputValue(v)
        }
      })
      return
    }

    setInputValue(v); setHistIndex(-1); setPickerIdx(0)
  }, [cwd])

  const handleSubmit = useCallback(async (rawInput: string) => {
    // Always read fresh state from the ref — the useCallback dep array is intentionally
    // minimal so the function identity stays stable across renders.
    const { agentStatus, isRunning, attachments, mode, messages } = s.current

    const input = rawInput.trim()
    if (!input) return
    setInputValue(''); setHistIndex(-1); setPickerIdx(0)

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
            if (!val) { addMsg({ type: 'error', content: 'Usage: /config model <model-name>' }); break }
            cm.setLLM({ model: val })
            addMsg({ type: 'done', content: `Model → ${val}` })
            break
          case 'provider': {
            if (!val || !['ollama', 'lmstudio'].includes(val.toLowerCase())) {
              addMsg({ type: 'error', content: 'Available providers: ollama  lmstudio\n  /config provider ollama\n  /config provider lmstudio' })
              break
            }
            const defaults = val === 'lmstudio'
              ? { provider: 'lmstudio' as any, baseURL: 'http://localhost:1234/v1', model: cm.get().llm.model }
              : { provider: 'ollama'   as any, baseURL: 'http://localhost:11434',  model: cm.get().llm.model }
            cm.setLLM(defaults)
            addMsg({ type: 'done', content: `Provider → ${val}\nURL → ${defaults.baseURL}` })
            break
          }
          case 'url': case 'baseurl': case 'base-url':
            if (!val) { addMsg({ type: 'error', content: 'Usage: /config url <url>' }); break }
            cm.setLLM({ baseURL: val })
            addMsg({ type: 'done', content: `Base URL → ${val}` })
            break
          case 'temperature': case 'temp':
            if (!val) { addMsg({ type: 'error', content: 'Usage: /config temperature <0.0–1.0>' }); break }
            cm.setLLM({ temperature: parseFloat(val) })
            addMsg({ type: 'done', content: `Temperature → ${val}` })
            break
          default:
            addMsg({ type: 'error', content: `Unknown subcommand. Type /config for an overview.` })
        }
      }
      cm.addHistory(input); setHistory(cm.getHistory()); return
    }

    // ── exit / clear (also without slash) ────────────────────────────────────
    if (input === '/exit' || input === 'exit' || input === 'quit') { exit(); return }
    if (input === '/clear' || input === 'clear') { setMessages([]); setConvHistory([]); setInfoPopup(null); return }

    // ── /trust ────────────────────────────────────────────────────────────────
    if (input === '/trust' || input.startsWith('/trust ')) {
      const rest = input.slice(6).trim()
      const [sub, ...r2] = rest.split(/\s+/)
      const arg = r2.join(' ').trim() || sub

      if (!sub || sub === 'list') {
        const list = cm.listTrusted()
        showInfo('trusted paths', list.length
          ? ['**Trusted paths** (write ops auto-approved)', '', ...list.map(p => `  • ${p}`), '', '  /trust remove <path>   Remove trust']
          : ['  No trusted paths yet.', '', '  /trust <path>   Trust a folder', '  /trust .         Trust current working directory'])
      } else if (sub === 'remove') {
        if (!arg || arg === 'remove') { addMsg({ type: 'error', content: 'Usage: /trust remove <path>' }); return }
        const { resolve: nodeResolve } = await import('path')
        cm.untrustPath(nodeResolve(cwd, arg))
        addMsg({ type: 'done', content: `Removed trust: ${arg}` })
      } else {
        const { resolve: nodeResolve } = await import('path')
        const abs = nodeResolve(cwd, sub)
        cm.trustPath(abs)
        addMsg({ type: 'done', content: `Trusted: ${abs}\nAll write operations in this folder and subfolders will be auto-approved.` })
      }
      cm.addHistory(input); setHistory(cm.getHistory()); return
    }

    // ── /lsp ──────────────────────────────────────────────────────────────────
    if (input === '/lsp' || input.startsWith('/lsp ')) {
      const targetArg = input.slice(4).trim() || '.'
      setAgentStatus('thinking')
      setCurrentTokens('')
      const { diagnostics, tool, error } = await lspCheck(cwd, targetArg === '.' ? undefined : targetArg)
      setAgentStatus('idle')
      setCurrentTokens('')
      if (error && diagnostics.length === 0) {
        addMsg({ type: 'error', content: error })
      } else if (diagnostics.length === 0) {
        addMsg({ type: 'command', commandTitle: `lsp (${tool})`, content: '  ✓ No issues found' })
      } else {
        const errors   = diagnostics.filter(d => d.severity === 'error').length
        const warnings = diagnostics.filter(d => d.severity === 'warning').length
        const lines = [
          `  ${tool}: ${errors} error${errors !== 1 ? 's' : ''}, ${warnings} warning${warnings !== 1 ? 's' : ''}`,
          '',
          ...diagnostics.slice(0, 40).map(d =>
            `  ${d.file}:${d.line}:${d.col}  ${d.severity}  ${d.message}${d.code ? `  [${d.code}]` : ''}`
          ),
          ...(diagnostics.length > 40 ? [`  … and ${diagnostics.length - 40} more`] : []),
        ]
        addMsg({ type: 'command', commandTitle: `lsp (${tool})`, content: lines.join('\n') })
      }
      cm.addHistory(input); setHistory(cm.getHistory()); return
    }

    // ── /attach ───────────────────────────────────────────────────────────────
    if (input === '/attach') {
      setFilePicker(true);
      (async () => { setFileList(await listCwdFiles(cwd)) })()
      return
    }

    // ── /compact ──────────────────────────────────────────────────────────────
    if (input === '/compact') {
      if (messages.length === 0) { addMsg({ type: 'error', content: 'Nothing to compact.' }); return }
      setAgentStatus('thinking')
      setCurrentTokens('')
      const summary = messages.map(m => {
        if (m.type === 'text' && m.content.startsWith('> ')) return `User: ${m.content.slice(2)}`
        if (m.type === 'done') return `Assistant: ${m.content.replace(/^DONE:\s*/i, '').trim()}`
        if (m.type === 'tool_call' && m.toolCall) return `  [${m.toolCall.tool}]`
        return null
      }).filter(Boolean).join('\n')
      const summaryMsgs = [
        { role: 'system' as const, content: 'You are a helpful assistant. Summarize the following conversation concisely in bullet points, preserving key decisions and results.' },
        { role: 'user' as const, content: summary },
      ]
      let compacted = ''
      try {
        await LLMRouter.stream(summaryMsgs, cm.get().llm, t => { compacted += t; setCurrentTokens(compacted) })
      } catch {}
      setCurrentTokens('')
      setAgentStatus('idle')
      setMessages([])
      setConvHistory([])
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
        showInfo('sessions', sessions.length
          ? ['**Saved sessions**', '', ...sessions.map(s => `  • ${s}`), '', '  /session load <name>   Restore  ·  /session delete <name>   Remove']
          : ['  No sessions saved yet.', '', '  /session save <name>   Bookmark this conversation'])
      } else if (sub === 'save') {
        if (!name || name === 'save') { addMsg({ type: 'error', content: 'Usage: /session save <name>' }); return }
        cm.saveSession(name, messages)
        addMsg({ type: 'done', content: `Session "${name}" saved  (${messages.length} messages)` })
      } else if (sub === 'load') {
        if (!name || name === 'load') { addMsg({ type: 'error', content: 'Usage: /session load <name>' }); return }
        const loaded = cm.loadSession(name)
        if (!loaded) { addMsg({ type: 'error', content: `Session "${name}" not found.` }); return }
        setMessages(loaded)
        addMsg({ type: 'done', content: `Session "${name}" loaded  (${loaded.length} messages)` })
      } else if (sub === 'delete') {
        if (!name || name === 'delete') { addMsg({ type: 'error', content: 'Usage: /session delete <name>' }); return }
        cm.deleteSession(name)
        addMsg({ type: 'done', content: `Session "${name}" deleted` })
      } else {
        addMsg({ type: 'error', content: 'Usage: /session [list|save <name>|load <name>|delete <name>]' })
      }
      cm.addHistory(input); setHistory(cm.getHistory()); return
    }

    // ── /connect ──────────────────────────────────────────────────────────────
    if (input === '/connect') {
      setInputValue('')
      setConnectPopup(true)
      return
    }

    // ── /model ────────────────────────────────────────────────────────────────
    if (input === '/model') {
      setInputValue('')
      setModelPicker(true)
      setModelLoading(true)
      setModelList([]);
      (async () => {
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
      const loader = PluginLoader.getInstance()

      if (!sub || sub === 'list') {
        const plugins = loader.getAll()
        const errors  = loader.getErrors()
        const lines: string[] = ['**Plugins**', '']
        if (plugins.length === 0 && errors.length === 0) {
          lines.push(`  No plugins installed.`)
          lines.push(`  Plugin dir: ${loader.getPluginDir()}`)
          lines.push('')
          lines.push('  /plugin install <path>   Install a plugin')
        } else {
          for (const p of plugins) {
            const cmds  = (p.commands ?? []).map(c => c.cmd.trim()).join(', ')
            const tools = (p.tools    ?? []).map(t => t.name).join(', ')
            lines.push(`  • ${p.name}  v${p.version}${p.description ? '  ' + p.description : ''}`)
            if (cmds)  lines.push(`    commands : ${cmds}`)
            if (tools) lines.push(`    tools    : ${tools}`)
          }
          for (const e of errors) lines.push(`  ✗ ${e.file}: ${e.error}`)
        }
        showInfo('plugins', lines)
      } else if (sub === 'install') {
        if (!arg) { addMsg({ type: 'error', content: 'Usage: /plugin install <path>' }); cm.addHistory(input); setHistory(cm.getHistory()); return }
        setAgentStatus('thinking')
        const result = await loader.install(arg)
        setAgentStatus('idle')
        if (result.ok) {
          setPluginCmds(loader.getCommands().map(c => ({ cmd: c.cmd, description: c.description })))
          addMsg({ type: 'done', content: `Plugin "${result.name}" installed successfully` })
        } else {
          addMsg({ type: 'error', content: `Install failed: ${result.error}` })
        }
      } else if (sub === 'remove') {
        if (!arg) { addMsg({ type: 'error', content: 'Usage: /plugin remove <name>' }); cm.addHistory(input); setHistory(cm.getHistory()); return }
        setAgentStatus('thinking')
        const result = await loader.remove(arg)
        setAgentStatus('idle')
        if (result.ok) {
          setPluginCmds(loader.getCommands().map(c => ({ cmd: c.cmd, description: c.description })))
          addMsg({ type: 'done', content: `Plugin "${arg}" removed` })
        } else {
          addMsg({ type: 'error', content: result.error || 'Remove failed' })
        }
      } else if (sub === 'reload') {
        loader.reload()
        setPluginCmds(loader.getCommands().map(c => ({ cmd: c.cmd, description: c.description })))
        addMsg({ type: 'done', content: `Plugins reloaded  (${loader.getAll().length} loaded)` })
      } else {
        addMsg({ type: 'error', content: 'Usage: /plugin [list | install <path> | remove <name> | reload]' })
      }
      cm.addHistory(input); setHistory(cm.getHistory()); return
    }

    // ── Plugin slash-command routing ──────────────────────────────────────────
    if (input.startsWith('/')) {
      const commands = PluginLoader.getInstance().getCommands()
      const trimmed  = input.trim()
      const matched  = commands.find(c => {
        const key = c.cmd.trimEnd()
        return trimmed === key || trimmed.startsWith(key + ' ')
      })
      if (matched) {
        const key  = matched.cmd.trimEnd()
        const args = trimmed.slice(key.length).trim()
        setAgentStatus('thinking')
        try {
          const result = await matched.handler(args, { cwd })
          setAgentStatus('idle')
          if (result.type === 'error') {
            addMsg({ type: 'error', content: result.content })
          } else if (result.type === 'command') {
            addMsg({ type: 'command', commandTitle: result.title, content: result.content })
          } else {
            addMsg({ type: 'done', content: result.content })
          }
        } catch (e) {
          setAgentStatus('idle')
          addMsg({ type: 'error', content: `Plugin error: ${String(e)}` })
        }
        cm.addHistory(input); setHistory(cm.getHistory()); return
      }
    }

    switch (input.trim().toLowerCase()) {
      case 'exit': case 'quit': exit(); return
      case 'clear': setMessages([]); return
      case 'help': case '/help':
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
          '  /compact                       Summarize & compress conversation',
          '',
          '**Connection**',
          '  /connect                       Connect to server (popup)',
          '  /model                         Select model (popup)',
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
          '  /models                        List available models',
          '  /doctor                        Check connection & status',
          '  /clear                         Clear screen',
          '  /exit                          Quit',
          '',
          '**Keyboard shortcuts**',
          '  ctrl+c                         Abort agent  /  quit',
          '  ctrl+l                         Clear chat history',
          '  ctrl+k                         Clear input line',
          '  ↑ ↓                            Navigate input history',
          '  tab                            Autocomplete / toggle BUILD↔PLAN',
          '  scroll wheel / PgUp / PgDn     Scroll chat',
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
      case 'doctor': {
        showInfo('doctor', ['  Checking…'])
        const cfg = cm.get()
        const isOllama = cfg.llm.provider === 'ollama'
        const healthy = isOllama
          ? await LLMRouter.getOllamaProvider().checkHealth(cfg.llm.baseURL)
          : await LLMRouter.getLMStudioProvider().checkHealth(cfg.llm.baseURL)
        const provName = isOllama ? 'Ollama' : 'LM Studio'
        const provHint = isOllama ? 'ollama serve' : 'LM Studio → start Local Server'
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
      case 'models': {
        showInfo('models', ['  Loading…'])
        const cfg = cm.get()
        const isOllama = cfg.llm.provider === 'ollama'
        const models = isOllama
          ? await LLMRouter.getOllamaProvider().listModels(cfg.llm.baseURL)
          : await LLMRouter.getLMStudioProvider().listModels(cfg.llm.baseURL)
        const provName = isOllama ? 'Ollama' : 'LM Studio'
        showInfo('models', models.length
          ? ['**Available models**', '', ...models.map(m => `  • ${m}`), '', `  /config model <name>  to switch`]
          : isOllama
            ? ['  No Ollama models found.', '', '  $ ollama pull deepseek-coder']
            : ['  No LM Studio models found.', '', '  Open LM Studio and load a model.'])
        break
      }
      default: {
        if (input.startsWith('$') || input.startsWith('!')) {
          ptyRef.current?.write(input.slice(1).trim() + '\n')
          break
        }

        // Mid-task: inject short side-notes, queue full tasks for after agent finishes
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

        // Safety: catch local file paths that slipped through drag-and-drop detection
        // (timing edge cases, unusual terminal quoting, etc.)
        const strippedForPath = input.trim().replace(/^["']|["']$/g, '')
        const isLocalPath = /^[A-Za-z]:[\\\/].{2,}/.test(strippedForPath) || /^\/[^\s]{2,}/.test(strippedForPath)
        if (isLocalPath) {
          const att = await loadAttachment(strippedForPath, cwd)
          if (att) {
            setAttachments(prev => [...prev, att])
            return
          }
        }

        // Parse @mentions from the input text
        const atPattern = /@([^\s]+)/g
        const pendingAtts: Promise<Attachment | null>[] = []
        let cleanInput = input
        let m
        while ((m = atPattern.exec(input)) !== null) {
          pendingAtts.push(loadAttachment(m[1], cwd))
          cleanInput = cleanInput.replace(m[0], `[${m[1]}]`)
        }
        const resolved = await Promise.all(pendingAtts)
        const mentionAtts = resolved.filter((a): a is Attachment => a !== null)
        const allAtts = [...attachments, ...mentionAtts]  // attachments from ref — always fresh

        setAgentStatus('thinking')
        setCurrentTokens('')
        setTokenCount(0)

        // Show user message with attachment indicators
        const attLabel = allAtts.length
          ? `  [${allAtts.map(a => a.name).join(', ')}]`
          : ''
        addMsg({ type: 'text', content: `> ${cleanInput}${attLabel}` })
        setAttachments([])

        const agent = new AgentRuntime()
        agentRef.current = agent

        // Reset token buffer for this run
        tokenBufRef.current = ''
        tokenCntRef.current = 0
        if (tokenFlushRef.current) { clearTimeout(tokenFlushRef.current); tokenFlushRef.current = null }

        const flushTokens = () => {
          tokenFlushRef.current = null
          setCurrentTokens(tokenBufRef.current)
          setTokenCount(tokenCntRef.current)
        }

        agent.on('thinking', () => { setAgentStatus('thinking'); setCurrentTokens('') })
        agent.on('token', (token: string) => {
          setAgentStatus('running')
          tokenBufRef.current += token
          tokenCntRef.current += token.length
          // Schedule a flush at most every 100 ms — reduces repaints so text selection isn't wiped
          if (!tokenFlushRef.current) tokenFlushRef.current = setTimeout(flushTokens, 100)
        })
        agent.on('tool_call', ({ toolCall }: { toolCall: ToolCall }) => {
          setCurrentTokens('')
          addMsg({ type: 'tool_call', content: toolCall.tool, toolCall })
        })
        agent.on('tool_result', ({ toolCall, result }: { toolCall: ToolCall; result: ToolResult }) => {
          addMsg({ type: 'tool_result', content: '', toolCall, toolResult: result })
        })
        agent.on('confirm_required', ({ toolCall, reason, diffPreview, dangerous }: { toolCall: ToolCall; reason: string; diffPreview?: DiffPreview; dangerous?: boolean }) => {
          setConfirm({ toolCall, reason, diffPreview, dangerous })
        })
        agent.on('injection', ({ message }: { message: string }) => {
          // Already shown in the UI when inject() was called; just acknowledge
        })
        agent.on('error', (msg: string) => {
          if (tokenFlushRef.current) { clearTimeout(tokenFlushRef.current); tokenFlushRef.current = null }
          tokenBufRef.current = ''; tokenCntRef.current = 0
          setAgentStatus('error'); addMsg({ type: 'error', content: msg })
        })
        agent.on('done', ({ response, aborted }: { response: string; aborted?: boolean }) => {
          if (tokenFlushRef.current) { clearTimeout(tokenFlushRef.current); tokenFlushRef.current = null }
          tokenBufRef.current = ''; tokenCntRef.current = 0
          setCurrentTokens('')
          setAgentStatus('idle')
          setConfirm(null)
          agentRef.current = null
          // "Aborted." is already shown by the Ctrl+C handler — don't double-print
          if (!aborted && response) {
            addMsg({ type: 'done', content: response })
            setConvHistory(prev => [
              ...prev,
              { role: 'user' as const, content: cleanInput },
              { role: 'assistant' as const, content: response },
            ].slice(-40))
          }
          // Run next queued task if any (only when not aborted)
          if (!aborted && taskQueueRef.current.length > 0) {
            const next = taskQueueRef.current.shift()!
            setTimeout(() => handleSubmit(next), 50)
          }
        })
        const { convHistory } = s.current
        agent.run(cleanInput, cwd, allAtts, mode, convHistory).catch((err: Error) => {
          setAgentStatus('error')
          addMsg({ type: 'error', content: String(err) })
          agentRef.current = null
        })
        break
      }
    }

    cm.addHistory(input)
    setHistory(cm.getHistory())
  }, [addMsg, cwd, exit])

  useInput((key, inp) => {
    // ── Wenn Popup offen: nur Ctrl+C durchlassen, Rest übernimmt Popup ──
    if (connectPopup || modelPicker || filePicker) {
      if (inp.ctrl && key === 'c') {
        setConnectPopup(false)
        setModelPicker(false)
        setFilePicker(false)
      }
      return
    }

    // ── Info-Popup Navigation ──
    if (infoPopup) {
      if (inp.escape || (inp.ctrl && key === 'c')) { setInfoPopup(null); setInfoScroll(0); return }
      if (inp.upArrow)   { setInfoScroll(s => Math.max(0, s - 1));  return }
      if (inp.downArrow) { setInfoScroll(s => s + 1);               return }
      if (inp.pageUp)    { setInfoScroll(s => Math.max(0, s - 10)); return }
      if (inp.pageDown)  { setInfoScroll(s => s + 10);              return }
      return
    }

    // ── Scrollen (immer verfügbar wenn Chat sichtbar) ──
    if (!showSplash) {
      if (inp.pageUp)   { setScrollOffset(o => o + 2); return }
      if (inp.pageDown) { setScrollOffset(o => Math.max(0, o - 2)); return }
    }

    if (!showSplash && agentStatus === 'idle') {

      // ── Picker aktiv: Pfeiltasten + Tab/Escape steuern den Picker ──
      if (showPicker) {
        if (inp.upArrow) {
          setPickerIdx(i => Math.max(0, i - 1)); return
        }
        if (inp.downArrow) {
          setPickerIdx(i => Math.min(slashCmds.length - 1, i + 1)); return
        }
        if (inp.tab) {
          const sel = slashCmds[pickerIdx]
          if (sel) {
            setInputValue(sel.cmd.endsWith(' ') ? sel.cmd : sel.cmd.trim())
            setPickerIdx(0)
          }
          return
        }
        if (inp.escape) { setInputValue(''); setPickerIdx(0); setHistIndex(-1); return }
        return
      }

      // ── Kein Picker: Tab = Mode toggle (wenn kein Autocomplete) oder Autocomplete ──
      if (inp.tab && !suggestion) { setMode(m => m === 'build' ? 'plan' : 'build'); return }
      if (inp.tab && suggestion)  { setInputValue(inputValue + suggestion); return }
      if (inp.upArrow) {
        // Empty input + not navigating history → scroll chat up (wheel-friendly)
        if (inputValue === '' && histIndex === -1) { setScrollOffset(o => o + 1); return }
        const next = Math.min(histIndex + 1, history.length - 1)
        setHistIndex(next); if (history[next]) setInputValue(history[next]); return
      }
      if (inp.downArrow) {
        if (inputValue === '' && histIndex === -1) { setScrollOffset(o => Math.max(0, o - 1)); return }
        const next = Math.max(histIndex - 1, -1)
        setHistIndex(next); setInputValue(next === -1 ? '' : history[next] || ''); return
      }
      if (inp.escape) { setInputValue(''); setHistIndex(-1); return }
    }

    if (inp.ctrl && key === 'c') {
      if (agentRef.current) {
        agentRef.current.abort(); agentRef.current = null
        taskQueueRef.current = []  // discard queued tasks when aborting
        if (tokenFlushRef.current) { clearTimeout(tokenFlushRef.current); tokenFlushRef.current = null }
        tokenBufRef.current = ''; tokenCntRef.current = 0
        setAgentStatus('idle'); setCurrentTokens('')
        addMsg({ type: 'error', content: 'Aborted.' })
      } else { exit() }
      return
    }

    if (inp.ctrl && key === 'l') { setMessages([]); return }
    if (inp.ctrl && key === 'k') { setInputValue(''); setHistIndex(-1); return }

    if (confirm) {
      if (key === 'y' || key === 'Y') { agentRef.current?.confirm(true, false); setConfirm(null) }
      else if (key === 't' || key === 'T') { agentRef.current?.confirm(true, true); setConfirm(null) }
      else if (key === 'n' || key === 'N' || inp.escape) { agentRef.current?.confirm(false, false); setConfirm(null) }
    }
  })

  const config = cm.get()
  const providerLabel = config.llm.provider === 'lmstudio' ? 'LM Studio' : 'Ollama'
  const modeLabel = mode === 'plan' ? 'PLAN MODE' : 'BUILD MODE'

  // ── Layout budget (computed once, drives both chat turns AND stream block) ────
  const { thinking: streamThinking } = parseThinking(currentTokens)
  const streamThinkReserve = streamThinking ? 5 : 0  // 2 header + 3 think lines
  const maxStreamLines = (currentTokens || isRunning)
    ? Math.max(3, termRows - 14 - streamThinkReserve)
    : 0
  const innerStreamW = Math.max(20, termCols - 10)
  const streamH = (currentTokens || isRunning)
    ? (currentTokens ? streamThinkReserve + 1 + maxStreamLines : 2)
    : 0
  const layoutPickerH  = showPicker ? Math.min(slashCmds.length + 3, 10) : 0
  const layoutAttachH  = attachments.length > 0 ? 1 : 0
  const layoutConfirmDiffH = confirm?.diffPreview
    ? Math.min(
        confirm.diffPreview.contextBefore.length + confirm.diffPreview.oldLines.length +
        confirm.diffPreview.newLines.length + confirm.diffPreview.contextAfter.length + 4,
        termRows - 10
      )
    : 0
  const layoutConfirmH = confirm ? Math.min(3 + layoutConfirmDiffH, termRows - 8) : 0
  const layoutInputH   = 4 + layoutAttachH
  // 1 = status bar, 1 = scroll indicator line, 1 = spacer
  const layoutReserved = layoutInputH + 1 + layoutPickerH + streamH + layoutConfirmH + 3
  const chatAvailable  = Math.max(2, termRows - layoutReserved)
  const chatInnerW     = Math.max(20, termCols - 8)

  return (
    <Box flexDirection="column" height={termRows}>

      {showSplash ? (
        /* ── Splash: fills terminal, status bar at bottom ── */
        <>
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Splash config={config} history={history} mode={mode} onSubmit={handleSubmit} onToggleMode={() => setMode(m => m === 'build' ? 'plan' : 'build')} />
          </Box>
          <StatusBar config={config} cwd={cwd} agentStatus={agentStatus} tokenCount={tokenCount} mode={mode} />
        </>
      ) : (
        /* ── Chat view ── */
        <>
          <Box flexGrow={1} flexShrink={1} />

          {infoPopup ? (
            <InfoPopup
              title={infoPopup.title}
              content={infoPopup.content}
              scroll={infoScroll}
              termRows={termRows}
              termCols={termCols}
            />
          ) : null}

          {!infoPopup && (() => {
            const allTurns  = groupIntoTurns(messages)
            const safeOffset = Math.min(scrollOffset, Math.max(0, allTurns.length - 1))
            const { visible, hiddenAbove, hiddenBelow } = getVisibleTurns(allTurns, chatAvailable, chatInnerW, safeOffset)
            hiddenAboveRef.current = hiddenAbove

            return (
              <>
                {/* Scroll-Indikator oben */}
                {hiddenAbove > 0
                  ? (
                    <Box paddingX={1} marginBottom={0}>
                      <Text backgroundColor="#92400E" color="#FEF3C7"> ↑ PageUp </Text>
                      <Text color="#F59E0B" bold>  {hiddenAbove} older messages hidden above</Text>
                    </Box>
                  )
                  : <Text> </Text>
                }

                {visible.map((turn, i) =>
                  turn.type === 'user'
                    ? <UserBlock key={i} content={turn.content} timestamp={turn.timestamp} />
                    : <AgentBlock key={i} messages={turn.messages} model={config.llm.model}
                        maxLines={i === visible.length - 1 ? Math.max(5, chatAvailable - 4) : undefined} />
                )}

                {/* Scroll-Indikator unten (wenn nach oben gescrollt) */}
                {hiddenBelow > 0 && (
                  <Box paddingX={1}>
                    <Text backgroundColor="#1E3A5F" color="#BFDBFE"> ↓ PageDown </Text>
                    <Text color="#60A5FA" bold>  {hiddenBelow} newer messages below</Text>
                  </Box>
                )}
              </>
            )
          })()}

          {/* Live streaming block — height-capped so input is never pushed off */}
          {(currentTokens || (isRunning && !currentTokens)) && (() => {
            const { thinking, response, stillThinking } = parseThinking(currentTokens)
            // Strip everything from where a tool-call JSON starts (complete or mid-stream)
            let cleanResponse = response.replace(/```json[\s\S]*?```/gi, '')
            const toolIdx = cleanResponse.search(/\{[\s\S]*?"tool"\s*:/)
            if (toolIdx !== -1) cleanResponse = cleanResponse.slice(0, toolIdx)
            cleanResponse = cleanResponse.trim()

            // Use pre-computed maxStreamLines and innerStreamW (same values used in layout budget)
            const srcLines = cleanResponse.split('\n')
            const rendered: string[] = []
            for (const l of srcLines) {
              if (!l) { rendered.push(''); continue }
              const chunks = Math.max(1, Math.ceil(l.length / innerStreamW))
              for (let c = 0; c < chunks; c++) rendered.push(l.slice(c * innerStreamW, (c + 1) * innerStreamW))
            }
            const overflow = Math.max(0, rendered.length - maxStreamLines)
            const visibleLines = rendered.slice(overflow)

            const thinkLines = thinking.trimEnd().split('\n').filter(l => l.trim()).slice(-3)

            return (
              <Box marginBottom={0} flexDirection="column">
                {thinking && (
                  <Box flexDirection="column">
                    <Box>
                      <Text color="#3B82F6">  │ </Text>
                      <Text color="#6366F1" bold>Reasoning</Text>
                      {stillThinking && <ThinkingDots label="" />}
                    </Box>
                    {thinkLines.map((line, i) => (
                      <Box key={i}>
                        <Text color="#3B82F6">  │ </Text>
                        <Text color="#4B5563" italic>{line.slice(0, innerStreamW)}</Text>
                      </Box>
                    ))}
                  </Box>
                )}
                {overflow > 0 && (
                  <Box>
                    <Text color="#3B82F6">  │ </Text>
                    <Text color="#4B5563">↑ {overflow} lines above…</Text>
                  </Box>
                )}
                {!currentTokens
                  ? (
                    <Box>
                      <Text color="#3B82F6">  │ </Text>
                      <Box flexGrow={1}><Text color="#6366F1">Thinking </Text><ThinkingDots label="" /></Box>
                    </Box>
                  )
                  : visibleLines.length > 0
                    ? visibleLines.map((line, i) => (
                        <Box key={i}>
                          <Text color="#3B82F6">  │ </Text>
                          <Text color="#D1D5DB" wrap="truncate-end">{line || ' '}</Text>
                          {i === visibleLines.length - 1 && <Text color="#3B82F6">█</Text>}
                        </Box>
                      ))
                    : stillThinking
                      ? (
                        <Box>
                          <Text color="#3B82F6">  │ </Text>
                          <Box flexGrow={1}><Text color="#6366F1">Thinking </Text><ThinkingDots label="" /></Box>
                        </Box>
                      )
                      : null
                }
              </Box>
            )
          })()}

          {/* Confirm dialog */}
          {confirm && (
            <Box flexDirection="column" marginX={1} marginBottom={1} borderStyle="single"
              borderColor={confirm.dangerous ? '#EF4444' : '#F59E0B'}>
              {confirm.dangerous && (
                <Box paddingX={2} paddingTop={0}>
                  <Text backgroundColor="#7F1D1D" color="#FCA5A5" bold> ⚠  DANGEROUS OPERATION — review carefully </Text>
                </Box>
              )}
              {confirm.diffPreview && (
                <DiffView
                  filePath={confirm.diffPreview.filePath}
                  oldLines={confirm.diffPreview.oldLines}
                  newLines={confirm.diffPreview.newLines}
                  startLine={confirm.diffPreview.startLine}
                  contextBefore={confirm.diffPreview.contextBefore}
                  contextAfter={confirm.diffPreview.contextAfter}
                />
              )}
              <Box paddingX={2} paddingY={0} flexDirection="column">
                <Box>
                  <Text color={confirm.dangerous ? '#EF4444' : '#F59E0B'}>
                    {confirm.dangerous ? '⚠  ' : 'Allow  '}
                  </Text>
                  <Text color="#D1D5DB" wrap="truncate-end">{confirm.reason}</Text>
                </Box>
                <Box marginTop={0}>
                  <Text color="#22C55E">[y] yes</Text>
                  <Text color="#4B5563">  /  </Text>
                  <Text color="#EF4444">[n] no</Text>
                  {!confirm.dangerous && (
                    <>
                      <Text color="#4B5563">  /  </Text>
                      <Text color="#A78BFA">[t] trust folder</Text>
                    </>
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {/* ── Connect Popup ── */}
          {connectPopup && (
            <ConnectPopup
              onConnect={(provider, baseURL) => {
                cm.setLLM({ provider: provider as any, baseURL })
                setConnectPopup(false)
                addMsg({ type: 'done', content: `Connected · ${provider}  ${baseURL}` })
              }}
              onCancel={() => setConnectPopup(false)}
            />
          )}

          {/* ── Model Picker ── */}
          {modelPicker && (
            <ModelPicker
              models={modelList}
              loading={modelLoading}
              currentModel={config.llm.model}
              onSelect={model => {
                cm.setLLM({ model })
                setModelPicker(false)
                addMsg({ type: 'done', content: `Model → ${model}` })
              }}
              onCancel={() => setModelPicker(false)}
            />
          )}

          {/* ── FilePicker ── */}
          {filePicker && (
            <FilePicker
              files={fileList}
              onSelect={async (path) => {
                setFilePicker(false)
                const att = await loadAttachment(path, cwd)
                if (att) setAttachments(prev => [...prev, att])
              }}
              onCancel={() => setFilePicker(false)}
            />
          )}

          {/* ── Slash-Command Picker — above input ── */}
          {showPicker && (
            <Box flexDirection="column" borderStyle="round" borderColor="#2D4A7A" marginX={1}>
              {slashCmds.map((cmd, i) => {
                const sel = i === pickerIdx
                return (
                  <Box key={cmd.cmd} paddingX={1}>
                    <Text color={sel ? '#3B82F6' : '#374151'}>{sel ? '▶ ' : '  '}</Text>
                    <Text color={sel ? '#60A5FA' : '#6B7280'} bold>{cmd.cmd.trimEnd()}</Text>
                    <Text color={sel ? '#4B5563' : '#374151'}>  {cmd.description}</Text>
                  </Box>
                )
              })}
            </Box>
          )}

          {/* ── Input box (hidden when info popup is open) ── */}
          {!infoPopup && <Box flexDirection="column" borderStyle="single" borderColor={mode === 'plan' ? '#14532D' : '#1E3A5F'} marginX={1}>
            {/* Attachment strip */}
            {attachments.length > 0 && (
              <Box paddingX={1} flexDirection="row">
                {attachments.map((att, i) => (
                  <Box key={i} marginRight={1}>
                    <Text color={att.type === 'image' ? '#A78BFA' : '#60A5FA'}>
                      @{att.name}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* Input row */}
            <Box paddingX={1}>
              <Text color={
                isRunning ? '#F59E0B' :
                mode === 'plan' ? '#22C55E' : '#3B82F6'
              } bold>{'> '}</Text>
              <TextInput
                value={inputValue}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder={
                  isRunning
                    ? 'inject message to agent...'
                    : mode === 'plan'
                      ? 'describe what to plan...'
                      : '/ for commands  ·  @ to attach files'
                }
                focus={!confirm && !connectPopup && !modelPicker && !filePicker}
              />
              {suggestion && !isRunning && <Text color="#1F2937">{suggestion}</Text>}
            </Box>

            {/* Hint bar */}
            <Box paddingX={1} justifyContent="space-between">
              <Box>
                {isRunning ? (
                  <>
                    <Text color="#F59E0B">ctrl+c </Text>
                    <Text color="#6B7280">abort  </Text>
                    <Text color="#4B5563">↵ </Text>
                    <Text color="#6B7280">inject message</Text>
                  </>
                ) : (
                  <>
                    <Text color="#4B5563">↵ </Text>
                    <Text color="#6B7280">send  </Text>
                    <Text color="#4B5563">tab </Text>
                    <Text color="#6B7280">{suggestion ? 'complete' : 'switch mode'}  </Text>
                    <Text color="#4B5563">@ </Text>
                    <Text color="#6B7280">attach</Text>
                    {hiddenAboveRef.current > 0 && (
                      <>
                        <Text color="#4B5563">  │  </Text>
                        <Text color="#F59E0B">↑ PgUp </Text>
                        <Text color="#D97706">{hiddenAboveRef.current} hidden</Text>
                      </>
                    )}
                  </>
                )}
              </Box>
              <Box>
                <Text
                  backgroundColor={mode === 'plan' ? '#166534' : '#1D4ED8'}
                  color={mode === 'plan' ? '#86EFAC' : '#BFDBFE'}
                > {mode === 'plan' ? 'PLAN' : 'BUILD'} </Text>
                <Text color="#374151">  </Text>
                <Text color="#9CA3AF">{config.llm.model.length > 24 ? config.llm.model.slice(0, 24) + '…' : config.llm.model}</Text>
              </Box>
            </Box>
          </Box>}

          {/* Status bar — 1 line */}
          <StatusBar config={config} cwd={cwd} agentStatus={agentStatus} tokenCount={tokenCount} mode={mode} />
        </>
      )}

    </Box>
  )
}
