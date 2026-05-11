import { existsSync, statSync, readdirSync, cpSync } from 'fs'
import { copyFile, mkdir, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { createRequire } from 'module'
import * as os from 'os'
import type { ToolResult } from '../shared/types.js'

// CJS loader — plugins are always CommonJS (.js / .cjs)
const _require = createRequire(import.meta.url)

export const PLUGIN_DIR = join(os.homedir(), '.localcode', 'plugins')

// ── Public types (also used by plugin authors) ────────────────────────────────

export interface PluginContext {
  cwd: string
}

export interface PluginCommandResult {
  type: 'text' | 'error' | 'done' | 'command'
  content: string
  title?: string
}

export interface PluginCommand {
  /** Slash command, e.g. "/hello" or "/mytool " (trailing space = expects args) */
  cmd: string
  description: string
  handler: (args: string, ctx: PluginContext) => Promise<PluginCommandResult>
}

export interface PluginTool {
  /** Tool name used in agent JSON, e.g. "send_slack" */
  name: string
  /** One-line description injected into the agent system prompt */
  description: string
  handler: (args: Record<string, unknown>, ctx: PluginContext) => Promise<ToolResult>
}

export interface LocalCodePlugin {
  name: string
  version: string
  description?: string
  commands?: PluginCommand[]
  tools?: PluginTool[]
}

// ── Loader ────────────────────────────────────────────────────────────────────

export class PluginLoader {
  private static _inst: PluginLoader
  private _plugins: LocalCodePlugin[] = []
  private _errors: Array<{ file: string; error: string }> = []
  private _loaded = false

  static getInstance(): PluginLoader {
    if (!PluginLoader._inst) PluginLoader._inst = new PluginLoader()
    return PluginLoader._inst
  }

  getPluginDir(): string { return PLUGIN_DIR }

  load(): void {
    if (this._loaded) return
    this._loaded = true
    if (!existsSync(PLUGIN_DIR)) return

    let entries: string[]
    try { entries = readdirSync(PLUGIN_DIR) } catch { return }

    for (const entry of entries) {
      const entryPath = join(PLUGIN_DIR, entry)
      let mainFile: string | null = null

      try {
        if (statSync(entryPath).isDirectory()) {
          const idx    = join(entryPath, 'index.js')
          const idxCjs = join(entryPath, 'index.cjs')
          mainFile = existsSync(idx) ? idx : existsSync(idxCjs) ? idxCjs : null
        } else if (entry.endsWith('.js') || entry.endsWith('.cjs')) {
          mainFile = entryPath
        }
      } catch { continue }

      if (!mainFile) continue

      try {
        const mod = _require(mainFile)
        const plugin: LocalCodePlugin = mod.default ?? mod
        if (plugin && typeof plugin.name === 'string' && plugin.name) {
          this._plugins.push(plugin)
        } else {
          this._errors.push({ file: mainFile, error: 'Missing or invalid "name" field' })
        }
      } catch (e) {
        this._errors.push({ file: mainFile, error: String(e) })
      }
    }
  }

  reload(): void {
    for (const key of Object.keys(_require.cache ?? {})) {
      if (key.startsWith(PLUGIN_DIR)) delete (_require.cache as Record<string, unknown>)[key]
    }
    this._loaded = false
    this._plugins = []
    this._errors = []
    this.load()
  }

  getAll(): LocalCodePlugin[]   { return this._plugins }
  getErrors(): Array<{ file: string; error: string }> { return this._errors }
  getCommands(): PluginCommand[] { return this._plugins.flatMap(p => p.commands ?? []) }
  getTools(): PluginTool[]       { return this._plugins.flatMap(p => p.tools ?? []) }
  getTool(name: string): PluginTool | undefined {
    return this.getTools().find(t => t.name === name)
  }

  async install(sourcePath: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    const abs = resolve(sourcePath)
    if (!existsSync(abs)) return { ok: false, error: `Not found: ${abs}` }

    const isDir = statSync(abs).isDirectory()
    const mainFile = isDir
      ? (existsSync(join(abs, 'index.js')) ? join(abs, 'index.js') : join(abs, 'index.cjs'))
      : abs

    if (!existsSync(mainFile)) return { ok: false, error: 'No index.js / index.cjs found in directory' }

    let plugin: LocalCodePlugin
    try {
      const mod = _require(mainFile)
      plugin = mod.default ?? mod
    } catch (e) {
      return { ok: false, error: `Failed to load plugin: ${String(e)}` }
    }

    if (!plugin?.name) return { ok: false, error: 'Plugin must export a "name" field' }

    try {
      await mkdir(PLUGIN_DIR, { recursive: true })
      const dest = join(PLUGIN_DIR, plugin.name)
      if (isDir) {
        if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
        cpSync(abs, dest, { recursive: true })
      } else {
        await mkdir(dest, { recursive: true })
        await copyFile(abs, join(dest, 'index.js'))
      }
    } catch (e) {
      return { ok: false, error: `Copy failed: ${String(e)}` }
    }

    this.reload()
    return { ok: true, name: plugin.name }
  }

  async remove(name: string): Promise<{ ok: boolean; error?: string }> {
    const dir  = join(PLUGIN_DIR, name)
    const file = join(PLUGIN_DIR, `${name}.js`)

    if      (existsSync(dir))  await rm(dir,  { recursive: true, force: true })
    else if (existsSync(file)) await rm(file, { force: true })
    else return { ok: false, error: `Plugin "${name}" not found in ${PLUGIN_DIR}` }

    this.reload()
    return { ok: true }
  }
}
