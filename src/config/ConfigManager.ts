import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AppConfig, LLMConfig, AgentMessage } from '../shared/types'
import { DEFAULT_CONFIG } from '../shared/constants'

const CONFIG_DIR    = path.join(os.homedir(), '.localcode')
const CONFIG_FILE   = path.join(CONFIG_DIR, 'config.json')
const HISTORY_FILE  = path.join(CONFIG_DIR, 'history.json')
const SESSIONS_DIR  = path.join(CONFIG_DIR, 'sessions')

export class ConfigManager {
  private static instance: ConfigManager
  private config: AppConfig

  private constructor() {
    this.config = this.load()
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager()
    }
    return ConfigManager.instance
  }

  private load(): AppConfig {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true })
      }
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
      }
    } catch {}
    return { ...DEFAULT_CONFIG }
  }

  get(): AppConfig {
    return this.config
  }

  set(updates: Partial<AppConfig>): void {
    this.config = { ...this.config, ...updates }
    this.save()
  }

  setLLM(updates: Partial<LLMConfig>): void {
    this.config.llm = { ...this.config.llm, ...updates }
    this.save()
  }

  private save(): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true })
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch {}
  }

  getHistory(): string[] {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
      }
    } catch {}
    return []
  }

  addHistory(command: string): void {
    try {
      const history = this.getHistory()
      const updated = [command, ...history.filter(h => h !== command)].slice(0, 500)
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(updated), 'utf-8')
    } catch {}
  }

  getConfigPath(): string {
    return CONFIG_FILE
  }

  // ── Session management ───────────────────────────────────────────────────────

  private ensureSessions(): void {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  }

  listSessions(): string[] {
    try {
      this.ensureSessions()
      return fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -5))
        .sort()
    } catch { return [] }
  }

  saveSession(name: string, messages: AgentMessage[]): void {
    try {
      this.ensureSessions()
      const file = path.join(SESSIONS_DIR, `${name}.json`)
      fs.writeFileSync(file, JSON.stringify(messages, null, 2), 'utf-8')
    } catch {}
  }

  loadSession(name: string): AgentMessage[] | null {
    try {
      const file = path.join(SESSIONS_DIR, `${name}.json`)
      if (!fs.existsSync(file)) return null
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentMessage[]
    } catch { return null }
  }

  // ── Trusted paths ────────────────────────────────────────────────────────────

  /** Returns true when targetPath is inside (or equal to) a trusted path. */
  isTrusted(targetPath: string): boolean {
    const norm = path.resolve(targetPath).replace(/\\/g, '/')
    return (this.config.trustedPaths ?? []).some(t => {
      const tp = path.resolve(t).replace(/\\/g, '/')
      return norm === tp || norm.startsWith(tp + '/')
    })
  }

  trustPath(p: string): void {
    const norm = path.resolve(p)
    const list = this.config.trustedPaths ?? []
    if (!list.includes(norm)) {
      this.config.trustedPaths = [...list, norm]
      this.save()
    }
  }

  untrustPath(p: string): void {
    const norm = path.resolve(p)
    this.config.trustedPaths = (this.config.trustedPaths ?? []).filter(t => path.resolve(t) !== norm)
    this.save()
  }

  listTrusted(): string[] {
    return this.config.trustedPaths ?? []
  }

  deleteSession(name: string): void {
    try {
      const file = path.join(SESSIONS_DIR, `${name}.json`)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch {}
  }
}
