import * as os from 'os'
import { AppConfig } from './types'

// LLM prompts live in ./prompts.ts — this file is configuration and lookup data.

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
  disabledPlugins: [],
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

export const MAX_AGENT_ITERATIONS = 30

export const BUILTIN_COMMANDS = [
  // Most used first: this order is what the / menu and ctrl+p show.
  { cmd: '/help',                 description: 'Show help' },
  { cmd: '/model',                description: 'Select model (popup)' },
  { cmd: '/connect',              description: 'Connect to server (popup)' },
  { cmd: '/init',                 description: 'Create LOCALCODE.md with project instructions' },
  { cmd: '/continue',             description: 'Pick up the last session in this folder' },
  { cmd: '/undo',                 description: 'Revert the last file change' },
  { cmd: '/undo all',             description: 'Revert every file change of the last task' },
  { cmd: '/compact',              description: 'Summarize & compress conversation' },
  { cmd: '/attach',               description: 'Attach file or image (@-picker)' },
  { cmd: '/models',               description: 'List available models' },
  { cmd: '/session',              description: 'List saved sessions' },
  { cmd: '/session save ',        description: 'Save session as <name>' },
  { cmd: '/session load ',        description: 'Load session <name>' },
  { cmd: '/session delete ',      description: 'Delete session <name>' },
  { cmd: '/config',               description: 'Show current configuration' },
  { cmd: '/config model ',        description: 'Switch model' },
  { cmd: '/config provider ollama',   description: 'Use Ollama (localhost:11434)' },
  { cmd: '/config provider lmstudio', description: 'Use LM Studio (localhost:1234)' },
  { cmd: '/config url ',          description: 'Set base URL' },
  { cmd: '/doctor',               description: 'Check system status' },
  { cmd: '/lsp',                  description: 'Run diagnostics (tsc/eslint/cargo/go vet/ruff/rubocop/dotnet/…)' },
  { cmd: '/trust',                description: 'Trust a folder — auto-approve all write ops inside it' },
  { cmd: '/trust remove ',        description: 'Remove trust from a folder' },
  { cmd: '/plugin',               description: 'Manage plugins (list/install/remove/reload)' },
  { cmd: '/plugin install ',      description: 'Install plugin from path' },
  { cmd: '/plugin remove ',       description: 'Remove plugin by name' },
  { cmd: '/plugin reload',        description: 'Reload all plugins' },
  { cmd: '/plugin enable ',       description: 'Enable a disabled plugin' },
  { cmd: '/plugin disable ',      description: 'Disable a plugin without removing it' },
  { cmd: '/lsp hover ',           description: 'Hover info at file:line:col  (e.g. /lsp hover src/auth.ts:42:15)' },
  { cmd: '/lsp def ',             description: 'Go-to-definition at file:line:col' },
  { cmd: '/model reset',          description: 'Use the default model again in this mode' },
  { cmd: '/debug',                description: 'Toggle debug mode — shows full tool args and trust decisions' },
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
