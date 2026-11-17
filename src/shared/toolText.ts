// How tool activity reads in the transcript: a short verb, its target, and a
// one-line summary of the result.

import { relative, isAbsolute } from 'path'

/** A path as the user thinks of it: relative to the project when inside it. */
export function nicePath(p: unknown): string {
  const s = String(p ?? '')
  if (!s) return '.'
  if (!isAbsolute(s)) return s.replace(/\\/g, '/')
  const rel = relative(process.cwd(), s)
  return (rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : s).replace(/\\/g, '/')
}

/** What a tool call does, as a lowercase verb and its target. */
export function describeTool(tool: string, a: Record<string, unknown>): [string, string] {
  switch (tool) {
    case 'run_shell': return ['run', String(a.command ?? '')]
    case 'read_file': return ['read', nicePath(a.path)]
    case 'write_file': return ['write', nicePath(a.path)]
    case 'append_file': return ['append', nicePath(a.path)]
    case 'edit_file': return ['edit', nicePath(a.path)]
    case 'delete_file': return ['delete', nicePath(a.path)]
    case 'move_file': return ['move', `${nicePath(a.from)} → ${nicePath(a.to)}`]
    case 'copy_file': return ['copy', `${nicePath(a.from)} → ${nicePath(a.to)}`]
    case 'create_dir': return ['mkdir', nicePath(a.path)]
    case 'list_files': return ['list', nicePath(a.path || '.')]
    case 'find_files': return ['find', String(a.pattern ?? '')]
    case 'search_files': return ['search', `"${String(a.pattern ?? '')}"`]
    case 'git_status': return ['git', 'status']
    case 'git_diff': return ['git', 'diff']
    case 'git_log': return ['git', 'log']
    case 'git_commit': return ['commit', `"${String(a.message ?? '')}"`]
    case 'git_branch': return ['git', `branch ${String(a.action || 'list')}${a.name ? ' ' + String(a.name) : ''}`]
    case 'git_stash': return ['git', `stash ${String(a.action || 'push')}`]
    case 'run_tests': return ['test', '']
    case 'web_search': return ['search', `web "${String(a.query ?? '')}"`]
    case 'web_fetch': return ['fetch', String(a.url ?? '')]
    case 'http_request': return [String(a.method || 'get').toLowerCase(), String(a.url ?? '')]
    case 'lsp_check': return ['check', nicePath(a.path || '.')]
    case 'lsp_hover': return ['hover', `${nicePath(a.path)}:${a.line}:${a.col}`]
    case 'lsp_definition': return ['define', `${nicePath(a.path)}:${a.line}:${a.col}`]
    default: return [tool.replace(/_/g, ' '), '']
  }
}

/** One-line summary of a tool's output, for the right edge of its row. */
export function summarizeOutput(output: string): string {
  const lines = output.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return 'no output'
  const hits = /^Results for "/.test(lines[0]) ? lines.filter((l) => /^\d+\. /.test(l)).length : 0
  if (hits) return `${hits} results`
  if (lines.length === 1) {
    const only = lines[0].trim()
    return isAbsolute(only) ? nicePath(only) : only
  }
  return `${lines.length} lines`
}
