import React from 'react'
import { Box, Text } from 'ink'
import { relative, isAbsolute } from 'path'
import { AgentMessage } from '../shared/types'
import { theme, modeColors, Mode, THREAD_BORDER } from '../shared/theme'
import { truncEnd, truncStart, wrapText, formatTokens } from '../shared/utils'
import { getAppVersion } from '../shared/version'
import { useTween } from '../shared/anim'

/** Files the agent changed this session, with lines added / removed. */
export function modifiedFiles(messages: AgentMessage[]): Array<{ path: string; added: number; removed: number }> {
  const byPath = new Map<string, { added: number; removed: number }>()
  for (const m of messages) {
    const meta = m.toolResult?.meta
    if (m.type !== 'tool_result' || !m.toolResult?.success || !meta?.diffPath) continue
    const cur = byPath.get(meta.diffPath) ?? { added: 0, removed: 0 }
    cur.added += meta.diffNew?.length ?? 0
    cur.removed += meta.diffOld?.length ?? 0
    byPath.set(meta.diffPath, cur)
  }
  return [...byPath].map(([p, c]) => {
    const rel = isAbsolute(p) ? relative(process.cwd(), p) : p
    const shown = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : p
    return { path: shown.replace(/\\/g, '/'), ...c }
  })
}

/** "label ········· value" — a spec-sheet row filling `width`. */
const Leader: React.FC<{ label: string; value: string; width: number; valueColor?: string }> = ({
  label,
  value,
  width,
  valueColor = theme.textMuted,
}) => {
  const v = truncEnd(value, Math.max(4, width - label.length - 3))
  const dots = Math.max(1, width - label.length - v.length - 2)
  return (
    <Text>
      <Text color={theme.textDim}>{label} </Text>
      <Text color={theme.textGhost}>{'·'.repeat(dots)}</Text>
      <Text color={valueColor}> {v}</Text>
    </Text>
  )
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/**
 * "██████▍─────────  31%": how full the context window is. The bar is drawn
 * in eighths of a cell and grows smoothly when a request adds to it.
 */
const ContextBar: React.FC<{ share: number; width: number; color: string }> = ({ share, width, color }) => {
  const shown = useTween(share, 600)
  const pct = `${Math.round(share * 100)}%`
  const cells = Math.max(4, width - pct.length - 2)
  const eighths = Math.round(Math.min(1, shown) * cells * 8)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8]
  const rest = cells - full - (part ? 1 : 0)
  return (
    <Text>
      <Text color={color === theme.textMuted ? theme.primary : color}>{'█'.repeat(full)}{part}</Text>
      <Text color={theme.textGhost}>{'─'.repeat(Math.max(0, rest))}</Text>
      <Text color={theme.textFaint}>  {pct}</Text>
    </Text>
  )
}

interface Props {
  width: number
  height: number
  messages: AgentMessage[]
  /** Tokens the last request used. */
  contextTokens: number
  /** The model's context window, if the server reports it. */
  contextLimit: number | null
  model: string
  provider: string
  mode: Mode
  /** Native tool calling (true), text mode (false), not known yet (null). */
  nativeTools: boolean | null
  /** Instruction files sent with each task. */
  rules: string[]
}

/**
 * The session sheet on the right of wide terminals: what this session is
 * about, then its vital numbers as a spec sheet, then what it changed.
 */
export const Sidebar: React.FC<Props> = ({ width, height, messages, contextTokens, contextLimit, model, provider, mode, nativeTools, rules }) => {
  const inner = width - 4 // rule + padding
  const firstPrompt = messages.find((m) => m.type === 'text' && m.content.startsWith('> '))
  const title = firstPrompt ? firstPrompt.content.slice(2).trim() : 'New session'
  const wrapped = wrapText(title, inner)
  const titleLines = wrapped.slice(0, 3)
  if (wrapped.length > 3) titleLines[2] = truncEnd(titleLines[2] + ' …', inner)
  const files = modifiedFiles(messages)
  const share = contextLimit && contextTokens ? Math.min(1, contextTokens / contextLimit) : null
  const contextText = contextLimit
    ? `${formatTokens(contextTokens)} / ${formatTokens(contextLimit)}`
    : contextTokens ? formatTokens(contextTokens) : '—'
  const contextColor =
    share === null ? theme.textMuted
    : share >= 0.95 ? theme.error
    : share >= 0.8 ? theme.warn
    : theme.textMuted
  const steps = messages.filter((m) => m.type === 'tool_call').length

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
      flexShrink={0}
      overflow="hidden"
      borderStyle={THREAD_BORDER}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderColor={theme.thread}
    >
      <Text color={theme.textFaint}>session</Text>
      {titleLines.map((l, i) => (
        <Text key={i} color={theme.textBright}>{l}</Text>
      ))}

      <Box flexDirection="column" marginTop={1}>
        <Leader label="mode" value={modeColors[mode].label} width={inner} valueColor={modeColors[mode].accent} />
        <Leader label="model" value={model} width={inner} />
        <Leader label="runs on" value={provider.toLowerCase()} width={inner} />
        <Leader
          label="tools"
          value={nativeTools === null ? '…' : nativeTools ? 'native' : 'text'}
          width={inner}
        />
        <Leader
          label="rules"
          value={rules.length ? rules.map((r) => r.replace(/^~\/\.localcode\//, '~/')).join(', ') : 'none · /init'}
          width={inner}
          valueColor={rules.length ? theme.textMuted : theme.textFaint}
        />
        <Leader label="steps" value={String(steps)} width={inner} />
        <Leader label="context" value={contextText} width={inner} valueColor={contextColor} />
        {share !== null && <ContextBar share={share} width={inner} color={contextColor} />}
      </Box>

      {files.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.textFaint}>changed</Text>
          {files.slice(0, 12).map((f) => {
            const counts = `${f.added ? ` +${f.added}` : ''}${f.removed ? ` −${f.removed}` : ''}`
            return (
              <Box key={f.path}>
                <Box flexGrow={1} minWidth={0}>
                  <Text color={theme.textMuted}>{truncStart(f.path, inner - counts.length - 1)}</Text>
                </Box>
                <Box flexShrink={0}>
                  {f.added > 0 && <Text color={theme.success}> +{f.added}</Text>}
                  {f.removed > 0 && <Text color={theme.error}> −{f.removed}</Text>}
                </Box>
              </Box>
            )
          })}
          {files.length > 12 && <Text color={theme.textFaint}>and {files.length - 12} more</Text>}
        </Box>
      )}

      <Box flexGrow={1} />
      <Text>
        <Text color={theme.textBright}>local</Text>
        <Text color={theme.primary}>code</Text>
        <Text color={theme.textGhost}>  {getAppVersion()}</Text>
      </Text>
    </Box>
  )
}
