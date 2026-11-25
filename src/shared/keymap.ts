// Single source of truth for keyboard control.
//
// Two things live here:
//   1. resolveUiMode() — decides which *one* mode owns the keyboard right now.
//      Previously app.tsx inferred this from ad-hoc boolean combinations, which
//      let two handlers claim the same key (e.g. `esc` cleared the input before
//      the confirm dialog ever saw it). Modes are now exclusive and ordered.
//   2. HELP_GROUPS / footerHints() — what we tell the user they can press.
//      Footer labels stay terse so the hint row never wraps; `?` shows the full
//      list.

import { Mode } from './theme'

/** Exactly one of these owns the keyboard at any moment. */
export type UiMode =
  | 'popup'    // ConnectPopup / ModelPicker / FilePicker (they handle their own input)
  | 'help'     // ? overlay
  | 'info'     // /help, /doctor etc. output panel
  | 'confirm'  // tool-approval dialog
  | 'picker'   // slash-command picker open
  | 'chat'     // normal editing

/** The flags app.tsx already tracks, in priority order of resolution. */
export interface UiModeFlags {
  popupOpen: boolean
  helpOpen: boolean
  infoOpen: boolean
  confirmOpen: boolean
  pickerOpen: boolean
}

/**
 * Resolve which mode owns the keyboard. Order matters: the first match wins,
 * so every keypress lands in exactly one handler.
 */
export function resolveUiMode(f: UiModeFlags): UiMode {
  if (f.popupOpen) return 'popup'
  if (f.helpOpen) return 'help'
  if (f.infoOpen) return 'info'
  if (f.confirmOpen) return 'confirm'
  if (f.pickerOpen) return 'picker'
  return 'chat'
}

export interface Hint {
  keys: string
  label: string
}

export interface HintGroup {
  title: string
  hints: Hint[]
}

/** The full reference, shown in the `?` overlay. */
export const HELP_GROUPS: HintGroup[] = [
  {
    title: 'Prompt',
    hints: [
      { keys: '↵', label: 'send message' },
      { keys: 'alt+↵ / ctrl+j', label: 'new line' },
      { keys: '↵', label: 'add a message while the agent is running' },
      { keys: 'tab', label: 'accept completion, or cycle mode' },
      { keys: 'shift+tab', label: 'cycle mode backwards' },
      { keys: '↑ ↓', label: 'previous / next prompt from history' },
      { keys: 'esc', label: 'clear the input' },
      { keys: 'ctrl+k', label: 'clear the input' },
      { keys: 'ctrl+w / ctrl+u', label: 'delete word / to line start' },
    ],
  },
  {
    title: 'Attach & commands',
    hints: [
      { keys: 'ctrl+p', label: 'palette: commands, models, sessions, files' },
      { keys: '/', label: 'open the slash-command picker' },
      { keys: '@', label: 'attach a file from the working directory' },
      { keys: 'tab', label: 'select the highlighted command' },
      { keys: 'esc', label: 'dismiss the picker' },
    ],
  },
  {
    title: 'Reading output',
    hints: [
      { keys: 'wheel', label: 'scroll the conversation' },
      { keys: 'PgUp / PgDn', label: 'scroll a page' },
      { keys: 'esc', label: 'back to the latest message' },
      { keys: 'drag', label: 'select text, copied when you let go' },
      { keys: 'click', label: 'open a step, copy an answer, edit a message' },
      { keys: 'ctrl+o', label: 'show the full reasoning of the last answer' },
      { keys: 'ctrl+b', label: 'show the full tool output of the last task' },
    ],
  },
  {
    title: 'Approvals',
    hints: [
      { keys: 'y', label: 'allow this one action' },
      { keys: 't', label: 'trust this folder for the session' },
      { keys: 'n / esc', label: 'deny' },
    ],
  },
  {
    title: 'Session',
    hints: [
      { keys: '?', label: 'toggle this help' },
      { keys: '/settings', label: 'all settings in one place' },
      { keys: '/copy', label: 'copy the last answer' },
      { keys: '/undo', label: 'revert the last file change (/undo all: the task)' },
      { keys: 'ctrl+l', label: 'clear the screen and the transcript' },
      { keys: 'ctrl+c', label: 'abort the agent, or quit when idle' },
    ],
  },
]

export interface FooterContext {
  uiMode: UiMode
  agentMode: Mode
  isRunning: boolean
  /** An inline autocomplete suggestion is showing, so tab completes it. */
  hasSuggestion: boolean
  /** There is at least one tool result worth opening. */
  hasToolResults: boolean
  /** The last answers carry reasoning that ctrl+o can show. */
  hasReasoning?: boolean
  /** Share of the model's context window the conversation uses (0–1). */
  contextShare?: number
}

const NEXT_MODE: Record<Mode, string> = {
  build: 'plan mode',
  plan: 'debug mode',
  debug: 'build mode',
}

/**
 * The short, context-specific hints for the bar under the input. Keep these
 * few and short — the full list lives in the `?` overlay.
 */
export function footerHints(ctx: FooterContext): Hint[] {
  switch (ctx.uiMode) {
    case 'popup':
      return [
        { keys: '↑↓', label: 'select' },
        { keys: 'enter', label: 'choose' },
        { keys: 'esc', label: 'close' },
      ]

    case 'help':
      return [{ keys: 'esc', label: 'close' }]

    case 'info':
      return [
        { keys: '↑↓', label: 'scroll' },
        { keys: 'esc', label: 'close' },
      ]

    case 'confirm':
      // The choices are written into the approval frame itself.
      return [{ keys: 'ctrl+c', label: 'stop' }]

    case 'picker':
      return [
        { keys: 'enter', label: 'run' },
        { keys: 'tab', label: 'complete' },
        { keys: 'esc', label: 'close' },
      ]

    case 'chat':
    default: {
      if (ctx.isRunning) {
        return [
          { keys: 'ctrl+c', label: 'stop' },
          { keys: 'enter', label: 'add a message' },
        ]
      }
      const hints: Hint[] = []
      // Close to the context limit, the way out comes first.
      if (ctx.contextShare !== undefined && ctx.contextShare >= 0.8) {
        hints.push({ keys: '/compact', label: `context ${Math.round(ctx.contextShare * 100)}% full` })
      }
      if (ctx.hasSuggestion) hints.push({ keys: 'tab', label: 'complete' })
      hints.push({ keys: '?', label: 'shortcuts' })
      hints.push({ keys: 'ctrl+p', label: 'palette' })
      if (ctx.hasReasoning) hints.push({ keys: 'ctrl+o', label: 'reasoning' })
      if (ctx.hasToolResults) hints.push({ keys: 'ctrl+b', label: 'tool output' })
      if (!ctx.hasSuggestion) hints.push({ keys: 'tab', label: NEXT_MODE[ctx.agentMode] })
      return hints
    }
  }
}
