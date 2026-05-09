import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { Splash } from './components/Splash'
import { StatusBar } from './components/StatusBar'
import { ThinkingDots } from './components/ThinkingDots'
import { DiffView } from './components/DiffView'
import { MarkdownText } from './components/MarkdownText'
import { ConnectPopup } from './components/ConnectPopup'
import { ModelPicker } from './components/ModelPicker'
import { AgentRuntime, DiffPreview } from './agent/AgentRuntime'
import { ConfigManager } from './config/ConfigManager'
import { PtyManager } from './pty/PtyManager'
import { LLMRouter } from './llm/LLMRouter'
import { AgentMessage, ToolCall, ToolResult } from './shared/types'
import { BUILTIN_COMMANDS, COMMAND_SUGGESTIONS } from './shared/constants'

let _id = 0
const nextId = () => String(++_id)

type AgentStatus = 'idle' | 'running' | 'thinking' | 'error'
interface ConfirmRequest { toolCall: ToolCall; reason: string; diffPreview?: DiffPreview }
interface AppProps { initialCommand?: string; cwd: string }

// ── Turn grouping ─────────────────────────────────────────────────────────────
type Turn = { type: 'user'; content: string } | { type: 'agent'; messages: AgentMessage[] }

function groupIntoTurns(messages: AgentMessage[]): Turn[] {
  const turns: Turn[] = []
  let agentMsgs: AgentMessage[] = []

  const flush = () => {
    if (agentMsgs.length > 0) { turns.push({ type: 'agent', messages: agentMsgs }); agentMsgs = [] }

  }

  for (const msg of messages) {
    if (msg.type === 'text' && msg.content.startsWith('> ')) {
      flush()
      turns.push({ type: 'user', content: msg.content.slice(2) })
    } else {
      agentMsgs.push(msg)
    }
  }
  flush()
  return turns
}

// ── Line-height estimation (konservativ, verhindert Overflow) ─────────────────
function countLines(text: string, width: number): number {
  return text.split('\n').reduce((s, l) => s + Math.max(1, Math.ceil((l.length || 1) / Math.max(1, width))), 0)
}

function estimateTurnLines(turn: Turn, innerWidth: number): number {
  if (turn.type === 'user') return 2  // Zeile + Abstand

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
      return { visible: result, hiddenAbove: i + 1, hiddenBelow }
    }
    result.unshift(turns[i])
    used += h
  }
  return { visible: result, hiddenAbove: 0, hiddenBelow }
}

// ── User message block ────────────────────────────────────────────────────────
const UserBlock: React.FC<{ content: string }> = ({ content }) => (
  <Box marginBottom={1}>
    <Text color="#3B82F6">  │ </Text>
    <Text color="#E5E7EB">{content}</Text>
  </Box>
)

// ── Single message row (inside agent block) ───────────────────────────────────
const MsgRow: React.FC<{ msg: AgentMessage }> = ({ msg }) => {
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
      const label = (() => {
        switch (msg.toolCall.tool) {
          case 'run_shell':    return `Shell "${String(a.command || '').slice(0, 55)}"`
          case 'read_file':    return `Read ${a.path}`
          case 'write_file':   return `Write ${a.path}`
          case 'edit_file':    return null  // shown via DiffView in AgentBlock
          case 'list_files':   return `List "${a.path || '.'}"`
          case 'search_files': return `Search "${a.pattern}"`
          case 'git_status':   return 'git status'
          case 'git_diff':     return 'git diff'
          case 'git_commit':   return `git commit "${String(a.message || '').slice(0, 40)}"`
          default:             return msg.toolCall.tool
        }
      })()
      if (!label) return null
      return (
        <Box>
          <Text color="#374151">  * </Text>
          <Text color="#4B5563">{label}</Text>
          <Text color="#374151"> ⟳</Text>
        </Box>
      )
    }
    case 'tool_result': {
      if (!msg.toolCall) return null
      if (msg.toolCall.tool === 'edit_file') return null  // rendered as DiffView
      if (!msg.toolResult?.success) {
        return (
          <Box>
            <Text color="#EF4444">  ✗ </Text>
            <Text color="#EF4444">{(msg.toolResult?.error || '').slice(0, 70)}</Text>
          </Box>
        )
      }
      const lines = (msg.toolResult.output || '').split('\n').filter(Boolean)
      const summary = lines.length > 1 ? `${lines.length} lines` : (lines[0] || '').slice(0, 45)
      const isFile = new Set(['read_file', 'write_file']).has(msg.toolCall.tool)
      return (
        <Box>
          <Text color="#6B7280">  {isFile ? '→' : '*'} </Text>
          <Text color="#6B7280">{summary}</Text>
        </Box>
      )
    }
    case 'error':
      return <Text color="#EF4444" wrap="wrap">  ✗ {msg.content}</Text>
    case 'done': {
      let clean = msg.content
        .replace(/```json[\s\S]*?```/gi, '')              // JSON Code-Blöcke weg
        .replace(/\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, '')   // nackte JSON Tool-Calls weg
        .replace(/^DONE:\s*/i, '')
        .trim()
      return clean ? <MarkdownText content={clean} /> : null
    }
    default:
      return null
  }
}

// ── Agent turn block (blue left bar, splits on DiffViews) ─────────────────────
const AgentBlock: React.FC<{ messages: AgentMessage[]; model: string }> = ({ messages, model }) => {
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

  // Check if this block has any real visible content (not just empty dones)
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
              {sec.msgs.map(msg => <MsgRow key={msg.id} msg={msg} />)}
              {isLast && hasContent && (
                <Box marginTop={0}>
                  <Text color="#1D4ED8">■ </Text>
                  <Text color="#4B5563">Build · {model}</Text>
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
export const App: React.FC<AppProps> = ({ initialCommand, cwd }) => {
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

  const agentRef = useRef<AgentRuntime | null>(null)
  const ptyRef   = useRef<PtyManager | null>(null)

  const [termRows, setTermRows] = useState(process.stdout.rows || 24)
  const [termCols, setTermCols] = useState(process.stdout.columns || 80)

  const showSplash = messages.length === 0 && agentStatus === 'idle' && !confirm

  // Slash-command picker: filter BUILTIN_COMMANDS when input starts with /
  const slashCmds = (inputValue.startsWith('/') && agentStatus === 'idle' && !showSplash && !connectPopup && !modelPicker)
    ? BUILTIN_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(inputValue.toLowerCase())).slice(0, 7)
    : []
  const showPicker = slashCmds.length > 0

  const suggestion = !showSplash && !showPicker && !connectPopup && !modelPicker && agentStatus === 'idle'
    ? getSuggestion(inputValue, history) : ''
  const isRunning = agentStatus === 'thinking' || agentStatus === 'running'

  useEffect(() => {
    const onResize = () => { setTermRows(process.stdout.rows || 24); setTermCols(process.stdout.columns || 80) }
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize) }
  }, [])

  // Mouse wheel scroll support
  useEffect(() => {
    process.stdout.write('\x1b[?1000h\x1b[?1006h')  // enable SGR mouse tracking
    const onData = (data: Buffer) => {
      const str = data.toString()
      const m = str.match(/\x1b\[<(\d+);\d+;\d+[Mm]/)
      if (!m) return
      const btn = parseInt(m[1])
      if (btn === 64) setScrollOffset(o => o + 3)          // scroll up → older msgs
      if (btn === 65) setScrollOffset(o => Math.max(0, o - 3))  // scroll down → newer msgs
    }
    process.stdin.on('data', onData)
    return () => {
      process.stdout.write('\x1b[?1000l\x1b[?1006l')  // disable mouse tracking
      process.stdin.off('data', onData)
    }
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

  const addMsg = useCallback((msg: Omit<AgentMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, { ...msg, id: nextId(), timestamp: Date.now() }])
    setScrollOffset(0)  // auto-scroll nach unten
  }, [])

  const handleInputChange = useCallback((v: string) => {
    setInputValue(v); setHistIndex(-1); setPickerIdx(0)
  }, [])

  const handleSubmit = useCallback(async (rawInput: string) => {
    // Wenn Picker offen ist und Enter gedrückt → ausgewählten Befehl nehmen
    const slashMatches = (rawInput.startsWith('/') && agentStatus === 'idle')
      ? BUILTIN_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(rawInput.toLowerCase())).slice(0, 7)
      : []
    if (slashMatches.length > 0) {
      const sel = slashMatches[pickerIdx] ?? slashMatches[0]
      if (sel.cmd.endsWith(' ')) {
        setInputValue(sel.cmd); setPickerIdx(0); return  // Braucht noch Argument
      }
      rawInput = sel.cmd.trim()
    }

    const input = rawInput
    if (!input.trim()) return
    setInputValue(''); setHistIndex(-1); setPickerIdx(0)

    // ── /config slash command ──────────────────────────────────────────────────
    if (input.startsWith('/config') || input.toLowerCase() === '/config') {
      const rest = input.slice(7).trim()
      const [sub, ...rest2] = rest.split(/\s+/)
      const val = rest2.join(' ').trim()

      if (!sub) {
        const cfg = cm.get()
        addMsg({ type: 'command', commandTitle: 'config', content: [
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
        ].join('\n') })
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

    // ── /help  /clear  /exit slash aliases ────────────────────────────────────
    if (input === '/help')   { return handleSubmit('help') }
    if (input === '/clear')  { return handleSubmit('clear') }
    if (input === '/exit')   { return handleSubmit('exit') }
    if (input === '/models') { return handleSubmit('models') }
    if (input === '/doctor') { return handleSubmit('doctor') }

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

    switch (input.trim().toLowerCase()) {
      case 'exit': case 'quit': exit(); return
      case 'clear': setMessages([]); return
      case 'help': case '/help':
        addMsg({ type: 'command', commandTitle: 'help', content: [
          '**Verbindung**',
          '  /connect                       Server verbinden (Popup)',
          '  /model                         Model auswählen (Popup)',
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
          '  /models                        List available models',
          '  /doctor                        Check connection & status',
          '  /clear                         Clear screen',
          '  /exit                          Quit',
          '',
          '**Shell**',
          '  $ <cmd>   or   ! <cmd>         e.g.: $ npm test',
        ].join('\n') })
        break
      case 'doctor': {
        const cfg = cm.get()
        const isOllama = cfg.llm.provider === 'ollama'
        const healthy = isOllama
          ? await LLMRouter.getOllamaProvider().checkHealth(cfg.llm.baseURL)
          : await LLMRouter.getLMStudioProvider().checkHealth(cfg.llm.baseURL)
        const provName = isOllama ? 'Ollama' : 'LM Studio'
        const provHint = isOllama ? 'ollama serve' : 'LM Studio → Local Server starten'
        addMsg({ type: 'command', commandTitle: 'doctor', content: [
          `  Node.js   : ✓ ${process.version}`,
          `  Platform  : ✓ ${process.platform}`,
          `  ${provName.padEnd(9)}: ${healthy ? '✓ Reachable' : `✗ Not reachable — ${provHint}`}`,
          `  Provider  : ${cfg.llm.provider}`,
          `  Model     : ${cfg.llm.model}`,
          `  URL       : ${cfg.llm.baseURL || '(default)'}`,
          `  Config    : ${cm.getConfigPath()}`,
        ].join('\n') })
        break
      }
      case 'models': {
        const cfg = cm.get()
        const isOllama = cfg.llm.provider === 'ollama'
        const models = isOllama
          ? await LLMRouter.getOllamaProvider().listModels(cfg.llm.baseURL)
          : await LLMRouter.getLMStudioProvider().listModels(cfg.llm.baseURL)
        const provName = isOllama ? 'Ollama' : 'LM Studio'
        addMsg({ type: 'command', commandTitle: 'models', content: models.length
          ? models.map(m => `  • ${m}`).join('\n')
          : isOllama
            ? '  No Ollama models found. Pull one with: ollama pull deepseek-coder'
            : '  No LM Studio models found. Open LM Studio and load a model.' })
        break
      }
      default: {
        if (input.startsWith('$') || input.startsWith('!')) {
          ptyRef.current?.write(input.slice(1).trim() + '\n')
          break
        }

        setAgentStatus('thinking')
        setCurrentTokens('')
        setTokenCount(0)
        addMsg({ type: 'text', content: `> ${input}` })

        const agent = new AgentRuntime()
        agentRef.current = agent
        let totalTokens = 0

        agent.on('thinking', () => { setAgentStatus('thinking'); setCurrentTokens('') })
        agent.on('token', (token: string) => {
          setAgentStatus('running')
          setCurrentTokens(prev => prev + token)
          totalTokens += token.length
          setTokenCount(totalTokens)
        })
        agent.on('tool_call', ({ toolCall }: { toolCall: ToolCall }) => {
          setCurrentTokens('')
          addMsg({ type: 'tool_call', content: toolCall.tool, toolCall })
        })
        agent.on('tool_result', ({ toolCall, result }: { toolCall: ToolCall; result: ToolResult }) => {
          addMsg({ type: 'tool_result', content: '', toolCall, toolResult: result })
        })
        agent.on('confirm_required', ({ toolCall, reason, diffPreview }: { toolCall: ToolCall; reason: string; diffPreview?: DiffPreview }) => {
          setConfirm({ toolCall, reason, diffPreview })
        })
        agent.on('error', (msg: string) => { setAgentStatus('error'); addMsg({ type: 'error', content: msg }) })
        agent.on('done', ({ response, aborted }: { response: string; aborted?: boolean }) => {
          setCurrentTokens('')
          setAgentStatus('idle')
          agentRef.current = null
          if (aborted) {
            addMsg({ type: 'error', content: 'Aborted.' })
          } else if (response) {
            addMsg({ type: 'done', content: response })
          }
          // empty response = error was already shown, nothing to add
        })
        agent.run(input, cwd).catch((err: Error) => {
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
    if (connectPopup || modelPicker) {
      if (inp.ctrl && key === 'c') {
        setConnectPopup(false)
        setModelPicker(false)
      }
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
            if (sel.cmd.endsWith(' ')) {
              setInputValue(sel.cmd)  // Befehl mit Argument-Platzhalter
            } else {
              handleSubmit(sel.cmd.trim())  // Direkt ausführen
              setInputValue('')
            }
            setPickerIdx(0)
          }
          return
        }
        if (inp.escape) { setInputValue(''); setPickerIdx(0); setHistIndex(-1); return }
        return
      }

      // ── Kein Picker: normale History-Navigation ──
      if (inp.tab && suggestion) { setInputValue(inputValue + suggestion); return }
      if (inp.upArrow) {
        const next = Math.min(histIndex + 1, history.length - 1)
        setHistIndex(next); if (history[next]) setInputValue(history[next]); return
      }
      if (inp.downArrow) {
        const next = Math.max(histIndex - 1, -1)
        setHistIndex(next); setInputValue(next === -1 ? '' : history[next] || ''); return
      }
      if (inp.escape) { setInputValue(''); setHistIndex(-1); return }
    }

    if (inp.ctrl && key === 'c') {
      if (agentRef.current) {
        agentRef.current.abort(); agentRef.current = null
        setAgentStatus('idle'); setCurrentTokens('')
        addMsg({ type: 'error', content: 'Aborted.' })
      } else { exit() }
      return
    }

    if (inp.ctrl && key === 'l') { setMessages([]); return }

    if (confirm) {
      if (key === 'y' || key === 'Y') { agentRef.current?.confirm(true); setConfirm(null) }
      else if (key === 'n' || key === 'N' || inp.escape) { agentRef.current?.confirm(false); setConfirm(null) }
    }
  })

  const config = cm.get()
  const providerLabel = config.llm.provider === 'lmstudio' ? 'LM Studio' : 'Ollama'

  return (
    <Box flexDirection="column" height={termRows}>

      {showSplash ? (
        /* ── Splash: fills terminal, status bar at bottom ── */
        <>
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Splash config={config} history={history} onSubmit={handleSubmit} />
          </Box>
          <StatusBar config={config} cwd={cwd} agentStatus={agentStatus} tokenCount={tokenCount} />
        </>
      ) : (
        /* ── Chat view ── */
        <>
          {/* Spacer — drückt alles nach unten, kein overflow nötig */}
          <Box flexGrow={1} />

          {/* Nur so viele Turns rendern wie in den verfügbaren Raum passen + Scroll */}
          {(() => {
            const pickerH   = showPicker ? slashCmds.length + 3 : 0
            const streamH   = (currentTokens || isRunning) ? 2 : 0
            const confirmDiffH = confirm?.diffPreview
              ? (confirm.diffPreview.contextBefore.length + confirm.diffPreview.oldLines.length +
                 confirm.diffPreview.newLines.length + confirm.diffPreview.contextAfter.length + 4)
              : 0
            const confirmH  = confirm ? 1 + confirmDiffH : 0
            const INPUT_H   = 4
            const STATUS_H  = 1
            const SCROLL_H  = 1  // Indikator-Zeile reservieren
            const reserved  = INPUT_H + STATUS_H + pickerH + streamH + confirmH + SCROLL_H
            const available = Math.max(2, termRows - reserved)
            const innerW    = Math.max(20, termCols - 8)
            const allTurns  = groupIntoTurns(messages)
            // clamp scrollOffset
            const safeOffset = Math.min(scrollOffset, Math.max(0, allTurns.length - 1))
            const { visible, hiddenAbove, hiddenBelow } = getVisibleTurns(allTurns, available, innerW, safeOffset)

            return (
              <>
                {/* Scroll-Indikator oben */}
                {hiddenAbove > 0
                  ? <Box paddingX={2}><Text color="#374151">↑ PageUp  </Text><Text color="#4B5563">{hiddenAbove} ältere Nachrichten</Text></Box>
                  : <Text> </Text>
                }

                {visible.map((turn, i) =>
                  turn.type === 'user'
                    ? <UserBlock key={i} content={turn.content} />
                    : <AgentBlock key={i} messages={turn.messages} model={config.llm.model} />
                )}

                {/* Scroll-Indikator unten (wenn nach oben gescrollt) */}
                {hiddenBelow > 0 && (
                  <Box paddingX={2}><Text color="#374151">↓ PageDown  </Text><Text color="#4B5563">{hiddenBelow} neuere Nachrichten</Text></Box>
                )}
              </>
            )
          })()}

          {/* Live streaming block */}
          {(currentTokens || (isRunning && !currentTokens)) && (() => {
            const { thinking, response, stillThinking } = parseThinking(currentTokens)
            const cleanResponse = response
              .replace(/```json[\s\S]*?```/g, '')
              .replace(/\{[\s\S]*?"tool"\s*:/g, '')
            const lastThinkLine = thinking.trimEnd().split('\n').slice(-1)[0] ?? ''

            return (
              <Box marginBottom={1} flexDirection="column">
                {/* Thinking content */}
                {thinking && (
                  <Box marginBottom={0}>
                    <Text color="#374151">  ╰ </Text>
                    <Box flexDirection="column" flexGrow={1}>
                      <Box>
                        <Text color="#6366F1" bold>thinking  </Text>
                        <Text color="#4B5563" italic wrap="wrap">
                          {lastThinkLine.slice(0, 120)}
                        </Text>
                        {stillThinking && <ThinkingDots label="" />}
                      </Box>
                    </Box>
                  </Box>
                )}
                {/* Response / spinner */}
                <Box>
                  <Text color="#3B82F6">  │ </Text>
                  <Box flexGrow={1}>
                    {!currentTokens
                      ? <Box><Text color="#6366F1">Thinking </Text><ThinkingDots label="" /></Box>
                      : cleanResponse
                        ? <Box><Text color="#D1D5DB" wrap="wrap">{cleanResponse}</Text><Text color="#3B82F6">█</Text></Box>
                        : stillThinking
                          ? <Box><Text color="#6366F1">Thinking </Text><ThinkingDots label="" /></Box>
                          : null
                    }
                  </Box>
                </Box>
              </Box>
            )
          })()}

          {/* Confirm dialog */}
          {confirm && (
            <Box flexDirection="column" marginBottom={1}>
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
              <Box paddingX={4}>
                <Text color="#F59E0B">Erlauben? </Text>
                <Text color="#9CA3AF">{confirm.reason} </Text>
                <Text color="#22C55E">[y]</Text><Text color="#9CA3AF">/</Text><Text color="#EF4444">[n]</Text>
              </Box>
            </Box>
          )}

          {/* ── Slash-Command Picker (Discord-Stil) ── */}
          {showPicker && (
            <Box flexDirection="column" borderStyle="round" borderColor="#2D4A7A" marginX={1}>
              {slashCmds.map((cmd, i) => {
                const sel = i === pickerIdx
                const typed = inputValue.length
                return (
                  <Box key={cmd.cmd} paddingX={1}>
                    <Text color={sel ? '#3B82F6' : '#374151'}>{sel ? '▶ ' : '  '}</Text>
                    <Text color={sel ? '#93C5FD' : '#9CA3AF'} bold>{cmd.cmd.slice(0, typed)}</Text>
                    <Text color={sel ? '#60A5FA' : '#6B7280'} bold>{cmd.cmd.slice(typed).trimEnd()}</Text>
                    <Text color={sel ? '#6B7280' : '#374151'}>  {cmd.description}</Text>
                  </Box>
                )
              })}
              <Box paddingX={2} borderStyle="single" borderTop borderColor="#1E3A5F">
                <Text color="#374151">↑↓ </Text>
                <Text color="#4B5563">navigieren  </Text>
                <Text color="#374151">tab/enter </Text>
                <Text color="#4B5563">auswählen  </Text>
                <Text color="#374151">esc </Text>
                <Text color="#4B5563">schließen</Text>
              </Box>
            </Box>
          )}

          {/* ── Connect Popup ── */}
          {connectPopup && (
            <ConnectPopup
              onConnect={(provider, baseURL) => {
                cm.setLLM({ provider: provider as any, baseURL })
                setConnectPopup(false)
                addMsg({ type: 'done', content: `Verbunden · ${provider}  ${baseURL}` })
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

          {/* Input box — fixed at bottom */}
          <Box flexDirection="column" borderStyle="single" borderColor="#1E3A5F" marginX={1}>
            <Box paddingX={1}>
              <TextInput
                value={inputValue}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder=""
                focus={agentStatus === 'idle' && !confirm && !connectPopup && !modelPicker}
              />
            </Box>
            <Box paddingX={1} justifyContent="space-between">
              <Box>
                <Text color="#3B82F6" bold>Build</Text>
                <Text color="#6B7280"> · </Text>
                <Text color="#9CA3AF" bold>{config.llm.model}</Text>
                <Text color="#4B5563">  {providerLabel}</Text>
              </Box>
              <Box>
                {suggestion
                  ? <Text color="#374151">{suggestion}  </Text>
                  : null
                }
                <Text color="#4B5563">enter </Text>
                <Text color="#6B7280">send  </Text>
                <Text color="#4B5563">tab </Text>
                <Text color="#6B7280">complete</Text>
              </Box>
            </Box>
          </Box>

          {/* Status bar — 1 line */}
          <StatusBar config={config} cwd={cwd} agentStatus={agentStatus} tokenCount={tokenCount} />
        </>
      )}

    </Box>
  )
}
