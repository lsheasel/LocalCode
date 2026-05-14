/**
 * Plugin format — index.js (CommonJS):
 *
 *   module.exports = {
 *     register(registry) {
 *       registry.addTool({
 *         name: 'my_tool',
 *         description: 'Does something useful',
 *         parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
 *         execute: async ({ path }) => `result: ${path}`
 *       })
 *       registry.addCommand({
 *         cmd: '/mytool',
 *         description: 'Run my tool manually',
 *         handler: async (args, ctx) => ({ type: 'done', content: `ran in ${ctx.cwd}` })
 *       })
 *     }
 *   }
 */
import { readdir, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import * as os from 'os'
import { createRequire } from 'module'
import { validateManifest } from './validator.js'
import { ConfigManager } from '../config/ConfigManager.js'
import type { ToolRegistry, CommandRegistry } from './registry.js'
import type { ToolDefinition, PluginCommand, PluginManifest, PluginLoadResult } from '../types/plugin.js'

export const PLUGIN_DIR = join(os.homedir(), '.localcode', 'plugins')

const _require = createRequire(import.meta.url)

interface RegistryAPI {
  addTool(tool: Omit<ToolDefinition, 'pluginName'>): void
  addCommand(cmd: PluginCommand): void
}

interface PluginModule {
  register(registry: RegistryAPI): void
}

export async function loadPlugins(
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
): Promise<PluginLoadResult[]> {
  await mkdir(PLUGIN_DIR, { recursive: true })
  let entries: string[]
  try { entries = await readdir(PLUGIN_DIR) } catch { return [] }

  const disabled = new Set(ConfigManager.getInstance().listDisabledPlugins())
  const results: PluginLoadResult[] = []
  for (const entry of entries) {
    if (disabled.has(entry)) continue
    const result = await _loadOne(entry, registry, commandRegistry)
    if (result) results.push(result)
  }
  return results
}

export async function reloadPlugin(
  name: string,
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
): Promise<PluginLoadResult> {
  registry.removePluginTools(name)
  commandRegistry.removePluginCommands(name)
  if (ConfigManager.getInstance().isPluginDisabled(name)) {
    return { name, success: false, error: 'Plugin is disabled' }
  }
  const pluginPath = join(PLUGIN_DIR, name)
  for (const key of Object.keys(_require.cache ?? {})) {
    if (key.startsWith(pluginPath)) delete (_require.cache as Record<string, unknown>)[key]
  }
  return (await _loadOne(name, registry, commandRegistry))
    ?? { name, success: false, error: 'Plugin directory not found' }
}

async function _loadOne(
  entry: string,
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
): Promise<PluginLoadResult | null> {
  const pluginPath = join(PLUGIN_DIR, entry)
  const manifestPath = join(pluginPath, 'localcode.plugin.json')
  const indexPath = join(pluginPath, 'index.js')

  let manifest: PluginManifest
  try {
    const raw = await readFile(manifestPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    const { valid, errors } = validateManifest(parsed)
    if (!valid) {
      console.warn(`[plugins] Skipping "${entry}": ${errors.join(', ')}`)
      return { name: entry, success: false, error: errors.join(', ') }
    }
    manifest = parsed as PluginManifest
  } catch {
    return null
  }

  let mod: unknown
  try {
    mod = _require(indexPath)
  } catch (err) {
    console.warn(`[plugins] Failed to load "${manifest.name}": ${String(err)}`)
    return { name: manifest.name, success: false, error: String(err) }
  }

  if (
    typeof mod !== 'object' || mod === null ||
    typeof (mod as Record<string, unknown>).register !== 'function'
  ) {
    const msg = 'index.js must export { register(registry) }'
    console.warn(`[plugins] Skipping "${manifest.name}": ${msg}`)
    return { name: manifest.name, success: false, error: msg }
  }

  const registeredCommands: PluginCommand[] = []
  const api: RegistryAPI = {
    addTool: (tool) => registry.addTool({ ...tool, pluginName: manifest.name }),
    addCommand: (cmd) => {
      commandRegistry.addCommand(cmd, manifest.name)
      registeredCommands.push(cmd)
    },
  }

  try {
    (mod as PluginModule).register(api)
    return {
      name: manifest.name,
      success: true,
      toolCount: manifest.tools.length,
      commands: registeredCommands.length > 0 ? registeredCommands : undefined,
    }
  } catch (err) {
    console.warn(`[plugins] register() threw in "${manifest.name}": ${String(err)}`)
    return { name: manifest.name, success: false, error: String(err) }
  }
}
