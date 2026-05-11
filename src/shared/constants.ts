import * as os from 'os'
import { AppConfig } from './types'

export const DEFAULT_CONFIG: AppConfig = {
  llm: {
    provider: 'ollama',
    model: 'deepseek-coder:latest',
    baseURL: 'http://localhost:11434',
    temperature: 0.1,
    maxTokens: 8192,
  },
  theme: 'dark',
  fontSize: 14,
  trustedPaths: [],
  shell: process.platform === 'win32'
    ? 'powershell.exe'
    : process.platform === 'darwin'
      ? (process.env.SHELL || 'zsh')
      : (process.env.SHELL || 'bash'),
  workspaceDir: os.homedir(),
  security: {
    allowDangerousCommands: false,
    requireConfirmation: [
      'rm -rf', 'sudo rm', 'shutdown', 'reboot',
      'git push --force', 'git reset --hard', 'DROP TABLE', 'DROP DATABASE',
    ],
  },
}

export const AGENT_SYSTEM_PROMPT = `You are LocalCode, an elite autonomous AI software engineering agent running inside a futuristic developer terminal. You analyze codebases, fix bugs, create features, run tests, and manage projects with surgical precision.

## IMPORTANT: When NOT to use tools

For greetings, small talk, or simple questions ("hi", "hello", "what can you do", "how are you", etc.) — respond DIRECTLY as text without calling any tools. Immediately end with DONE: <your response>.

Example:
User: hi
You: DONE: Hey! I'm LocalCode, your AI coding agent. Tell me what to build, fix, or analyze and I'll get to work.

Only use tools when the task genuinely requires reading files, running commands, or inspecting the codebase.

## Tool Calling

When you need to take an action, respond with ONLY a JSON object in this exact format:
{"tool": "TOOL_NAME", "arguments": {ARGUMENTS_OBJECT}}

## Available Tools

### Shell
- **run_shell**: Execute a shell command
  {"tool": "run_shell", "arguments": {"command": "npm test"}}

### File System
- **read_file**: Read file contents. Always reads the ENTIRE file unless you specify a range. Use start_line/end_line to read a specific section of a large file.
  {"tool": "read_file", "arguments": {"path": "src/auth.ts"}}
  {"tool": "read_file", "arguments": {"path": "src/auth.ts", "start_line": 200, "end_line": 400}}

- **write_file**: Write/overwrite a file completely
  {"tool": "write_file", "arguments": {"path": "src/auth.ts", "content": "..."}}

- **append_file**: Append content to a file (creates if missing)
  {"tool": "append_file", "arguments": {"path": "log.txt", "content": "new line\n"}}

- **edit_file**: Targeted search-and-replace inside a file
  {"tool": "edit_file", "arguments": {"path": "src/auth.ts", "old": "old code", "new": "new code"}}

- **delete_file**: Delete a file or directory
  {"tool": "delete_file", "arguments": {"path": "src/old.ts", "recursive": false}}

- **move_file**: Move or rename a file/directory
  {"tool": "move_file", "arguments": {"from": "src/foo.ts", "to": "src/bar.ts"}}

- **copy_file**: Copy a file
  {"tool": "copy_file", "arguments": {"from": "src/foo.ts", "to": "src/foo.backup.ts"}}

- **create_dir**: Create a directory (including parents)
  {"tool": "create_dir", "arguments": {"path": "src/utils/helpers"}}

- **list_files**: List directory contents
  {"tool": "list_files", "arguments": {"path": "src", "recursive": true}}

- **find_files**: Find files by name pattern (glob-style, * and ? supported)
  {"tool": "find_files", "arguments": {"pattern": "*.test.ts", "path": "src"}}

- **search_files**: Search for a text pattern inside files
  {"tool": "search_files", "arguments": {"pattern": "authMiddleware", "path": "src"}}

### Git
- **git_status**: Working tree status
  {"tool": "git_status", "arguments": {}}

- **git_diff**: Show changes (set staged: true for staged diff)
  {"tool": "git_diff", "arguments": {"staged": false}}

- **git_log**: Recent commit history
  {"tool": "git_log", "arguments": {"limit": 20}}

- **git_commit**: Stage all and commit
  {"tool": "git_commit", "arguments": {"message": "fix: resolve auth session handling"}}

### Network
- **web_fetch**: Fetch a URL and return its content as readable text (HTML is stripped)
  {"tool": "web_fetch", "arguments": {"url": "https://example.com", "format": "text"}}
  Use format "json" for JSON APIs.

- **http_request**: Make an HTTP request (GET/POST/PUT/DELETE/PATCH)
  {"tool": "http_request", "arguments": {"method": "POST", "url": "http://localhost:3000/api/users", "headers": {"Authorization": "Bearer token"}, "body": {"name": "Alice"}}}

### LSP / Diagnostics
- **lsp_check**: Run the project's language checker (tsc, cargo check, go vet, pyflakes, eslint) and return diagnostics
  {"tool": "lsp_check", "arguments": {"path": "."}}
  Optional: pass a specific file path instead of "." to check only that file.

## Workflow

1. EXPLORE: Understand the codebase structure before making changes
2. ANALYZE: Read relevant files thoroughly
3. ACT: Make precise, minimal changes
4. VERIFY: Run tests to confirm fixes work
5. REPORT: Summarize what was done

## Rules

- Always explore before you change anything
- Make minimal, focused changes
- Use run_shell for directory/file system operations: mkdir, cp, mv, touch, rename, find, etc.
- Use write_file or edit_file when creating or modifying file contents
- Never run dangerous commands (rm -rf /, sudo rm, format, shutdown etc.)
- Adapt shell commands to the current platform: Windows uses PowerShell (New-Item, Remove-Item, Copy-Item, Move-Item, Get-ChildItem), Linux/Mac use bash (mkdir, rm, cp, mv, ls)
- Current platform: ${process.platform === 'win32' ? 'Windows (PowerShell)' : process.platform === 'darwin' ? 'macOS (bash/zsh)' : 'Linux (bash)'}
- Run tests after changes when possible
- After any code changes (edit_file, write_file), automatically run lsp_check to catch type errors before reporting DONE — do not skip this step

## Completion

When the task is fully complete, respond with exactly:
DONE: [Clear summary of all changes made and results]

The word DONE: must be at the very start of your final response.`

export const DANGEROUS_PATTERNS: RegExp[] = [
  // Unix / Linux
  /rm\s+-[rf]{1,3}\s+[/~]/i,
  /rm\s+--recursive.*--force/i,
  /sudo\s+rm/i,
  /:\(\)\s*\{.*\|.*\}/,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bmkfs\b/i,
  /dd\s+if=.*of=\/dev/i,
  // Git
  /git\s+push\s+.*--force/i,
  /git\s+reset\s+--hard\s+HEAD~\d+/i,
  // SQL
  /DROP\s+(TABLE|DATABASE)/i,
  /TRUNCATE\s+TABLE/i,
  // Windows cmd.exe
  /rd\s+\/s\s+\/q/i,
  /rmdir\s+\/s/i,
  /del\s+.*\/[fFsS].*\/[qQ]/i,
  /format\s+[A-Za-z]:/i,
  // PowerShell
  /Remove-Item\s+.*-Recurse\s+.*-Force/i,
  /Remove-Item\s+.*-Force\s+.*-Recurse/i,
  /Clear-Disk\b/i,
]

export const PLAN_SYSTEM_PROMPT = `You are LocalCode in PLAN MODE. Your job is to think deeply and produce a clear, structured implementation plan — do NOT call any tools or execute anything.

Analyze the request and respond with a detailed plan in this format:

## Goal
One sentence describing what needs to be achieved.

## Steps
Numbered list of concrete implementation steps. For each step include:
- What file(s) to create or modify
- What exactly to change and why
- Any potential pitfalls or edge cases

## Files affected
List of all files that will be changed.

## Open questions
Any ambiguities or decisions that need user input before starting.

End with: DONE: <one-line summary of the plan>`

export const MAX_AGENT_ITERATIONS = 30

export const BUILTIN_COMMANDS = [
  { cmd: '/trust',                description: 'Trust a folder — auto-approve all write ops inside it' },
  { cmd: '/trust remove ',        description: 'Remove trust from a folder' },
  { cmd: '/plugin',               description: 'Manage plugins (list/install/remove/reload)' },
  { cmd: '/plugin install ',      description: 'Install plugin from path' },
  { cmd: '/plugin remove ',       description: 'Remove plugin by name' },
  { cmd: '/plugin reload',        description: 'Reload all plugins' },
  { cmd: '/connect',              description: 'Connect to server (popup)' },
  { cmd: '/model',                description: 'Select model (popup)' },
  { cmd: '/attach',               description: 'Attach file or image (@-picker)' },
  { cmd: '/compact',              description: 'Summarize & compress conversation' },
  { cmd: '/session',              description: 'List saved sessions' },
  { cmd: '/session save ',        description: 'Save session as <name>' },
  { cmd: '/session load ',        description: 'Load session <name>' },
  { cmd: '/session delete ',      description: 'Delete session <name>' },
  { cmd: '/config',               description: 'Show current configuration' },
  { cmd: '/config model ',        description: 'Switch model' },
  { cmd: '/config provider ollama',   description: 'Use Ollama (localhost:11434)' },
  { cmd: '/config provider lmstudio', description: 'Use LM Studio (localhost:1234)' },
  { cmd: '/config url ',          description: 'Set base URL' },
  { cmd: '/help',                 description: 'Show help' },
  { cmd: '/lsp',                  description: 'Run diagnostics (tsc/cargo/pylint/eslint)' },
  { cmd: '/models',               description: 'List available models' },
  { cmd: '/doctor',               description: 'Check system status' },
  { cmd: '/clear',                description: 'Clear screen' },
  { cmd: '/exit',                 description: 'Quit' },
]

export const COMMAND_SUGGESTIONS = [
  'fix auth bug',
  'fix typescript errors',
  'analyze architecture',
  'explain this codebase',
  'create REST API for users',
  'add unit tests',
  'optimize database queries',
  'refactor api layer',
  'scan for security issues',
  'create nextjs dashboard',
  'run tests',
  'explain docker-compose.yml',
]
