import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { wrapText, getItemWindow, fuzzyScore, formatTokens } from '../../src/shared/utils'
import { highlight } from '../../src/shared/highlight'
import { checkpoints } from '../../src/agent/checkpoints'

describe('utils', () => {
  it('wrapText breaks at spaces and hard-wraps long words', () => {
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('getItemWindow skips items far below and above the viewport', () => {
    const heights = Array(100).fill(5) // 500 rows
    const w = getItemWindow(heights, 20, 200)
    expect(w.linesBelow).toBeGreaterThan(0)
    expect(w.linesAbove).toBeGreaterThan(0)
    expect(w.end - w.start).toBeLessThan(100)
  })

  it('fuzzyScore prefers word starts and rejects non-subsequences', () => {
    expect(fuzzyScore('sl', '/session load')).not.toBeNull()
    expect(fuzzyScore('xz', '/session load')).toBeNull()
    expect(fuzzyScore('sl', '/session load')!).toBeGreaterThan(fuzzyScore('sl', '/tools list')!)
  })

  it('formatTokens', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12345)).toBe('12.3k')
  })
})

describe('highlight', () => {
  it('tags keywords, strings, comments and numbers', () => {
    const [line] = highlight(['const x = "a" // note'], 'ts')
    const kinds = Object.fromEntries(line.filter((t) => t.kind !== 'plain' && t.kind !== 'punct').map((t) => [t.text.trim(), t.kind]))
    expect(kinds).toMatchObject({ const: 'keyword', '"a"': 'string', '// note': 'comment' })
  })

  it('carries block comments across lines', () => {
    const lines = highlight(['/* a', 'b */ x'], 'js')
    expect(lines[1][0]).toEqual({ text: 'b */', kind: 'comment' })
  })
})

describe('checkpoints', () => {
  it('undoes a change and removes a file the task created', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-undo-'))
    const old = join(dir, 'old.txt')
    const created = join(dir, 'new.txt')
    writeFileSync(old, 'before')

    checkpoints.beginTask()
    await checkpoints.record(old)
    writeFileSync(old, 'after')
    await checkpoints.record(created)
    writeFileSync(created, 'fresh')

    const undone = await checkpoints.undoTask()
    expect(undone.map((u) => u.action).sort()).toEqual(['removed', 'restored'])
    expect(readFileSync(old, 'utf8')).toBe('before')
    expect(existsSync(created)).toBe(false)
  })
})
