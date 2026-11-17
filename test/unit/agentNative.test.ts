import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ConfigManager reads ~/.localcode at import time — point it at a temp home.
const home = mkdtempSync(join(tmpdir(), 'lc-home-'))
vi.stubEnv('USERPROFILE', home)
vi.stubEnv('HOME', home)

let AgentRuntime: typeof import('../../src/agent/AgentRuntime').AgentRuntime
let ConfigManager: typeof import('../../src/config/ConfigManager').ConfigManager
beforeAll(async () => {
  ;({ AgentRuntime } = await import('../../src/agent/AgentRuntime'))
  ;({ ConfigManager } = await import('../../src/config/ConfigManager'))
})

/** A fake LM Studio that answers each request with the next scripted turn. */
async function fakeServer(turns: unknown[][]) {
  const bodies: any[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', () => {
      bodies.push(JSON.parse(raw))
      const chunks = turns[bodies.length - 1] ?? [{ choices: [{ delta: { content: 'DONE: out of script' } }] }]
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/v1`, bodies, close: () => server.close() }
}

const call = (id: string, name: string, args: string) => [
  { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
]

describe('agent loop with native tool calls', () => {
  it('runs a tool from tool_calls and answers it with a tool message', async () => {
    const srv = await fakeServer([
      call('c1', 'write_file', '{"path": "a.txt", "content": "native ok"}'),
      [{ choices: [{ delta: { content: 'DONE: wrote a.txt' } }] }],
    ])
    const dir = mkdtempSync(join(tmpdir(), 'lc-native-'))
    const cm = ConfigManager.getInstance()
    cm.set({ llm: { provider: 'lmstudio', model: 'm', baseURL: srv.url, toolMode: 'native' } })
    cm.trustPath(dir)

    const agent = new AgentRuntime()
    const done = new Promise<any>((r) => agent.on('done', r))
    await agent.run('write a.txt', dir)
    const result = await done
    srv.close()

    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('native ok')
    expect(result.response).toBe('wrote a.txt')
    expect(srv.bodies[0].tools.some((t: any) => t.function.name === 'write_file')).toBe(true)
    // The system prompt doesn't teach the JSON protocol in native mode.
    expect(srv.bodies[0].messages[0].content).not.toContain('{"tool": "write_file"')
    const second = srv.bodies[1].messages
    const assistant = second[second.length - 2]
    const tool = second[second.length - 1]
    expect(assistant.tool_calls[0].id).toBe('c1')
    expect(tool).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
    expect(tool.content).toContain('Written')
  })

  it('repairs arguments with a missing closing brace', async () => {
    const srv = await fakeServer([
      call('c1', 'write_file', '{"path": "b.txt", "content": "repaired"'),
      [{ choices: [{ delta: { content: 'DONE: ok' } }] }],
    ])
    const dir = mkdtempSync(join(tmpdir(), 'lc-native-'))
    const cm = ConfigManager.getInstance()
    cm.set({ llm: { provider: 'lmstudio', model: 'm', baseURL: srv.url, toolMode: 'native' } })
    cm.trustPath(dir)
    const agent = new AgentRuntime()
    const done = new Promise((r) => agent.on('done', r))
    await agent.run('write b.txt', dir)
    await done
    srv.close()
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('repaired')
  })
})
