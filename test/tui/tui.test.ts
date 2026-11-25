// End-to-end checks of the terminal UI. They run the built app — run
// `npm run build` first (`npm run test:tui` does both). No model server is
// needed: everything here works without one.

import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { Session, KEY, ROOT, makeHome } from './harness'

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
    await s.until((t) => /Search commands/.test(t))
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

  it('runs a command from the / menu with a click', async () => {
    const s = await start()
    await s.type('/doc')
    await s.until((t) => /\/doctor/.test(t) && /commands/.test(t))
    const at = (await s.find('/doctor   Check'))!
    s.move(at.x, at.y)
    await s.click(at.x, at.y)
    await s.until((t) => /Node\.js/.test(t) && /Not reachable/.test(t))
  }, 20000)

  it('opens /settings and flips a switch with the mouse', async () => {
    const home = makeHome()
    const s = await start({ home })
    await s.type('/settings')
    s.key(KEY.enter)
    await s.until((t) => /settings/.test(t) && /discord status/.test(t))
    const row = (await s.find('discord status'))!
    await s.click(row.x, row.y)
    await s.until((t) => /discord status\s+━+● on/.test(t))
    const cfg = JSON.parse(readFileSync(join(home, '.localcode', 'config.json'), 'utf8'))
    expect(cfg.discord?.enabled).toBe(true)
    s.key(KEY.esc)
    await s.until((t) => /Ask anything/.test(t))
  }, 20000)

  it('copies text selected with a drag', async () => {
    const s = await start()
    await s.type('$ echo copy-me-please')
    s.key(KEY.enter)
    await s.until((t) => /├─ run/.test(t) && /copy-me-please/.test(t.split('├─ run')[1] ?? ''), 15000)
    const at = (await s.find('copy-me-please'))!
    await s.drag(at, { x: at.x + 'copy-me-please'.length - 1, y: at.y })
    await s.until((t) => /copied/.test(t))
    expect(s.clipboard).toBe('copy-me-please')
  }, 25000)

  it('opens the full output of a step when its row is clicked', async () => {
    const s = await start()
    await s.type('$ echo step-output')
    s.key(KEY.enter)
    await s.until((t) => /├─ run/.test(t), 15000)
    const row = (await s.find('├─ run'))!
    s.move(row.x + 4, row.y)
    await s.until((t) => /open output/.test(t))
    await s.click(row.x + 4, row.y)
    await s.until((t) => /esc close/.test(t) && /step-output/.test(t))
  }, 25000)

  it('switches mode with /mode', async () => {
    const s = await start()
    await s.type('/mode plan')
    s.key(KEY.enter)
    await s.until((t) => /┌─ plan/.test(t))
  }, 20000)

  it('quits on ctrl+c', async () => {
    const s = await start()
    s.key(KEY.ctrlC)
    await s.wait(1500)
    expect(s.exited).toBe(true)
  }, 20000)
})
