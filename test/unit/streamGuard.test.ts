import { describe, it, expect } from 'vitest'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { LMStudioProvider } from '../../src/llm/providers/LMStudioProvider'
import { streamGuard } from '../../src/llm/streamGuard'

describe('streamGuard', () => {
  it('ends a request that goes quiet', async () => {
    const g = streamGuard(undefined, 50)
    await new Promise((r) => setTimeout(r, 120))
    expect(g.stalled).toBe(true)
    expect(g.signal.aborted).toBe(true)
    g.dispose()
  })

  it('stays open while data keeps coming, and follows an outside abort', async () => {
    const outside = new AbortController()
    const g = streamGuard(outside.signal, 80)
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 40))
      g.alive()
    }
    expect(g.signal.aborted).toBe(false)
    outside.abort()
    expect(g.signal.aborted).toBe(true)
    expect(g.stalled).toBe(false)
    g.dispose()
  })
})

describe('LM Studio stream cancel', () => {
  it('closes the HTTP request when the caller aborts', async () => {
    let closed = false
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const t = setInterval(() => res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'), 20)
      req.on('close', () => {
        closed = true
        clearInterval(t)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    const ctl = new AbortController()
    const p = new LMStudioProvider().stream(
      [{ role: 'user', content: 'hi' }],
      { provider: 'lmstudio', model: 'm', baseURL: `http://127.0.0.1:${port}/v1` },
      () => {},
      ctl.signal,
    )
    setTimeout(() => ctl.abort(), 100)
    await expect(p).rejects.toBeTruthy()
    await new Promise((r) => setTimeout(r, 100))
    expect(closed).toBe(true)
    server.close()
  })
})
