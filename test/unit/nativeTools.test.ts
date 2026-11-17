import { describe, it, expect } from 'vitest'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { LMStudioProvider } from '../../src/llm/providers/LMStudioProvider'
import { parseDuckDuckGoHtml } from '../../src/agent/tools/webSearch'
import { systemPrompt } from '../../src/shared/prompts'
import { loadInstructions } from '../../src/agent/projectInstructions'
import { TOOL_SCHEMAS } from '../../src/agent/toolSchemas'

async function serve(chunks: unknown[]) {
  let body: any
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', () => {
      body = JSON.parse(raw)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/v1`, body: () => body, close: () => server.close() }
}

describe('native tool calls (LM Studio stream)', () => {
  it('assembles a call streamed in pieces and shows it as {"tool": …} text', async () => {
    const srv = await serve([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path": "index.html", ' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content": "<h1>hi</h1>"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])
    let shown = ''
    const r = await new LMStudioProvider().stream(
      [{ role: 'user', content: 'x' }],
      { provider: 'lmstudio', model: 'm', baseURL: srv.url },
      () => {},
      undefined,
      [TOOL_SCHEMAS[0]],
      (t) => (shown += t),
    )
    srv.close()
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'write_file', arguments: '{"path": "index.html", "content": "<h1>hi</h1>"}' }])
    expect(shown).toContain('{"tool": "write_file", "arguments": {"path": "index.html"')
    expect(srv.body().tools[0].function.name).toBe('read_file')
  })

  it('sends tool results back in the OpenAI format', async () => {
    const srv = await serve([{ choices: [{ delta: { content: 'DONE: ok' } }] }])
    await new LMStudioProvider().stream(
      [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'list_files', arguments: '{}' }] },
        { role: 'tool', tool_call_id: 'c1', content: 'a.ts' },
      ],
      { provider: 'lmstudio', model: 'm', baseURL: srv.url },
      () => {},
    )
    srv.close()
    const msgs = srv.body().messages
    expect(msgs[1].tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'list_files', arguments: '{}' } })
    expect(msgs[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'a.ts' })
  })

  it('wraps a separate reasoning field in <think> tags', async () => {
    const srv = await serve([
      { choices: [{ delta: { reasoning_content: 'hmm' } }] },
      { choices: [{ delta: { content: 'DONE: hi' } }] },
    ])
    const r = await new LMStudioProvider().stream(
      [{ role: 'user', content: 'x' }],
      { provider: 'lmstudio', model: 'm', baseURL: srv.url },
      () => {},
    )
    srv.close()
    expect(r.response).toBe('<think>hmm</think>\nDONE: hi')
  })
})

describe('web_search parsing', () => {
  it('reads titles, real URLs and snippets, skipping ads', () => {
    const html = `
      <div class="result results_links results_links_deep web-result ">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvite.dev%2Fguide%2F&amp;rut=x">Getting Started | Vite</a>
        <a class="result__snippet" href="#">Vite is a <b>build tool</b> &amp; dev server.</a>
      </div>
      <div class="result result--ad">
        <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>
      </div>`
    expect(parseDuckDuckGoHtml(html)).toEqual([
      { title: 'Getting Started | Vite', url: 'https://vite.dev/guide/', snippet: 'Vite is a build tool & dev server.' },
    ])
  })
})

describe('system prompt', () => {
  it('drops the JSON protocol in native mode and appends project instructions', () => {
    const text = systemPrompt('build')
    const native = systemPrompt('build', { native: true, instructions: 'Use tabs.' })
    expect(text).toContain('{"tool": "write_file"')
    expect(native).not.toContain('{"tool": "write_file"')
    expect(native).toContain('function calling')
    expect(native).toContain('## Project instructions')
    expect(native).toContain('Use tabs.')
    expect(systemPrompt('plan', { native: true })).not.toContain('{"tool": "read_file"')
  })

  it('finds LOCALCODE.md, with AGENTS.md as the fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-'))
    expect(loadInstructions(dir).sources.filter((s) => !s.startsWith('~'))).toEqual([])
    writeFileSync(join(dir, 'AGENTS.md'), 'agents rules')
    expect(loadInstructions(dir).text).toContain('agents rules')
    writeFileSync(join(dir, 'LOCALCODE.md'), 'local rules')
    const i = loadInstructions(dir)
    expect(i.text).toContain('local rules')
    expect(i.text).not.toContain('agents rules')
    expect(i.sources).toContain('LOCALCODE.md')
  })
})
