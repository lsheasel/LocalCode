import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { pathToFileURL } from 'url'

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspLocation { uri: string; range: LspRange }

type PendingRequest = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export class LspClient extends EventEmitter {
  private proc: ChildProcess | null = null
  private buffer = ''
  private reqId = 1
  private pending = new Map<number, PendingRequest>()
  private _initialized = false
  private openedDocs = new Set<string>()
  public readonly serverName: string

  constructor(
    private readonly command: string,
    private readonly spawnArgs: string[],
    private readonly workDir: string,
    name: string,
  ) {
    super()
    this.serverName = name
  }

  async start(): Promise<void> {
    this.proc = spawn(this.command, this.spawnArgs, {
      cwd: this.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      this.drain()
    })
    this.proc.stderr!.on('data', () => {})
    this.proc.on('exit', () => {
      this.proc = null
      this._initialized = false
      for (const p of this.pending.values()) p.reject(new Error('LSP server exited'))
      this.pending.clear()
    })

    await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(this.workDir).toString(),
      capabilities: {
        textDocument: {
          hover: { contentFormat: ['plaintext', 'markdown'] },
          definition: {},
          publishDiagnostics: {},
        },
      },
      initializationOptions: {},
    })
    this.notify('initialized', {})
    this._initialized = true
  }

  private drain(): void {
    while (true) {
      const sep = this.buffer.indexOf('\r\n\r\n')
      if (sep === -1) break
      const header = this.buffer.slice(0, sep)
      const m = header.match(/Content-Length:\s*(\d+)/i)
      if (!m) { this.buffer = this.buffer.slice(sep + 4); continue }
      const bodyLen = parseInt(m[1], 10)
      const bodyStart = sep + 4
      if (this.buffer.length < bodyStart + bodyLen) break
      const body = this.buffer.slice(bodyStart, bodyStart + bodyLen)
      this.buffer = this.buffer.slice(bodyStart + bodyLen)
      try { this.dispatch(JSON.parse(body)) } catch {}
    }
  }

  private dispatch(msg: any): void {
    if ('id' in msg && msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'LSP error'))
      else p.resolve(msg.result)
    } else if (msg.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', msg.params)
    }
  }

  private send(msg: object): void {
    if (!this.proc?.stdin?.writable) return
    const body = JSON.stringify(msg)
    const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
    this.proc.stdin.write(frame)
  }

  private request(method: string, params: unknown, timeoutMs = 12000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.reqId++
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`LSP timeout: ${method}`))
        }
      }, timeoutMs)
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async openDocument(uri: string, languageId: string, text: string): Promise<void> {
    if (this.openedDocs.has(uri)) return
    this.openedDocs.add(uri)
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } })
    await new Promise(r => setTimeout(r, 400))
  }

  async hover(uri: string, line: number, character: number): Promise<string | null> {
    try {
      const result = await this.request('textDocument/hover', {
        textDocument: { uri },
        position: { line, character },
      }) as { contents: unknown } | null
      if (!result) return null
      return lspContentsToText(result.contents)
    } catch { return null }
  }

  async definition(uri: string, line: number, character: number): Promise<LspLocation[] | null> {
    try {
      const result = await this.request('textDocument/definition', {
        textDocument: { uri },
        position: { line, character },
      })
      if (!result) return null
      if (Array.isArray(result)) return result as LspLocation[]
      return [result as LspLocation]
    } catch { return null }
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return
    try { await this.request('shutdown', null, 3000) } catch {}
    this.notify('exit', null)
    this.proc?.kill()
    this.proc = null
  }

  get isRunning(): boolean { return this.proc !== null && this._initialized }
}

function lspContentsToText(contents: unknown): string {
  if (!contents) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents.map(c => (typeof c === 'string' ? c : (c as any)?.value ?? '')).filter(Boolean).join('\n\n')
  }
  if (typeof contents === 'object') return (contents as any).value ?? ''
  return String(contents)
}
