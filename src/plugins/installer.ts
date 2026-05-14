import { mkdir, rm, readdir, readFile, rename, writeFile, cp } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import * as os from 'os'
import { PLUGIN_DIR, reloadPlugin } from './loader.js'
import { validateManifest } from './validator.js'
import type { ToolRegistry, CommandRegistry } from './registry.js'
import type { PluginManifest } from '../types/plugin.js'

type Source = { type: 'remote'; url: string } | { type: 'local'; path: string }

function parseSource(source: string): Source {
  if (source.startsWith('https://') || source.startsWith('http://')) return { type: 'remote', url: source }
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) {
    return { type: 'remote', url: `https://api.github.com/repos/${source}/tarball` }
  }
  return { type: 'local', path: source }
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))))
    proc.on('error', reject)
  })
}

async function findManifestDir(dir: string): Promise<string | null> {
  if (existsSync(join(dir, 'localcode.plugin.json'))) return dir
  const entries = await readdir(dir)
  for (const e of entries) {
    if (existsSync(join(dir, e, 'localcode.plugin.json'))) return join(dir, e)
  }
  return null
}

type InstallResult = { ok: boolean; name?: string; toolCount?: number; commandCount?: number; error?: string }

export async function installPlugin(
  source: string,
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
): Promise<InstallResult> {
  const src = parseSource(source)
  if (src.type === 'local') return _installLocal(src.path, registry, commandRegistry)
  return _installRemote(src.url, registry, commandRegistry)
}

async function _installLocal(
  sourcePath: string,
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
): Promise<InstallResult> {
  const abs = resolve(sourcePath)
  if (!existsSync(abs)) return { ok: false, error: `Not found: ${abs}` }

  const manifestPath = join(abs, 'localcode.plugin.json')
  if (!existsSync(manifestPath)) return { ok: false, error: 'No localcode.plugin.json found' }

  try {
    const raw = await readFile(manifestPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    const { valid, errors } = validateManifest(parsed)
    if (!valid) return { ok: false, error: `Invalid manifest: ${errors.join(', ')}` }

    const manifest = parsed as PluginManifest
    const destDir = join(PLUGIN_DIR, manifest.name)
    await mkdir(PLUGIN_DIR, { recursive: true })
    if (existsSync(destDir)) await rm(destDir, { recursive: true, force: true })
    await cp(abs, destDir, { recursive: true })

    const result = await reloadPlugin(manifest.name, registry, commandRegistry)
    if (!result.success) return { ok: false, error: result.error }
    return { ok: true, name: manifest.name, toolCount: result.toolCount, commandCount: result.commands?.length }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function _installRemote(
  url: string,
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
): Promise<InstallResult> {
  const tmpDir = join(os.tmpdir(), `localcode-plugin-${Date.now()}`)
  const tmpFile = `${tmpDir}.tar.gz`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'localcode-agent/1.0', Accept: 'application/vnd.github+json' },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    await writeFile(tmpFile, Buffer.from(await res.arrayBuffer()))
    await mkdir(tmpDir, { recursive: true })
    await runTar(['xzf', tmpFile, '-C', tmpDir, '--strip-components=1'])

    const manifestDir = await findManifestDir(tmpDir)
    if (!manifestDir) throw new Error('No localcode.plugin.json found in archive')

    const raw = await readFile(join(manifestDir, 'localcode.plugin.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    const { valid, errors } = validateManifest(parsed)
    if (!valid) throw new Error(`Invalid manifest: ${errors.join(', ')}`)

    const manifest = parsed as PluginManifest
    const destDir = join(PLUGIN_DIR, manifest.name)
    await mkdir(PLUGIN_DIR, { recursive: true })
    if (existsSync(destDir)) await rm(destDir, { recursive: true, force: true })
    await rename(manifestDir, destDir)

    const result = await reloadPlugin(manifest.name, registry, commandRegistry)
    if (!result.success) throw new Error(result.error ?? 'Load failed after install')
    return { ok: true, name: manifest.name, toolCount: result.toolCount, commandCount: result.commands?.length }
  } catch (err) {
    return { ok: false, error: String(err) }
  } finally {
    await rm(tmpFile, { force: true }).catch(() => undefined)
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function removePlugin(
  name: string,
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
): Promise<{ ok: boolean; error?: string }> {
  const dir = join(PLUGIN_DIR, name)
  if (!existsSync(dir)) return { ok: false, error: `Plugin "${name}" not found` }
  await rm(dir, { recursive: true, force: true })
  registry.removePluginTools(name)
  commandRegistry.removePluginCommands(name)
  return { ok: true }
}

export interface PluginListEntry {
  name: string
  version: string
  author: string
  description: string
  tools: string[]
  commands: string[]
  loaded: boolean
  enabled: boolean
}

export async function listInstalledPlugins(registry: ToolRegistry, disabledPlugins: string[] = []): Promise<PluginListEntry[]> {
  await mkdir(PLUGIN_DIR, { recursive: true })
  let entries: string[]
  try { entries = await readdir(PLUGIN_DIR) } catch { return [] }

  const disabledSet = new Set(disabledPlugins)
  const loadedNames = new Set(
    registry.listTools().map(t => t.pluginName).filter((n): n is string => n !== undefined),
  )

  const result: PluginListEntry[] = []
  for (const entry of entries) {
    const manifestPath = join(PLUGIN_DIR, entry, 'localcode.plugin.json')
    if (!existsSync(manifestPath)) continue
    try {
      const m = JSON.parse(await readFile(manifestPath, 'utf-8')) as PluginManifest
      result.push({
        name: m.name, version: m.version, author: m.author, description: m.description,
        tools: m.tools, commands: m.commands ?? [],
        loaded: loadedNames.has(m.name),
        enabled: !disabledSet.has(m.name),
      })
    } catch {
      result.push({
        name: entry, version: '?', author: '?', description: 'Unreadable manifest',
        tools: [], commands: [], loaded: false, enabled: !disabledSet.has(entry),
      })
    }
  }
  return result
}
