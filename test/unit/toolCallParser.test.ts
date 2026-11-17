import { describe, it, expect } from 'vitest'
import { parseToolCall, looksLikeToolCall } from '../../src/agent/toolCallParser'

describe('parseToolCall', () => {
  it('reads a valid call after the reasoning', () => {
    const call = parseToolCall('<think>check {weird} braces</think>\n{"tool": "read_file", "arguments": {"path": "a.ts"}}')
    expect(call).toEqual({ tool: 'read_file', arguments: { path: 'a.ts' } })
  })

  it('repairs a missing closing brace (the long write_file case)', () => {
    const html = '<!DOCTYPE html>\\n<html>\\n<body>\\n</body>\\n</html>\\n'
    const call = parseToolCall(`{"tool": "write_file", "arguments": {"path": "index.html", "content": "${html}"}`)
    expect(call?.tool).toBe('write_file')
    expect(call?.arguments.content).toContain('</html>')
  })

  it('repairs two missing braces', () => {
    expect(parseToolCall('{"tool": "list_files", "arguments": {"path": "."')?.tool).toBe('list_files')
  })

  it('accepts real line breaks inside string values', () => {
    const call = parseToolCall('{"tool": "write_file", "arguments": {"path": "a.txt", "content": "line 1\nline 2\n\tend"}}')
    expect(call?.arguments.content).toBe('line 1\nline 2\n\tend')
  })

  it('accepts the flat argument form', () => {
    expect(parseToolCall('{"tool": "read_file", "path": "a.ts"}')).toEqual({ tool: 'read_file', arguments: { path: 'a.ts' } })
  })

  it('does not invent a call from text cut off inside a string', () => {
    expect(parseToolCall('{"tool": "write_file", "arguments": {"path": "a", "content": "half a fi')).toBeNull()
  })

  it('ignores plain answers', () => {
    expect(parseToolCall('Fixed it. The function now returns a + b.')).toBeNull()
  })
})

describe('looksLikeToolCall', () => {
  it('sees an attempted call, but not one inside the reasoning', () => {
    expect(looksLikeToolCall('{"tool": "write_file", "arguments": {')).toBe(true)
    expect(looksLikeToolCall('<think>maybe {"tool": "x"}</think> All done.')).toBe(false)
  })
})
