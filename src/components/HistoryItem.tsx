import React, { RefObject } from 'react'
import { Box, Text, DOMElement } from 'ink'
import { AgentMessage } from '../shared/types'
import { parseThinking, countLines, fmtTime, answerText } from '../shared/utils'
import { describeTool, summarizeOutput, nicePath } from '../shared/toolText'
import { DiffView } from './DiffView'
import { MarkdownText } from './MarkdownText'
import { theme, modeColors, Mode, ICON, THREAD_BORDER } from '../shared/theme'
import { useHitbox } from '../shared/mouse'
import { mix, useGlow, useTween } from '../shared/anim'

// ── The transcript thread ────────────────────────────────────────────────────
//
//   ◆ you                                        14:02
//   │ fix the bug in add()
//   │
//   ├─ read     math.js                        6 lines
//   ├─ edit     math.js                          +1 −1
//   │   2 - return a - b
//   │   2 + return a + b
//   │
//   ● localcode                      1.1s   17.9k tokens
//   │ Fixed it.
//
// Every row starts with a thread glyph in column 0, so the line never breaks:
// knots (◆ ●) open a message, branches (├─) are tool steps, and bodies hang
// in a box whose left border is the thread itself.

/** A file change that carries a diff. */
export const isDiffResult = (m: AgentMessage) =>
  m.type === 'tool_result' &&
  (m.toolCall?.tool === 'edit_file' || m.toolCall?.tool === 'write_file') &&
  !!m.toolResult?.meta?.diffPath

export const isUserMessage = (m: AgentMessage) => m.type === 'text' && m.content.startsWith('> ')

/** A tool result that directly follows its own call. */
const isPairedResult = (m: AgentMessage, prev?: AgentMessage) =>
  m.type === 'tool_result' && prev?.type === 'tool_call' && prev.toolCall?.tool === m.toolCall?.tool

/** Messages with no visible form of their own (their partner shows them). */
export function rendersNothing(m: AgentMessage, prev?: AgentMessage, next?: AgentMessage): boolean {
  if (m.type === 'tool_call') {
    // A call whose result is a diff (or any edit) is drawn by that result.
    if (m.toolCall?.tool === 'edit_file') return true
    if (next && isPairedResult(next, m) && isDiffResult(next)) return true
    return false
  }
  if (m.type === 'tool_result') {
    // Drawn on its call's row — except diffs and edits, which have no call row.
    if (isDiffResult(m) || m.toolCall?.tool === 'edit_file') {
      return m.toolCall?.tool === 'edit_file' && !!m.toolResult?.success && !isDiffResult(m)
    }
    return isPairedResult(m, prev)
  }
  if (m.type === 'thinking') return !m.content.trim()
  if (m.type === 'done') {
    const { thinking, response } = parseThinking(m.content)
    return !response.trim() && !thinking.trim()
  }
  return false
}

const isToolRow = (m: AgentMessage) => m.type === 'tool_call' || m.type === 'tool_result'

/** A blank thread row before an entry — except between consecutive tool steps. */
export function gapBefore(msg: AgentMessage, prevShown?: AgentMessage): number {
  if (!prevShown) return 0
  if (isToolRow(msg) && (isToolRow(prevShown) || prevShown.type === 'thinking')) return 0
  if (msg.type === 'debug' || prevShown.type === 'debug') return 0
  return 1
}

export interface TranscriptItem {
  msg: AgentMessage
  /** Neighbours in the full message list (pairing). */
  prev?: AgentMessage
  next?: AgentMessage
  /** The visible entry before this one (spacing). */
  prevShown?: AgentMessage
}

/** The messages that actually draw something, with the context each needs. */
export function transcriptItems(messages: AgentMessage[]): TranscriptItem[] {
  const out: TranscriptItem[] = []
  let prevShown: AgentMessage | undefined
  messages.forEach((msg, i) => {
    const prev = messages[i - 1]
    const next = messages[i + 1]
    if (rendersNothing(msg, prev, next)) return
    out.push({ msg, prev, next, prevShown })
    prevShown = msg
  })
  return out
}

/** Rough height of an item in rows — for virtualisation only (see getItemWindow). */
export function estimateHeight(item: TranscriptItem, width: number): number {
  const { msg } = item
  const w = Math.max(10, width - 3)
  const gap = gapBefore(msg, item.prevShown)
  if (isUserMessage(msg)) return gap + 1 + countLines(msg.content.slice(2), w)
  if (isDiffResult(msg)) {
    const m = msg.toolResult!.meta!
    return gap + 1 + Math.min(200,
      (m.diffContextBefore?.length ?? 0) + (m.diffOld?.length ?? 0) +
      (m.diffNew?.length ?? 0) + (m.diffContextAfter?.length ?? 0))
  }
  switch (msg.type) {
    case 'done': {
      const { thinking, response } = parseThinking(msg.content)
      return gap + 1 + (thinking.trim() ? 1 : 0) + countLines(response.trim(), w)
    }
    case 'error': return gap + 1 + countLines(msg.content, w)
    case 'command': return gap + 1 + msg.content.split('\n').length
    case 'text': return gap + countLines(msg.content, w)
    case 'tool_call': {
      const failed = item.next && isPairedResult(item.next, msg) && !item.next.toolResult?.success
      return gap + 1 + (failed ? 1 : 0)
    }
    case 'tool_result': return gap + 1 + (msg.toolResult?.success ? 0 : 1)
    default: return gap + 1
  }
}

// ── Row primitives ───────────────────────────────────────────────────────────

/** The body of an entry: hangs off the thread (its left border). */
const Thread: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    flexDirection="column"
    borderStyle={THREAD_BORDER}
    borderTop={false}
    borderRight={false}
    borderBottom={false}
    borderColor={theme.thread}
    paddingLeft={1}
  >
    {children}
  </Box>
)

/** What a row does when clicked, said on the right while the mouse is over it. */
export type RowAction = 'open' | 'copy' | 'reuse'
const ACTION_LABEL: Record<RowAction, string> = {
  open: `open output ${ICON.enter}`,
  copy: `copy answer ${ICON.enter}`,
  reuse: `edit again ${ICON.enter}`,
}

/** How a row looks right now: under the mouse (0 to 1) and freshly added (1 to 0). */
interface Lit {
  hover: number
  glow: number
  action?: RowAction
  headRef?: RefObject<DOMElement>
}

/** "◆ you ……………… 14:02" — opens a message. */
const Knot: React.FC<{ glyph: string; color: string; label: string; right?: string; lit?: Lit }> = ({
  glyph,
  color,
  label,
  right,
  lit,
}) => {
  const hover = lit?.hover ?? 0
  const glow = lit?.glow ?? 0
  const showAction = lit?.action && hover > 0.5
  return (
    <Box ref={lit?.headRef}>
      <Box flexShrink={0}>
        <Text color={mix(color, theme.primaryPale, Math.max(glow * 0.8, hover * 0.5))}>{glyph} </Text>
        <Text color={mix(theme.textMuted, theme.textBright, Math.max(glow, hover))}>{label}</Text>
      </Box>
      <Box flexGrow={1} />
      {showAction ? (
        <Box flexShrink={0}>
          <Text color={mix(theme.textFaint, theme.primary, hover)}>{ACTION_LABEL[lit!.action!]}</Text>
        </Box>
      ) : right ? (
        <Box flexShrink={0}>
          <Text color={theme.textFaint}>{right}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

const VERB_W = 8

/** "├─ read     math.js ……… 6 lines" — one tool step, result on the right. */
const Branch: React.FC<{
  verb: string
  target: string
  summary?: React.ReactNode
  summaryColor?: string
  lit?: Lit
}> = ({ verb, target, summary, summaryColor = theme.textFaint, lit }) => {
  const hover = lit?.hover ?? 0
  const glow = lit?.glow ?? 0
  const showAction = lit?.action && hover > 0.5
  return (
    <Box ref={lit?.headRef}>
      <Box flexShrink={0}>
        <Text color={mix(theme.thread, theme.primary, Math.max(glow, hover))}>{ICON.tool} </Text>
        <Text color={mix(theme.text, theme.textBright, Math.max(glow, hover))}>{verb.padEnd(VERB_W)}</Text>
      </Box>
      <Box flexGrow={1} minWidth={0}>
        <Text color={mix(theme.textDim, theme.text, hover)} wrap="truncate-end">{target}</Text>
      </Box>
      {showAction ? (
        <Box flexShrink={0} marginLeft={2}>
          <Text color={mix(theme.textFaint, theme.primary, hover)}>{ACTION_LABEL[lit!.action!]}</Text>
        </Box>
      ) : summary ? (
        <Box flexShrink={0} marginLeft={2}>
          {typeof summary === 'string' ? <Text color={summaryColor}>{summary}</Text> : summary}
        </Box>
      ) : null}
    </Box>
  )
}

const firstLine = (s: string) => s.split('\n')[0]

/** "$ npm test" → run / npm test;  "lsp (tsc)" → lsp / (tsc) */
function commandLabel(title: string): { verb: string; target: string } {
  if (title.startsWith('$')) return { verb: 'run', target: title.slice(1).trim() }
  const [first, ...rest] = title.split(/\s+/)
  return { verb: first.toLowerCase(), target: rest.join(' ') }
}

/** "+3 −1" for a diff, in the diff colours. */
const DiffCount: React.FC<{ added: number; removed: number }> = ({ added, removed }) => (
  <Text>
    {added > 0 && <Text color={theme.success}>+{added}</Text>}
    {added > 0 && removed > 0 && <Text> </Text>}
    {removed > 0 && <Text color={theme.error}>−{removed}</Text>}
  </Text>
)

// ── Entry ─────────────────────────────────────────────────────────────────────

/** What clicking an entry's first row does, if anything. */
export function rowAction(item: TranscriptItem): RowAction | undefined {
  const { msg } = item
  if (isUserMessage(msg)) return msg.content.startsWith('> [') ? undefined : 'reuse'
  if (msg.type === 'tool_call' || msg.type === 'tool_result' || msg.type === 'command') return 'open'
  if (msg.type === 'done' && answerText(msg.content)) return 'copy'
  return undefined
}

/** Entries added this recently glow when they appear. */
const FRESH_MS = 1500

export const HistoryItem: React.FC<{
  item: TranscriptItem
  model: string
  mode: Mode
  debugMode: boolean
  width: number
  /** The first row of an entry was clicked. */
  onAction?: (action: RowAction, item: TranscriptItem) => void
}> = ({ item, mode, debugMode, width, onAction }) => {
  const gap = gapBefore(item.msg, item.prevShown)
  const action = onAction ? rowAction(item) : undefined
  const [headRef, hovered] = useHitbox({
    onClick: action ? () => onAction!(action, item) : undefined,
    disabled: !action,
  })
  const hover = useTween(hovered ? 1 : 0, 140)
  const glow = useGlow(Date.now() - item.msg.timestamp < FRESH_MS, 1100)
  const lit: Lit = { hover, glow, action, headRef }
  return (
    <Box width={width} flexDirection="column" flexShrink={0}>
      {gap > 0 && <Text color={theme.thread}>│</Text>}
      <Entry item={item} mode={mode} debugMode={debugMode} width={width} lit={lit} />
    </Box>
  )
}

const Entry: React.FC<{ item: TranscriptItem; mode: Mode; debugMode: boolean; width: number; lit: Lit }> = ({
  item,
  mode,
  debugMode,
  width,
  lit,
}) => {
  const { msg, next } = item

  if (isUserMessage(msg)) {
    return (
      <Box flexDirection="column">
        <Knot glyph={ICON.you} color={modeColors[mode].accent} label="you" right={fmtTime(msg.timestamp)} lit={lit} />
        <Thread>
          <Text color={theme.textBright}>{msg.content.slice(2)}</Text>
        </Thread>
      </Box>
    )
  }

  // File change: the branch row carries the +/− count, the diff hangs below.
  if (isDiffResult(msg)) {
    const m = msg.toolResult!.meta!
    return (
      <Box flexDirection="column">
        <Branch
          verb={m.diffIsNew ? 'create' : 'edit'}
          target={nicePath(m.diffPath)}
          summary={<DiffCount added={m.diffNew?.length ?? 0} removed={m.diffOld?.length ?? 0} />}
          lit={lit}
        />
        <Thread>
          <DiffView
            filePath={m.diffPath!}
            oldLines={m.diffOld!}
            newLines={m.diffNew!}
            startLine={m.diffStartLine!}
            contextBefore={m.diffContextBefore ?? []}
            contextAfter={m.diffContextAfter ?? []}
            isNew={m.diffIsNew}
            width={width - 2}
            bodyOnly
          />
        </Thread>
      </Box>
    )
  }

  switch (msg.type) {
    case 'tool_call': {
      const [verb, target] = describeTool(msg.toolCall!.tool, msg.toolCall!.arguments)
      const result = next && isPairedResult(next, msg) ? next.toolResult : undefined
      const failed = result && !result.success
      return (
        <Box flexDirection="column">
          <Branch
            verb={verb}
            target={target}
            summary={!result ? undefined : failed ? `${ICON.fail} failed` : summarizeOutput(result.output || '')}
            summaryColor={failed ? theme.error : theme.textFaint}
            lit={lit}
          />
          {failed && (
            <Thread>
              <Text color={theme.errorBright} wrap="truncate-end">
                {'   '}{firstLine(result!.error || 'Failed')}
              </Text>
            </Thread>
          )}
          {debugMode && (
            <Thread>
              <Text color={theme.textFaint} wrap="truncate-end">
                {'   '}{JSON.stringify(msg.toolCall!.arguments).slice(0, 300)}
              </Text>
            </Thread>
          )}
        </Box>
      )
    }

    case 'tool_result': {
      // A result without a visible call row (edits, or a lone result).
      const [verb, target] = describeTool(msg.toolCall?.tool ?? 'tool', msg.toolCall?.arguments ?? {})
      const ok = msg.toolResult?.success
      return (
        <Box flexDirection="column">
          <Branch
            verb={verb}
            target={target}
            summary={ok ? summarizeOutput(msg.toolResult?.output || '') : `${ICON.fail} failed`}
            summaryColor={ok ? theme.textFaint : theme.error}
            lit={lit}
          />
          {!ok && (
            <Thread>
              <Text color={theme.errorBright} wrap="truncate-end">
                {'   '}{firstLine(msg.toolResult?.error || 'Failed').replace(/^\w+:\s*/, '')}
              </Text>
            </Thread>
          )}
        </Box>
      )
    }

    case 'thinking':
      return (
        <Thread>
          <Text color={theme.textFaint} italic wrap="truncate-end">
            {ICON.thought} {msg.content.replace(/\s+/g, ' ').trim()}
          </Text>
        </Thread>
      )

    case 'done': {
      const { thinking } = parseThinking(msg.content)
      const answer = answerText(msg.content)
      const meta: string[] = []
      if (msg.durationMs) meta.push(`${(msg.durationMs / 1000).toFixed(1)}s`)
      // Generation speed — the number that matters most on local hardware.
      if (msg.tokensPerSec) meta.push(`${msg.tokensPerSec >= 10 ? Math.round(msg.tokensPerSec) : msg.tokensPerSec.toFixed(1)} tok/s`)
      if (msg.tokenCount) {
        const t = msg.tokenCount
        meta.push(t >= 1000 ? `${(t / 1000).toFixed(1).replace(/\.0$/, '')}k tokens` : `${t} tokens`)
      }
      return (
        <Box flexDirection="column">
          <Knot glyph={ICON.agent} color={theme.textBright} label="localcode" right={meta.join('   ')} lit={lit} />
          <Thread>
            {thinking.trim() ? (
              <Text color={theme.textFaint} italic wrap="truncate-end">
                {ICON.thought} {thinking.replace(/\s+/g, ' ').trim()}
              </Text>
            ) : null}
            {answer ? <MarkdownText content={answer} /> : null}
          </Thread>
        </Box>
      )
    }

    case 'error': {
      const isConnErr =
        msg.content.includes('ECONNREFUSED') ||
        msg.content.includes('ENOTFOUND') ||
        msg.content.includes('fetch failed') ||
        msg.content.toLowerCase().includes('not reachable')
      return (
        <Box flexDirection="column">
          <Knot glyph={ICON.fail} color={theme.error} label="error" lit={lit} />
          <Thread>
            <Text color={theme.errorBright}>{msg.content}</Text>
            {isConnErr && (
              <Text color={theme.textDim}>Check the connection with /doctor, or pick another server with /connect.</Text>
            )}
          </Thread>
        </Box>
      )
    }

    case 'command': {
      // Slash-command output is written with a two-space indent; drop it.
      // Shell output ($ …) is shown as it came: its indentation is real.
      const shell = (msg.commandTitle || '').startsWith('$')
      const lines = msg.content
        .replace(/\n+$/, '')
        .split('\n')
        .map((l) => (shell ? l : l.replace(/^ {2}/, '').replace(/\*\*/g, '')))
      return (
        <Box flexDirection="column">
          <Branch {...commandLabel(msg.commandTitle || 'output')} lit={lit} />
          <Thread>
            {lines.map((line, i) => (
              <Text key={i} color={theme.textMuted} wrap="truncate-end">{'   '}{line || ' '}</Text>
            ))}
          </Thread>
        </Box>
      )
    }

    case 'debug':
      return (
        <Thread>
          <Text color={theme.textFaint} wrap="truncate-end">{msg.content}</Text>
        </Thread>
      )

    case 'text':
    default:
      return (
        <Thread>
          <MarkdownText content={msg.content} />
        </Thread>
      )
  }
}
