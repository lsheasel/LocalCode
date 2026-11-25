import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, extname } from 'path'
import { pathToFileURL, fileURLToPath } from 'url'
import { LspClient } from './LspClient.js'
import { findServer, installServer, serverLabel } from './installer'
import { ConfigManager } from '../config/ConfigManager'

interface ServerDef {
  name: string
  command: string
  args: string[]
  extensions: string[]
  languageId: string
}

const SERVER_DEFS: ServerDef[] = [
  { name: 'typescript', command: 'typescript-language-server', args: ['--stdio'], extensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'], languageId: 'typescript' },
  { name: 'rust-analyzer', command: 'rust-analyzer', args: [], extensions: ['.rs'], languageId: 'rust' },
  { name: 'gopls', command: 'gopls', args: ['serve'], extensions: ['.go'], languageId: 'go' },
  { name: 'pylsp', command: 'pylsp', args: [], extensions: ['.py'], languageId: 'python' },
  { name: 'clangd', command: 'clangd', args: ['--stdio'], extensions: ['.c', '.cc', '.cpp', '.h', '.hpp', '.cxx'], languageId: 'cpp' },
]

function defForExt(ext: string): ServerDef | null {
  return SERVER_DEFS.find(d => d.extensions.includes(ext)) ?? null
}

export class LspManager {
  private static _instance: LspManager
  private clients = new Map<string, LspClient>()

  static getInstance(): LspManager {
    if (!LspManager._instance) LspManager._instance = new LspManager()
    return LspManager._instance
  }

  private key(serverName: string, workDir: string): string {
    return `${serverName}::${workDir}`
  }

  private async getOrStart(absFilePath: string, workDir: string): Promise<{ client: LspClient; def: ServerDef } | null> {
    const ext = extname(absFilePath).toLowerCase()
    const def = defForExt(ext)
    if (!def) {
      this.lastProblem = `LocalCode has no language server for ${ext || 'these'} files.`
      return null
    }
    this.lastProblem = ''

    const k = this.key(def.name, workDir)
    const existing = this.clients.get(k)
    if (existing?.isRunning) return { client: existing, def }
    if (existing) this.clients.delete(k)

    // The installed server, or one installed now (settings: agent →
    // install language servers).
    let found = await findServer(def.name, workDir)
    if (!found && ConfigManager.getInstance().get().lsp?.autoInstall !== false) {
      found = await installServer(def.name, workDir)
    }
    if (!found) {
      this.lastProblem = `No ${serverLabel(def.name)} for ${ext} files. /lsp install ${def.name} installs it.`
      return null
    }

    const client = new LspClient(found.command, [...found.args, ...def.args], workDir, def.name, found.initOptions)
    try {
      await client.start()
      this.clients.set(k, client)
      this.lastProblem = ''
      return { client, def }
    } catch (e) {
      this.lastProblem = `${serverLabel(def.name)} did not start: ${(e as Error).message}`
      return null
    }
  }

  /** Why the last hover / definition had no server, for the error message. */
  lastProblem = ''

  async hover(
    filePath: string,
    line: number,
    col: number,
    workDir: string,
  ): Promise<{ text: string; server: string } | null> {
    const absPath = resolve(workDir, filePath)
    if (!existsSync(absPath)) return null

    const got = await this.getOrStart(absPath, workDir)
    if (!got) return null
    const { client, def } = got

    let text: string
    try { text = await readFile(absPath, 'utf-8') } catch { return null }

    const uri = pathToFileURL(absPath).toString()
    await client.openDocument(uri, def.languageId, text)

    const result = await client.hover(uri, line - 1, col - 1)
    if (!result?.trim()) return null
    return { text: result.trim(), server: client.serverName }
  }

  async definition(
    filePath: string,
    line: number,
    col: number,
    workDir: string,
  ): Promise<{ targetFile: string; targetLine: number; server: string } | null> {
    const absPath = resolve(workDir, filePath)
    if (!existsSync(absPath)) return null

    const got = await this.getOrStart(absPath, workDir)
    if (!got) return null
    const { client, def } = got

    let text: string
    try { text = await readFile(absPath, 'utf-8') } catch { return null }

    const uri = pathToFileURL(absPath).toString()
    await client.openDocument(uri, def.languageId, text)

    const locs = await client.definition(uri, line - 1, col - 1)
    if (!locs?.length) return null

    const loc = locs[0]
    return {
      targetFile: fileURLToPath(loc.uri),
      targetLine: loc.range.start.line + 1,
      server: client.serverName,
    }
  }

  /** List which LSP servers are currently active */
  activeServers(): string[] {
    return [...this.clients.entries()]
      .filter(([, c]) => c.isRunning)
      .map(([k]) => k.split('::')[0])
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map(c => c.shutdown()))
    this.clients.clear()
  }
}
