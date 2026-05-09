import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AppConfig, LLMConfig } from '../shared/types'
import { DEFAULT_CONFIG } from '../shared/constants'

const CONFIG_DIR = path.join(os.homedir(), '.localcode')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json')

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
}
