import { describe, it, expect } from 'vitest'
import { planEdit } from '../../src/agent/tools/fuzzyEdit'

const FILE = 'function add(a, b) {\n    return a - b\n}\nmodule.exports = { add }\n'

describe('planEdit', () => {
  it('replaces an exact match, also inside a line', () => {
    const r = planEdit(FILE, 'a - b', 'a + b')
    expect(r.ok && r.plan.strategy).toBe('exact')
    expect(r.ok && r.plan.content).toContain('return a + b')
  })

  it('does not expand $-patterns in the replacement', () => {
    const r = planEdit('x = 1\n', 'x = 1', "x = '$&$1'")
    expect(r.ok && r.plan.content).toBe("x = '$&$1'\n")
  })

  it('ignores line numbers copied from read_file', () => {
    const r = planEdit(FILE, '     2 │     return a - b', '     2 │     return a + b')
    expect(r.ok).toBe(true)
    expect(r.ok && r.plan.content).toContain('    return a + b')
    expect(r.ok && r.plan.content).not.toContain('│')
  })

  it('matches with different indentation and re-indents the new text', () => {
    const r = planEdit(FILE, 'return a - b', '  return a + b')
    // exact substring wins here; force the line-based path with a multi-line block
    expect(r.ok).toBe(true)
    const block = planEdit(FILE, 'function add(a, b) {\n  return a - b\n}', 'function add(a, b) {\n  return a + b\n}')
    expect(block.ok && block.plan.strategy).toBe('indentation')
    expect(block.ok && block.plan.content).toContain('\n    return a + b\n')
  })

  it('ignores trailing whitespace and CRLF', () => {
    const crlf = 'a = 1   \r\nb = 2\r\n'
    const r = planEdit(crlf, 'a = 1\nb = 2', 'a = 10\nb = 20')
    expect(r.ok && r.plan.content).toBe('a = 10\r\nb = 20\r\n')
  })

  it('refuses an ambiguous loose match', () => {
    const twice = 'if (x) {\n  go()\n}\nif (x) {\n    go()\n}\n'
    const r = planEdit(twice, 'if (x) {\ngo()\n}', 'if (y) {\ngo()\n}')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/matches 2 places/)
  })

  it('reports a missing text', () => {
    const r = planEdit(FILE, 'return a * b', 'x')
    expect(r.ok).toBe(false)
  })
})

describe('planEdit re-indentation', () => {
  it('maps the model indentation to tabs', () => {
    const tabs = 'if (x) {\n\tif (y) {\n\t\tgo()\n\t}\n}\n'
    const r = planEdit(tabs, 'if (y) {\n  go()\n}', 'if (y) {\n  stop()\n  go()\n}')
    expect(r.ok && r.plan.content).toBe('if (x) {\n\tif (y) {\n\t\tstop()\n\t\tgo()\n\t}\n}\n')
  })

  it('scales a deeper level the old text never used', () => {
    const r = planEdit(FILE, 'function add(a, b) {\n  return a - b\n}', 'function add(a, b) {\n  if (a) {\n    return a + b\n  }\n}')
    expect(r.ok && r.plan.content).toContain('    if (a) {\n        return a + b\n    }')
  })
})
