// The built-in tools as structured definitions for the native tool API.
// The text-mode prompt (shared/prompts.ts) describes the same tools in prose;
// keep both in step when a tool changes.

import { ToolSchema } from '../shared/types'

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
})
const str = (description: string) => ({ type: 'string', description })
const int = (description: string) => ({ type: 'integer', description })
const bool = (description: string) => ({ type: 'boolean', description })

export const TOOL_SCHEMAS: ToolSchema[] = [
  // ── read ──
  {
    name: 'read_file',
    description: 'Read a file. Reads the whole file unless start_line/end_line give a range. "format" decodes html/xml/json/csv.',
    parameters: obj({
      path: str('File path, relative to the project or absolute'),
      start_line: int('First line to read (1-based)'),
      end_line: int('Last line to read'),
      format: { type: 'string', enum: ['html', 'xml', 'json', 'csv'], description: 'Decode the content' },
    }, ['path']),
  },
  {
    name: 'list_files',
    description: 'List the contents of a directory.',
    parameters: obj({ path: str('Directory, default "."'), recursive: bool('Include subdirectories') }),
  },
  {
    name: 'find_files',
    description: 'Find files by name pattern (glob-style, * and ? supported).',
    parameters: obj({ pattern: str('e.g. "*.test.ts"'), path: str('Where to search, default "."') }, ['pattern']),
  },
  {
    name: 'search_files',
    description: 'Search for a text or regex pattern inside files. Returns file:line: text.',
    parameters: obj({ pattern: str('Text or regular expression'), path: str('Where to search, default "."') }, ['pattern']),
  },
  { name: 'git_status', description: 'Working tree status.', parameters: obj({}) },
  { name: 'git_diff', description: 'Show uncommitted changes.', parameters: obj({ staged: bool('Show staged changes instead') }) },
  { name: 'git_log', description: 'Recent commit history.', parameters: obj({ limit: int('Number of commits, default 20') }) },
  {
    name: 'lsp_check',
    description: "Run the project's checker (tsc, eslint, cargo check, go vet, ruff, …) and return errors and warnings.",
    parameters: obj({ path: str('File or directory, default "."') }),
  },
  {
    name: 'lsp_hover',
    description: 'Type information / documentation for the symbol at a position (1-based line and column).',
    parameters: obj({ path: str('File'), line: int('Line'), col: int('Column') }, ['path', 'line', 'col']),
  },
  {
    name: 'lsp_definition',
    description: 'Where the symbol at a position is defined (1-based line and column).',
    parameters: obj({ path: str('File'), line: int('Line'), col: int('Column') }, ['path', 'line', 'col']),
  },
  {
    name: 'web_search',
    description: 'Search the web. Returns titles, URLs and snippets of the top results — read a page with web_fetch. Use this instead of guessing URLs.',
    parameters: obj({ query: str('Search query'), limit: int('Number of results, default 8') }, ['query']),
  },
  {
    name: 'web_fetch',
    description: 'Fetch a URL and return its content (text by default, HTML tags stripped).',
    parameters: obj({
      url: str('Full URL'),
      format: { type: 'string', enum: ['text', 'html', 'json', 'xml', 'csv'], description: 'Default "text"' },
    }, ['url']),
  },

  // ── write / act ──
  {
    name: 'run_shell',
    description: 'Run a shell command in the project directory.',
    parameters: obj({ command: str('The command') }, ['command']),
  },
  {
    name: 'write_file',
    description: 'Create a NEW file. Never use it on an existing file — use edit_file. For a long file, write the first part here and add the rest with append_file.',
    parameters: obj({ path: str('File path'), content: str('File content') }, ['path', 'content']),
  },
  {
    name: 'append_file',
    description: 'Append content to a file (creates it if missing). Also how to continue a long new file after write_file.',
    parameters: obj({ path: str('File path'), content: str('Content to append') }, ['path', 'content']),
  },
  {
    name: 'edit_file',
    description: 'Replace a piece of an existing file. "old" should be copied from the file (without read_file line numbers); include enough lines to be unique.',
    parameters: obj({ path: str('File path'), old: str('Text to replace'), new: str('Replacement text') }, ['path', 'old', 'new']),
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory.',
    parameters: obj({ path: str('Path'), recursive: bool('Delete a directory with its contents') }, ['path']),
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or directory.',
    parameters: obj({ from: str('Source'), to: str('Destination') }, ['from', 'to']),
  },
  {
    name: 'copy_file',
    description: 'Copy a file.',
    parameters: obj({ from: str('Source'), to: str('Destination') }, ['from', 'to']),
  },
  {
    name: 'create_dir',
    description: 'Create a directory, including parent directories.',
    parameters: obj({ path: str('Directory') }, ['path']),
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and commit.',
    parameters: obj({ message: str('Commit message') }, ['message']),
  },
  {
    name: 'git_branch',
    description: 'List, create, check out or delete branches.',
    parameters: obj({
      action: { type: 'string', enum: ['list', 'create', 'checkout', 'delete'] },
      name: str('Branch name (not for list)'),
    }, ['action']),
  },
  {
    name: 'git_stash',
    description: 'Stash or restore working-tree changes.',
    parameters: obj({ action: { type: 'string', enum: ['push', 'pop', 'list'] }, message: str('Stash message') }, ['action']),
  },
  {
    name: 'http_request',
    description: 'Make an HTTP request.',
    parameters: obj({
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      url: str('Full URL'),
      headers: { type: 'object', description: 'Request headers' },
      body: { description: 'Request body (object or string)' },
    }, ['method', 'url']),
  },
  {
    name: 'run_tests',
    description: "Detect and run the project's test suite (npm test, cargo test, go test, pytest, …).",
    parameters: obj({}),
  },
]

/** The tools for a mode: plan mode only gets the ones that observe. */
export function toolsFor(allowed: (name: string) => boolean, plugins: Array<{ name: string; description: string }>): ToolSchema[] {
  return [
    ...TOOL_SCHEMAS.filter((t) => allowed(t.name)),
    ...plugins
      .filter((p) => allowed(p.name))
      .map((p) => ({
        name: p.name,
        description: p.description,
        // Plugins don't declare their arguments; accept any object.
        parameters: { type: 'object', properties: {}, additionalProperties: true },
      })),
  ]
}
