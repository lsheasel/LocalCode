import { resolve } from 'path'

// Fill in your Discord Application ID here after creating the app at
// https://discord.com/developers/applications
export const DISCORD_CLIENT_ID = process.env.LOCALCODE_DISCORD_CLIENT_ID || '1503487564664012942'

interface RPC {
  login(opts: { clientId: string }): Promise<void>
  setActivity(opts: Record<string, unknown>): Promise<void>
  destroy(): Promise<void>
  on(event: string, cb: () => void): void
}

export class DiscordPresence {
  private rpc: RPC | null = null
  private startTime = Date.now()
  private connected = false
  private updateTimer: NodeJS.Timeout | null = null
  private lastStatus = ''
  private lastDetail = ''

  async connect(): Promise<void> {
    if (DISCORD_CLIENT_ID === '__DISCORD_CLIENT_ID__') return  // not configured

    try {
      // Dynamic import so missing module doesn't crash on startup
      const { Client } = await import('discord-rpc' as any)
      this.rpc = new Client({ transport: 'ipc' }) as RPC

      this.rpc.on('ready', () => { this.connected = true })

      await this.rpc.login({ clientId: DISCORD_CLIENT_ID })
    } catch {
      // Discord not running or not installed — silently skip
      this.rpc = null
    }
  }

  update(status: 'idle' | 'thinking' | 'running' | 'error', cwd?: string): void {
    if (!this.connected || !this.rpc) return

    const dir = cwd ? cwd.split(/[/\\]/).slice(-2).join('/') : ''
    const stateMap: Record<string, string> = {
      idle:     'Idle',
      thinking: 'Thinking…',
      running:  'Running agent',
      error:    'Error',
    }
    const state  = stateMap[status] ?? 'Idle'
    const detail = dir ? `📁 ${dir}` : 'LocalCode'

    if (state === this.lastStatus && detail === this.lastDetail) return
    this.lastStatus = state
    this.lastDetail = detail

    // Debounce updates to avoid Discord rate limits
    if (this.updateTimer) clearTimeout(this.updateTimer)
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null
      this.rpc?.setActivity({
        details:    detail,
        state:      state,
        startTimestamp: this.startTime,
        largeImageKey:  'localcode',
        largeImageText: 'LocalCode — AI Developer Terminal',
        instance:   false,
      }).catch(() => {})
    }, 500)
  }

  async destroy(): Promise<void> {
    if (this.updateTimer) { clearTimeout(this.updateTimer); this.updateTimer = null }
    if (this.rpc) {
      try { await this.rpc.destroy() } catch {}
      this.rpc = null
    }
    this.connected = false
  }
}

export const discordPresence = new DiscordPresence()
