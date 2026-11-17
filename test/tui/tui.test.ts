// End-to-end checks of the terminal UI. They run the built app — run
// `npm run build` first (`npm run test:tui` does both). No model server is
// needed: everything here works without one.

import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { Session, KEY, ROOT } from './harness'

const sessions: Session[] = []
const start = async (opts: ConstructorParameters<typeof Session>[0] = {}) => {
  const s = new Session(opts)
  sessions.push(s)
  await s.until((t) => /Ask anything/.test(t))
  return s
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.quit()))
})

/** Every row must fit: the frames' right borders and the screen edge line up. */
function assertNoOverflow(screen: string[], cols: number) {
  for (const row of screen) expect(row.length).toBeLessThanOrEqual(cols)
}

describe.skipIf(!existsSync(join(ROOT, 'dist', 'localcode.js')))('tui', () => {
  it('shows the start screen with the wordmark and the prompt', async () => {
    const s = await start({ cols: 110, rows: 32 })
    const t = await s.text()
    expect(t).toMatch(/your code, your machine/)
    expect(t).toMatch(/┌─ build/)
  }, 20000)

  it('stays inside the screen across resizes', async () => {
    const s = await start({ cols: 110, rows: 32 })
    for (const [c, r] of [[60, 20], [44, 14], [140, 40]] as const) {
      s.resize(c, r)
      await s.wait(500)
      assertNoOverflow(await s.screen(), c)
      expect(await s.text()).toMatch(/Ask anything/)
    }
  }, 30000)

  it('edits multi-line text and moves the cursor', async () => {
    const s = await start()
    await s.type('line one')
    s.key(KEY.altEnter)
    await s.type('line two')
    s.key(KEY.left + KEY.left + KEY.left) // a held arrow key: three keys in one chunk
    await s.type('X')
    const t = await s.until((x) => /line Xtwo/.test(x))
    expect(t.indexOf('line one')).toBeLessThan(t.indexOf('line Xtwo'))
  }, 20000)

  it('keeps a multi-line paste in the prompt instead of sending it', async () => {
    const s = await start()
    s.key('\x1b[200~first line\r\nsecond line\x1b[201~')
    const t = await s.until((x) => /second line/.test(x))
    expect(t).not.toMatch(/◆ you/)
  }, 20000)

  it('runs the highlighted slash command on enter', async () => {
    const s = await start()
    await s.type('/doc')
    s.key(KEY.enter)
    await s.until((t) => /Node\.js/.test(t) && /Not reachable/.test(t))
  }, 20000)

  it('rejects an unknown command instead of sending it to the model', async () => {
    const s = await start()
    await s.type('/foobar')
    s.key(KEY.enter)
    await s.until((t) => /Unknown command: \/foobar/.test(t))
  }, 20000)

  it('opens the palette and runs a command from it', async () => {
    const s = await start()
    s.key(KEY.ctrlP)
    await s.until((t) => /palette/.test(t))
    await s.type('help')
    s.key(KEY.enter)
    await s.until((t) => /Attachments/.test(t))
  }, 20000)

  it('runs a shell command and shows its output', async () => {
    const s = await start()
    await s.type('$ echo hello-from-shell')
    s.key(KEY.enter)
    await s.until((t) => /├─ run/.test(t) && /hello-from-shell/.test(t.split('├─ run')[1] ?? ''), 15000)
    // ↑ brings the command back
    s.key(KEY.up)
    await s.until((t) => /▍ \$ echo hello-from-shell/.test(t))
  }, 30000)

  it('quits on ctrl+c', async () => {
    const s = await start()
    s.key(KEY.ctrlC)
    await s.wait(1500)
    expect(s.exited).toBe(true)
  }, 20000)
})
