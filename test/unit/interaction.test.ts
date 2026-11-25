import { describe, it, expect } from 'vitest'
import { decodeMouse, highlight, plain, selectedRows, sliceCells, tidySelection } from '../../src/shared/screen'
import { mix, shimmer } from '../../src/shared/anim'
import { SETTINGS, nextChoice, stepNumber, prefs } from '../../src/shared/settings'
import { answerText } from '../../src/shared/utils'
import { transcriptMarkdown } from '../../src/hooks/useSlashCommands'
import { DEFAULT_CONFIG } from '../../src/shared/constants'

describe('mouse reports', () => {
  it('decodes presses, drags, motion and the wheel', () => {
    expect(decodeMouse(0, 5, 3, 'M')).toEqual({ kind: 'down', button: 0, x: 4, y: 2 })
    expect(decodeMouse(0, 5, 3, 'm')).toEqual({ kind: 'up', button: 0, x: 4, y: 2 })
    expect(decodeMouse(32, 9, 3, 'M')).toEqual({ kind: 'drag', button: 0, x: 8, y: 2 })
    expect(decodeMouse(35, 9, 3, 'M')).toEqual({ kind: 'move', button: 3, x: 8, y: 2 })
    expect(decodeMouse(64, 1, 1, 'M')).toBe('up')
    expect(decodeMouse(65, 1, 1, 'M')).toBe('down')
  })
})

describe('selection', () => {
  const sel = (fx: number, fy: number, tx: number, ty: number, left = 0, right = 20) => ({
    from: { x: fx, y: fy },
    to: { x: tx, y: ty },
    left,
    right,
    color: '#24508F',
  })

  it('covers rows like a terminal does, in either drag direction', () => {
    expect(selectedRows(sel(3, 1, 5, 3))).toEqual([
      [1, 3, 19],
      [2, 0, 19],
      [3, 0, 5],
    ])
    expect(selectedRows(sel(5, 3, 3, 1))).toEqual(selectedRows(sel(3, 1, 5, 3)))
  })

  it('stays inside the pane it started in', () => {
    expect(selectedRows(sel(2, 0, 50, 1, 0, 10))).toEqual([
      [0, 2, 9],
      [1, 0, 9],
    ])
  })

  it('cuts text by cells, counting wide characters as two', () => {
    expect(sliceCells('hello world', 6, 11)).toBe('world')
    expect(sliceCells('a界b', 1, 3)).toBe('界')
    expect(sliceCells('a界b', 3, 4)).toBe('b')
  })

  it('paints the highlight without losing the text or its colours', () => {
    const line = '\x1b[31mred\x1b[39m plain'
    const out = highlight(line, 1, 5, '#24508F')
    expect(plain(out)).toBe('red plain')
    expect(out).toContain('48;2;36;80;143m')
    // After the range the row's own colour codes are put back.
    expect(out.indexOf('\x1b[49m')).toBeGreaterThan(out.indexOf('48;2;36;80;143m'))
  })

  it('drops the transcript thread and shared indentation from copied text', () => {
    expect(tidySelection(['│ first line', '│   indented', '│ last'])).toBe('first line\n  indented\nlast')
    expect(tidySelection(['   code();', '   more();'])).toBe('code();\nmore();')
    // A single row keeps what it is.
    expect(tidySelection(['│ x'])).toBe('│ x')
    // Started mid-line: the rows below lose the thread and the shared indent.
    expect(tidySelection(['export function f() {', '│      return 1', '│    }'])).toBe('export function f() {\n  return 1\n}')
  })
})

describe('animation helpers', () => {
  it('mixes colours', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('gives one colour per character for the shimmer', () => {
    const colors = shimmer(8, 400, '#000000', '#ffffff')
    expect(colors).toHaveLength(8)
    expect(new Set(colors).size).toBeGreaterThan(1)
  })
})

describe('settings', () => {
  it('has unique ids and every changeable setting can be stored', () => {
    const ids = SETTINGS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of SETTINGS) if (d.kind !== 'action') expect(d.set).toBeTypeOf('function')
  })

  it('cycles choices and keeps numbers in range', () => {
    const tools = SETTINGS.find((d) => d.id === 'toolMode')!
    expect(nextChoice(tools, 'auto')).toBe('native')
    expect(nextChoice(tools, 'text')).toBe('auto')
    expect(nextChoice(tools, 'auto', -1)).toBe('text')
    const temp = SETTINGS.find((d) => d.id === 'temperature')!
    expect(stepNumber(temp, 1.5, 1)).toBe(1.5)
    expect(stepNumber(temp, 0, -1)).toBe(0)
  })

  it('keeps Discord off and everything else on for an old config', () => {
    expect(prefs(DEFAULT_CONFIG)).toEqual({
      animations: true,
      mouse: true,
      discord: false,
      updateCheck: true,
      lspAutoInstall: true,
    })
  })
})

describe('answers and export', () => {
  it('copies the answer without reasoning or tool JSON', () => {
    expect(answerText('<think>hmm</think>Fixed the bug.\nDONE: ok')).toBe('Fixed the bug.\nok')
    expect(answerText('Here it is\n{"tool": "read_file"}')).toBe('Here it is')
  })

  it('writes the conversation as Markdown', () => {
    const md = transcriptMarkdown([
      { id: '1', type: 'text', content: '> fix add()', timestamp: 0 },
      { id: '2', type: 'tool_call', content: 'read_file', toolCall: { tool: 'read_file', arguments: { path: 'math.js' } }, timestamp: 0 },
      { id: '3', type: 'done', content: '<think>x</think>Fixed it.', timestamp: 0 },
    ])
    expect(md).toContain('## You\n\nfix add()')
    expect(md).toContain('math.js')
    expect(md).toContain('## LocalCode\n\nFixed it.')
    expect(md).not.toContain('<think>')
  })
})
