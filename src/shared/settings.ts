// Everything /settings shows, in one list: what each setting is called, what
// it does, how to read it from the config and how to change it. The panel
// (components/SettingsPanel) only draws this list.

import { AppConfig } from './types'
import type { ConfigManager } from '../config/ConfigManager'

export type SettingKind = 'toggle' | 'choice' | 'number' | 'text' | 'action'

export interface SettingDef {
  id: string
  group: string
  label: string
  /** One line: what it does. */
  hint: string
  kind: SettingKind
  /** The value as shown. */
  show(cfg: AppConfig): string
  /** toggle: is it on. */
  on?(cfg: AppConfig): boolean
  /** choice: the options, in order. */
  choices?: string[]
  /** number: step for ← →, and the range. */
  step?: number
  min?: number
  max?: number
  /** Raw value for editing (text) or stepping (number). */
  raw?(cfg: AppConfig): string | number
  /** Store a new value. */
  set?(cm: ConfigManager, value: string | number | boolean): void
}

/** The defaults for settings that may be missing from an older config file. */
export const prefs = (cfg: AppConfig) => ({
  animations: cfg.ui?.animations !== false,
  mouse: cfg.ui?.mouse !== false,
  discord: cfg.discord?.enabled === true,
  updateCheck: cfg.updates?.check !== false,
  lspAutoInstall: cfg.lsp?.autoInstall !== false,
})

const onOff = (v: boolean) => (v ? 'on' : 'off')

const DEFAULT_URL: Record<string, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
}

export const SETTINGS: SettingDef[] = [
  // ── Model ──────────────────────────────────────────────────────────────────
  {
    id: 'provider',
    group: 'Model and server',
    label: 'server',
    hint: 'Which app runs the model',
    kind: 'choice',
    choices: ['lmstudio', 'ollama'],
    show: (c) => (c.llm.provider === 'lmstudio' ? 'LM Studio' : c.llm.provider === 'ollama' ? 'Ollama' : c.llm.provider),
    raw: (c) => c.llm.provider,
    set: (cm, v) => {
      const provider = String(v) as AppConfig['llm']['provider']
      const cur = cm.get().llm
      // Switching servers also switches to that server's usual address,
      // unless the address was changed by hand.
      const wasDefault = !cur.baseURL || Object.values(DEFAULT_URL).includes(cur.baseURL)
      cm.setLLM({ provider, ...(wasDefault && DEFAULT_URL[provider] ? { baseURL: DEFAULT_URL[provider] } : {}) })
    },
  },
  {
    id: 'url',
    group: 'Model and server',
    label: 'address',
    hint: 'Where the server listens',
    kind: 'text',
    show: (c) => c.llm.baseURL || DEFAULT_URL[c.llm.provider] || '(default)',
    raw: (c) => c.llm.baseURL || DEFAULT_URL[c.llm.provider] || '',
    set: (cm, v) => cm.setLLM({ baseURL: String(v).trim() || undefined }),
  },
  {
    id: 'model',
    group: 'Model and server',
    label: 'model',
    hint: 'Enter picks one from the server',
    kind: 'action',
    show: (c) => c.llm.model,
  },
  {
    id: 'temperature',
    group: 'Model and server',
    label: 'temperature',
    hint: 'Lower is more precise, higher more creative',
    kind: 'number',
    step: 0.1,
    min: 0,
    max: 1.5,
    show: (c) => (c.llm.temperature ?? 0.1).toFixed(1),
    raw: (c) => c.llm.temperature ?? 0.1,
    set: (cm, v) => cm.setLLM({ temperature: Math.round(Number(v) * 10) / 10 }),
  },
  {
    id: 'maxTokens',
    group: 'Model and server',
    label: 'answer length',
    hint: 'Most tokens one answer may have',
    kind: 'number',
    step: 1024,
    min: 1024,
    max: 65536,
    show: (c) => `${c.llm.maxTokens ?? 8192} tokens`,
    raw: (c) => c.llm.maxTokens ?? 8192,
    set: (cm, v) => cm.setLLM({ maxTokens: Number(v) }),
  },
  {
    id: 'toolMode',
    group: 'Model and server',
    label: 'tool calls',
    hint: 'auto uses the server tool API when the model supports it',
    kind: 'choice',
    choices: ['auto', 'native', 'text'],
    show: (c) => c.llm.toolMode ?? 'auto',
    raw: (c) => c.llm.toolMode ?? 'auto',
    set: (cm, v) => cm.setLLM({ toolMode: String(v) as 'auto' | 'native' | 'text' }),
  },

  // ── Agent ──────────────────────────────────────────────────────────────────
  {
    id: 'lspAutoInstall',
    group: 'Agent',
    label: 'install language servers',
    hint: 'Fetch a missing language server the first time it is needed',
    kind: 'toggle',
    on: (c) => prefs(c).lspAutoInstall,
    show: (c) => onOff(prefs(c).lspAutoInstall),
    set: (cm, v) => cm.set({ lsp: { ...cm.get().lsp, autoInstall: Boolean(v) } }),
  },
  {
    id: 'dangerous',
    group: 'Agent',
    label: 'dangerous commands',
    hint: 'rm -rf, force push and the like: ask first, or allow',
    kind: 'choice',
    choices: ['ask', 'allow'],
    show: (c) => (c.security?.allowDangerousCommands ? 'allow' : 'ask'),
    raw: (c) => (c.security?.allowDangerousCommands ? 'allow' : 'ask'),
    set: (cm, v) => cm.set({ security: { ...cm.get().security, allowDangerousCommands: v === 'allow' } }),
  },
  {
    id: 'trusted',
    group: 'Agent',
    label: 'trusted folders',
    hint: 'File changes there need no approval. Enter lists them',
    kind: 'action',
    show: (c) => {
      const n = (c.trustedPaths ?? []).length
      return n === 0 ? 'none' : `${n} folder${n === 1 ? '' : 's'}`
    },
  },
  {
    id: 'rules',
    group: 'Agent',
    label: 'project rules',
    hint: 'LOCALCODE.md, sent with every task. Enter creates or shows it',
    kind: 'action',
    show: () => '/init',
  },

  // ── Interface ──────────────────────────────────────────────────────────────
  {
    id: 'animations',
    group: 'Interface',
    label: 'animations',
    hint: 'Fades, glows and smooth scrolling',
    kind: 'toggle',
    on: (c) => prefs(c).animations,
    show: (c) => onOff(prefs(c).animations),
    set: (cm, v) => cm.set({ ui: { ...cm.get().ui, animations: Boolean(v) } }),
  },
  {
    id: 'mouse',
    group: 'Interface',
    label: 'mouse',
    hint: 'Hover, clicks and drag to copy. Off: the terminal selects text',
    kind: 'toggle',
    on: (c) => prefs(c).mouse,
    show: (c) => onOff(prefs(c).mouse),
    set: (cm, v) => cm.set({ ui: { ...cm.get().ui, mouse: Boolean(v) } }),
  },
  {
    id: 'updateCheck',
    group: 'Interface',
    label: 'update check',
    hint: 'Look for a new version at start',
    kind: 'toggle',
    on: (c) => prefs(c).updateCheck,
    show: (c) => onOff(prefs(c).updateCheck),
    set: (cm, v) => cm.set({ updates: { ...cm.get().updates, check: Boolean(v) } }),
  },

  // ── Integrations ───────────────────────────────────────────────────────────
  {
    id: 'discord',
    group: 'Integrations',
    label: 'discord status',
    hint: 'Show "Running agent" and the folder in your Discord profile',
    kind: 'toggle',
    on: (c) => prefs(c).discord,
    show: (c) => onOff(prefs(c).discord),
    set: (cm, v) => cm.set({ discord: { ...cm.get().discord, enabled: Boolean(v) } }),
  },
]

/** The value after `value` in a choice, wrapping around (dir -1: before). */
export function nextChoice(def: SettingDef, value: string, dir = 1): string {
  const list = def.choices ?? []
  const i = list.indexOf(value)
  return list[(i + dir + list.length) % list.length] ?? list[0]
}

/** A number setting moved one step, kept inside its range. */
export function stepNumber(def: SettingDef, value: number, dir: number): number {
  const next = value + dir * (def.step ?? 1)
  return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, next))
}
