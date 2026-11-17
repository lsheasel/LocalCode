import { describe, it, expect } from 'vitest'
import { editKey, layoutRows, cursorRowCol, EditorState } from '../../src/shared/lineEditor'

const at = (value: string, cursor = value.length): EditorState => ({ value, cursor })
const edit = (s: EditorState, input: string, key = {}, width = 40) => {
  const r = editKey(s, input, key, width)
  if (r.kind !== 'edit') throw new Error(`expected an edit, got ${r.kind}`)
  return r.state
}

describe('editKey', () => {
  it('inserts typed text at the cursor', () => {
    expect(edit(at('ac', 1), 'b')).toEqual({ value: 'abc', cursor: 2 })
  })

  it('Enter submits; Alt+Enter and Ctrl+J add a line', () => {
    expect(editKey(at('x'), '\r', { return: true }, 40).kind).toBe('submit')
    expect(edit(at('x'), '\r', { meta: true }).value).toBe('x\n')
    expect(edit(at('x'), 'j', { ctrl: true }).value).toBe('x\n')
  })

  it('pastes multi-line text as text, normalising line breaks', () => {
    expect(edit(at(''), 'one\r\ntwo').value).toBe('one\ntwo')
  })

  it('backspace deletes before the cursor (Ink reports it as delete)', () => {
    expect(edit(at('abc'), '', { delete: true })).toEqual({ value: 'ab', cursor: 2 })
    expect(editKey(at('abc', 0), '', { backspace: true }, 40).kind).toBe('ignored')
  })

  it('moves by word and to line start/end', () => {
    expect(edit(at('one two three'), '[1;5D', { meta: true }).cursor).toBe(8)
    expect(edit(at('ab\ncd', 4), 'a', { ctrl: true }).cursor).toBe(3)
    expect(edit(at('ab\ncd', 3), 'e', { ctrl: true }).cursor).toBe(5)
  })

  it('ctrl+w deletes a word, ctrl+u to line start', () => {
    expect(edit(at('one two'), 'w', { ctrl: true }).value).toBe('one ')
    expect(edit(at('a\nbc d'), 'u', { ctrl: true }).value).toBe('a\n')
  })

  it('↑ on the first row is an edge (history), otherwise moves a row', () => {
    expect(editKey(at('one'), '', { upArrow: true }, 40)).toEqual({ kind: 'edge', dir: -1 })
    expect(edit(at('ab\ncd', 4), '', { upArrow: true }).cursor).toBe(1)
  })

  it('leaves shortcuts to the app', () => {
    expect(editKey(at(''), 'p', { ctrl: true }, 40).kind).toBe('ignored')
    expect(editKey(at(''), '\t', { tab: true }, 40).kind).toBe('ignored')
  })
})

describe('layout', () => {
  it('wraps long lines and keeps the cursor on the right row', () => {
    const rows = layoutRows('abcdefgh\nxy', 4)
    expect(rows.map((r) => r.text)).toEqual(['abcd', 'efgh', 'xy'])
    expect(cursorRowCol(rows, 5)).toEqual({ row: 1, col: 1 })
    expect(cursorRowCol(rows, 10)).toEqual({ row: 2, col: 1 })
  })
})
