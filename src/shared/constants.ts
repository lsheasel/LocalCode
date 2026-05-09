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
  shell: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash',
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

- **run_shell**: Execute any shell command — including file system operations like mkdir, cp, mv, touch, rename, find, cat, etc.
  {"tool": "run_shell", "arguments": {"command": "mkdir -p src/utils"}}
  {"tool": "run_shell", "arguments": {"command": "cp src/foo.ts src/bar.ts"}}
  {"tool": "run_shell", "arguments": {"command": "mv old/path new/path"}}
  {"tool": "run_shell", "arguments": {"command": "touch src/index.ts"}}

- **read_file**: Read file contents
  {"tool": "read_file", "arguments": {"path": "src/auth.ts"}}

- **write_file**: Write/overwrite a file completely
  {"tool": "write_file", "arguments": {"path": "src/auth.ts", "content": "..."}}

- **edit_file**: Apply targeted edit (search and replace)
  {"tool": "edit_file", "arguments": {"path": "src/auth.ts", "old": "old code here", "new": "new code here"}}

- **list_files**: List directory contents
  {"tool": "list_files", "arguments": {"path": "src", "recursive": true}}

- **search_files**: Search for patterns in files
  {"tool": "search_files", "arguments": {"pattern": "authMiddleware", "path": "src"}}

- **git_status**: Get git repository status
  {"tool": "git_status", "arguments": {}}

- **git_diff**: Get git diff
  {"tool": "git_diff", "arguments": {"staged": false}}

- **git_commit**: Create a git commit
  {"tool": "git_commit", "arguments": {"message": "fix: resolve auth session handling"}}

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
- Run tests after changes when possible

## Completion

When the task is fully complete, respond with exactly:
DONE: [Clear summary of all changes made and results]

The word DONE: must be at the very start of your final response.`

export const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-[rf]{1,3}\s+[/~]/i,
  /rm\s+--recursive.*--force/i,
  /sudo\s+rm/i,
  /:\(\)\s*\{.*\|.*\}/,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bmkfs\b/i,
  /dd\s+if=.*of=\/dev/i,
  /git\s+push\s+.*--force/i,
  /git\s+reset\s+--hard\s+HEAD~\d+/i,
  /DROP\s+(TABLE|DATABASE)/i,
  /TRUNCATE\s+TABLE/i,
]

export const MAX_AGENT_ITERATIONS = 30

export const BUILTIN_COMMANDS = [
  { cmd: '/connect', description: 'Server verbinden (Popup)' },
  { cmd: '/model', description: 'Model auswählen (Popup)' },
  { cmd: '/config', description: 'Show current configuration' },
  { cmd: '/config model ', description: 'Switch model' },
  { cmd: '/config provider ollama', description: 'Use Ollama (localhost:11434)' },
  { cmd: '/config provider lmstudio', description: 'Use LM Studio (localhost:1234)' },
  { cmd: '/config url ', description: 'Set base URL' },
  { cmd: '/help', description: 'Show help' },
  { cmd: '/models', description: 'List available models' },
  { cmd: '/doctor', description: 'Check system status' },
  { cmd: '/clear', description: 'Clear screen' },
  { cmd: '/exit', description: 'Quit' },
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
