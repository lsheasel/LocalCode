// Centralized design tokens.
//
// LocalCode's look: a graphite ramp carries almost everything, signal blue
// marks what is *yours to act on* (the caret, the selection, the "code" half
// of the logo), and colour beyond that always means something — green
// added, red failed/removed, brass needs your decision. Corners are square:
// frames are drawn with ┌ ┐ └ ┘, never rounded.
//
// The transcript hangs off a thin "thread" down the left edge (see
// HistoryItem); every step is a knot on it.
//
// Rule: components never write a raw hex colour. If a shade is missing here,
// add it here first and give it a name that says what it is *for*.

// ── Base palette ────────────────────────────────────────────────────────────
const BLUE = '#5FA8FF'
const BLUE_SOFT = '#A3CBFF'
const BLUE_DEEP = '#24508F'
const SEA = '#6FCDBE'
const GREEN = '#8CD39B'
const RED = '#EE7D7D'
const BRASS = '#E0B868'
const ROSE = '#EE98AE'

export const theme = {
  // ── Accent / brand ──────────────────────────────────────────────────────────
  primary: BLUE,
  primaryBright: BLUE_SOFT,
  primaryLight: BLUE_SOFT,
  primaryPale: '#DCEBFF',
  primaryDeep: BLUE_DEEP,
  primaryDim: '#1C3557',
  /** Inline code and code blocks. */
  accent: '#C9B6E8',

  // ── Text ramp (bright → faint) ──────────────────────────────────────────────
  textBright: '#ECEDEF',
  text: '#D3D5DA',
  textMuted: '#A2A7B0',
  textDim: '#7A808A',
  textFaint: '#5A606A',
  textGhost: '#43474F',
  /** Barely-there — inline autocomplete suggestion behind the caret. */
  textShadow: '#5A606A',

  // ── Semantic: success ───────────────────────────────────────────────────────
  success: GREEN,
  successBright: '#A7DDB2',
  successDim: '#4E8A5C',
  successBorder: '#3B4A3F',
  successBadgeBg: '#2E4A36',

  // ── Semantic: warning / needs a decision ────────────────────────────────────
  warn: BRASS,
  warnBadgeBg: '#4A3A1E',
  warnBadgeFg: '#F6E3BF',

  // ── Semantic: error / danger ────────────────────────────────────────────────
  error: RED,
  errorBright: '#F8AAAC',
  errorBadgeBg: '#4C2426',

  // ── Reasoning — kept in the neutral ramp so it reads as secondary ──────────
  reasoning: '#8C93A0',
  reasoningBright: '#B9BEC7',
  reasoningDim: '#3A3F48',

  // ── Violet (debug mode only) ────────────────────────────────────────────────
  violet: ROSE,
  violetDeep: '#5B4A8F',
  violetBorder: '#3F3A52',
  violetPale: '#E4DCFB',

  // ── Surfaces ────────────────────────────────────────────────────────────────
  /** Raised panel: the prompt and your messages sit on it. */
  panel: '#1C1E24',
  /** Sidebar text on the plain background. */
  sidebarTitle: '#ECEDEF',

  // ── Borders ─────────────────────────────────────────────────────────────────
  /** Default border: visible, never competing with content. */
  border: '#3A3F48',
  /** Lifted border for floating lists (slash commands, pickers). */
  borderSubtle: '#4A505A',

  // ── Diff rendering ──────────────────────────────────────────────────────────
  diffAddBg: '#1E3324',
  diffAddFg: '#B5E3BF',
  diffDelBg: '#3D2023',
  diffDelFg: '#F4B6B8',

  // ── Syntax highlighting (code blocks in answers) ───────────────────────────
  synKeyword: '#82B4FF',
  synString: '#9FD3A0',
  synNumber: '#E3BE79',
  synType: '#7FD1C4',
  synFunc: '#D2B8F0',
  synComment: '#6A707A',
  synPunct: '#8A909B',
  synPlain: '#D3D5DA',

  // ── Misc ────────────────────────────────────────────────────────────────────
  /** Marker dot in front of assistant output. */
  gutter: '#D3D5DA',
  /** The thread down the left edge of the transcript. */
  thread: '#3A3F48',
  /** Wordmark — the "local" half; "code" uses the brand blue. */
  logo: '#D3D5DA',
} as const

export type Mode = 'build' | 'plan' | 'debug'

// Per-mode colours: only the caret and the mode name in the footer use them.
export const modeColors: Record<Mode, {
  accent: string      // caret, mode name
  border: string      // prompt border
  badgeBg: string     // (kept for components that still draw a badge)
  badgeFg: string
  label: string       // mode name as shown
}> = {
  build: {
    accent: BLUE,
    border: theme.border,
    badgeBg: BLUE_DEEP,
    badgeFg: theme.primaryPale,
    label: 'build',
  },
  plan: {
    accent: SEA,
    border: theme.border,
    badgeBg: theme.successBadgeBg,
    badgeFg: theme.successBright,
    label: 'plan',
  },
  debug: {
    accent: ROSE,
    border: theme.border,
    badgeBg: theme.violetDeep,
    badgeFg: theme.violetPale,
    label: 'debug',
  },
}

// ── Spacing scale ─────────────────────────────────────────────────────────────
// Ink measures padding/margin in terminal cells, so the scale is deliberately
// tiny. Use these instead of bare numbers so indentation stays consistent.
export const space = {
  /** Horizontal padding inside a bordered panel. */
  panelX: 2,
  /** Vertical padding inside a bordered panel. */
  panelY: 1,
  /** Horizontal padding for compact rows (list items, hint bars). */
  rowX: 1,
  /** One level of nesting. */
  indent: 2,
  /** Standard gap between stacked blocks. */
  gap: 1,
} as const

// ── Border styles ─────────────────────────────────────────────────────────────
export const BORDER = {
  /** Overlays and popups. */
  panel: 'single',
  /** The prompt and dialogs. */
  inset: 'single',
} as const

/**
 * Only a bar down the left edge (opencode style). Use with
 * borderTop/Right/Bottom={false}.
 */
export const BAR_BORDER = {
  topLeft: ' ', top: ' ', topRight: ' ',
  left: '┃', right: ' ',
  bottomLeft: ' ', bottom: ' ', bottomRight: ' ',
}

/** The transcript thread: a thin line down the left edge only. */
export const THREAD_BORDER = {
  topLeft: ' ', top: ' ', topRight: ' ',
  left: '│', right: ' ',
  bottomLeft: ' ', bottom: ' ', bottomRight: ' ',
}

// ── Icons ─────────────────────────────────────────────────────────────────────
// Single source for the glyphs the UI draws, so they stay consistent and can be
// swapped for ASCII fallbacks in one place if a terminal renders them badly.
export const ICON = {
  /** One entry in the transcript: a tool run, an answer, an error. */
  bullet: '●',
  /** Marks a tool run in the transcript: a branch off the thread. */
  tool: '├─',
  /** Knot on the thread for your message. */
  you: '◆',
  /** Knot on the thread for LocalCode's answer. */
  agent: '■',
  /** Marker under a finished answer: mode, model, time. */
  answer: '▣',
  /** Hangs a result under the entry above it. */
  result: '⎿',
  selected: '❯ ',
  unselected: '  ',
  expanded: '▾',
  collapsed: '▸',
  discloseOpen: '▾ ',
  discloseClosed: '▸ ',
  ok: '✓',
  fail: '×',
  danger: '⚠',
  up: '↑',
  down: '↓',
  upDown: '↑↓',
  enter: '↵',
  /** Reasoning marker. */
  thought: '∴',
  rail: '│',
  ellipsis: '…',
  /** Block cursor shown at the end of streaming output. */
  cursor: '▌',
  caret: '❯ ',
  user: '❯ ',
  branchEnd: '└',
  branchStart: '┌',
} as const
