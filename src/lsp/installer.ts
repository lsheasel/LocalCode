// Language servers on demand.
//
// lsp_hover / lsp_definition need a language server for the file's language.
// Most people don't have one installed, so the first time one is needed it is
// fetched with the tool that language already uses (npm, pip, go, rustup).
// npm packages go into ~/.localcode/lsp, not the global npm folder.

import { spawn, execFile } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, delimiter } from 'path'

export const LSP_DIR = join(homedir(), '.localcode', 'lsp')

/** How to start a server: the program and the arguments before its own. */
export interface ServerCommand {
  command: string
  args: string[]
  /** Sent with "initialize" (typescript-language-server: where TypeScript is). */
  initOptions?: Record<string, unknown>
}

interface Recipe {
  /** Shown to the user. */
  label: string
  /** Where an installed copy that works for `workDir` is found, or null. */
  find(workDir?: string): Promise<ServerCommand | null>
  /** The install steps, or why it cannot be installed here. */
  install(): Promise<{ steps: Array<{ cmd: string; args: string[] }> } | { reason: string }>
}

/** Progress of installs, for the UI: 'start' (name), 'output' (name, chunk), 'done' (name, ok, message). */
export const lspInstallEvents = new EventEmitter()

const isWin = process.platform === 'win32'

/** A program on PATH (with Windows' .cmd/.exe endings), or null. */
export function onPath(program: string): string | null {
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : ['']
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, program + ext)
      if (existsSync(full)) return full
    }
  }
  return null
}

function output(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout.trim()))
  })
}

/** "python" that really is Python 3 (Windows' store alias is not). */
async function python(): Promise<string | null> {
  for (const p of isWin ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    if (!onPath(p)) continue
    const v = await output(p, ['--version'])
    if (v && /Python 3/.test(v)) return p
  }
  return null
}

const npmBin = (name: string) => join(LSP_DIR, 'node_modules', '.bin', isWin ? `${name}.cmd` : name)

const RECIPES: Record<string, Recipe> = {
  typescript: {
    label: 'typescript-language-server',
    async find(workDir) {
      // LocalCode's own copy comes with TypeScript, so it works in any project.
      const tsserver = join(LSP_DIR, 'node_modules', 'typescript', 'lib', 'tsserver.js')
      if (existsSync(npmBin('typescript-language-server')) && existsSync(tsserver)) {
        return { command: npmBin('typescript-language-server'), args: [], initOptions: { tsserver: { path: tsserver } } }
      }
      // One on PATH needs TypeScript in the project itself.
      const p = onPath('typescript-language-server')
      if (p && (!workDir || existsSync(join(workDir, 'node_modules', 'typescript')))) return { command: p, args: [] }
      return null
    },
    async install() {
      if (!onPath('npm')) return { reason: 'npm is not installed' }
      mkdirSync(LSP_DIR, { recursive: true })
      return {
        steps: [{
          cmd: 'npm',
          args: ['install', '--prefix', LSP_DIR, '--no-audit', '--no-fund', '--loglevel=error', 'typescript-language-server', 'typescript@5'],
        }],
      }
    },
  },
  pylsp: {
    label: 'python-lsp-server',
    async find() {
      const p = onPath('pylsp')
      if (p) return { command: p, args: [] }
      const py = await python()
      if (py && (await output(py, ['-m', 'pylsp', '--version'])) !== null) return { command: py, args: ['-m', 'pylsp'] }
      return null
    },
    async install() {
      const py = await python()
      if (!py) return { reason: 'Python 3 is not installed' }
      return { steps: [{ cmd: py, args: ['-m', 'pip', 'install', '--user', '--quiet', 'python-lsp-server'] }] }
    },
  },
  gopls: {
    label: 'gopls',
    async find() {
      const p = onPath('gopls')
      if (p) return { command: p, args: [] }
      const gopath = onPath('go') ? await output('go', ['env', 'GOPATH']) : null
      const bin = gopath ? join(gopath, 'bin', isWin ? 'gopls.exe' : 'gopls') : ''
      return bin && existsSync(bin) ? { command: bin, args: [] } : null
    },
    async install() {
      if (!onPath('go')) return { reason: 'Go is not installed' }
      return { steps: [{ cmd: 'go', args: ['install', 'golang.org/x/tools/gopls@latest'] }] }
    },
  },
  'rust-analyzer': {
    label: 'rust-analyzer',
    async find() {
      const which = onPath('rustup') ? await output('rustup', ['which', 'rust-analyzer']) : null
      if (which && existsSync(which)) return { command: which, args: [] }
      const p = onPath('rust-analyzer')
      // rustup puts a proxy on PATH even when the component is missing.
      return p && !onPath('rustup') ? { command: p, args: [] } : null
    },
    async install() {
      if (!onPath('rustup')) return { reason: 'rustup is not installed' }
      return { steps: [{ cmd: 'rustup', args: ['component', 'add', 'rust-analyzer'] }] }
    },
  },
  clangd: {
    label: 'clangd',
    async find() {
      const p = onPath('clangd')
      return p ? { command: p, args: [] } : null
    },
    async install() {
      return { reason: 'clangd comes with LLVM; install it from your package manager (e.g. winget install LLVM.LLVM)' }
    },
  },
}

/** Server names that can be looked up / installed. */
export const KNOWN_SERVERS = Object.keys(RECIPES)

export function serverLabel(name: string): string {
  return RECIPES[name]?.label ?? name
}

/** The installed server, if there is one. */
export async function findServer(name: string, workDir?: string): Promise<ServerCommand | null> {
  return (await RECIPES[name]?.find(workDir)) ?? null
}

function runStep(name: string, cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    const take = (d: Buffer) => {
      const text = d.toString('utf8')
      out = (out + text).slice(-4000)
      lspInstallEvents.emit('output', name, text)
    }
    try {
      // npm and friends are .cmd files on Windows, which need a shell.
      const p = spawn(cmd, args, { shell: isWin, windowsHide: true, timeout: 5 * 60_000 })
      p.stdout?.on('data', take)
      p.stderr?.on('data', take)
      p.on('error', (e) => resolve({ ok: false, out: e.message }))
      p.on('close', (code) => resolve({ ok: code === 0, out }))
    } catch (e) {
      resolve({ ok: false, out: String(e) })
    }
  })
}

const installing = new Map<string, Promise<ServerCommand | null>>()

/**
 * Install a server and return how to start it. Several callers asking at
 * once share one install.
 */
export function installServer(name: string, workDir?: string): Promise<ServerCommand | null> {
  const running = installing.get(name)
  if (running) return running
  const job = (async () => {
    const recipe = RECIPES[name]
    if (!recipe) return null
    lspInstallEvents.emit('start', name)
    const plan = await recipe.install()
    if ('reason' in plan) {
      lspInstallEvents.emit('done', name, false, `${recipe.label} can't be installed automatically: ${plan.reason}.`)
      return null
    }
    for (const step of plan.steps) {
      const r = await runStep(name, step.cmd, step.args)
      if (!r.ok) {
        const last = r.out.trim().split('\n').slice(-3).join('\n')
        lspInstallEvents.emit('done', name, false, `Installing ${recipe.label} failed${last ? `:\n${last}` : '.'}`)
        return null
      }
    }
    const found = await recipe.find(workDir)
    lspInstallEvents.emit(
      'done',
      name,
      !!found,
      found ? `Installed ${recipe.label}.` : `${recipe.label} was installed but can't be found. Is its folder on PATH?`,
    )
    return found
  })().finally(() => installing.delete(name))
  installing.set(name, job)
  return job
}
