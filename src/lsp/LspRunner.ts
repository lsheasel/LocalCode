import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface Diagnostic {
  file: string
  line: number
  col: number
  severity: 'error' | 'warning' | 'info'
  message: string
  code?: string
}

export interface LspResult {
  diagnostics: Diagnostic[]
  tool: string
  error?: string
}

export async function lspCheck(workDir: string, targetPath?: string): Promise<LspResult> {
  const target = targetPath ? resolve(workDir, targetPath) : undefined

  if (existsSync(join(workDir, 'tsconfig.json'))) {
    return runTsc(workDir, target)
  }
  if (existsSync(join(workDir, 'Cargo.toml'))) {
    return runCargo(workDir)
  }
  if (existsSync(join(workDir, 'go.mod'))) {
    return runGoVet(workDir, target)
  }
  if (
    existsSync(join(workDir, 'pyproject.toml')) ||
    existsSync(join(workDir, 'setup.py')) ||
    existsSync(join(workDir, 'requirements.txt'))
  ) {
    return runPyflakes(workDir, target)
  }
  if (
    existsSync(join(workDir, '.eslintrc.js')) ||
    existsSync(join(workDir, '.eslintrc.cjs')) ||
    existsSync(join(workDir, '.eslintrc.json')) ||
    existsSync(join(workDir, '.eslintrc.yml'))
  ) {
    return runEslint(workDir, target)
  }

  return { diagnostics: [], tool: 'none', error: 'No supported project detected (tsconfig.json, Cargo.toml, go.mod, setup.py, .eslintrc)' }
}

async function runTsc(workDir: string, targetFile?: string): Promise<LspResult> {
  try {
    const extra = targetFile ? `"${targetFile}"` : ''
    const { stdout } = await execAsync(
      `npx --yes tsc --noEmit --pretty false ${extra} 2>&1 || true`,
      { cwd: workDir, timeout: 30000 }
    )
    return { diagnostics: parseTsc(stdout), tool: 'tsc' }
  } catch (e) {
    return { diagnostics: [], tool: 'tsc', error: String(e) }
  }
}

async function runCargo(workDir: string): Promise<LspResult> {
  try {
    const { stdout, stderr } = await execAsync(
      'cargo check --message-format short 2>&1 || true',
      { cwd: workDir, timeout: 60000 }
    )
    return { diagnostics: parseCargo(stdout + stderr), tool: 'cargo check' }
  } catch (e) {
    return { diagnostics: [], tool: 'cargo check', error: String(e) }
  }
}

async function runGoVet(workDir: string, targetFile?: string): Promise<LspResult> {
  try {
    const target = targetFile ? `"${targetFile}"` : './...'
    const { stdout, stderr } = await execAsync(
      `go vet ${target} 2>&1 || true`,
      { cwd: workDir, timeout: 30000 }
    )
    return { diagnostics: parseGoVet(stdout + stderr), tool: 'go vet' }
  } catch (e) {
    return { diagnostics: [], tool: 'go vet', error: String(e) }
  }
}

async function runPyflakes(workDir: string, targetFile?: string): Promise<LspResult> {
  try {
    const target = targetFile ? `"${targetFile}"` : '.'
    const { stdout, stderr } = await execAsync(
      `python -m pyflakes ${target} 2>&1 || true`,
      { cwd: workDir, timeout: 15000 }
    )
    return { diagnostics: parsePyflakes(stdout + stderr), tool: 'pyflakes' }
  } catch (e) {
    return { diagnostics: [], tool: 'pyflakes', error: String(e) }
  }
}

async function runEslint(workDir: string, targetFile?: string): Promise<LspResult> {
  try {
    const target = targetFile ? `"${targetFile}"` : '.'
    const { stdout } = await execAsync(
      `npx --yes eslint --format json ${target} 2>/dev/null || true`,
      { cwd: workDir, timeout: 20000 }
    )
    return { diagnostics: parseEslint(stdout), tool: 'eslint' }
  } catch (e) {
    return { diagnostics: [], tool: 'eslint', error: String(e) }
  }
}

// ── Parsers ────────────────────────────────────────────────────────────────────

function parseTsc(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  const re = /^(.+)\((\d+),(\d+)\):\s+(error|warning|info)\s+TS\d+:\s+(.+)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    diags.push({ file: m[1].trim(), line: +m[2], col: +m[3], severity: m[4] as Diagnostic['severity'], message: m[5].trim() })
  }
  return diags
}

function parseCargo(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  // Format: file.rs:line:col: error[E0xxx]: message
  const re = /^(.+):(\d+):(\d+):\s+(error|warning|note)\[?[^\]]*\]?:\s+(.+)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    diags.push({ file: m[1].trim(), line: +m[2], col: +m[3], severity: m[4] === 'note' ? 'info' : m[4] as Diagnostic['severity'], message: m[5].trim() })
  }
  return diags
}

function parseGoVet(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  const re = /^(.+):(\d+):(\d+):\s+(.+)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    diags.push({ file: m[1].trim(), line: +m[2], col: +m[3], severity: 'error', message: m[4].trim() })
  }
  return diags
}

function parsePyflakes(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  const re = /^(.+):(\d+):(\d+):\s+(.+)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    diags.push({ file: m[1].trim(), line: +m[2], col: +m[3], severity: 'error', message: m[4].trim() })
  }
  return diags
}

function parseEslint(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  try {
    const results = JSON.parse(output) as Array<{ filePath: string; messages: Array<{ line: number; column: number; severity: number; message: string; ruleId?: string }> }>
    for (const file of results) {
      for (const msg of file.messages ?? []) {
        diags.push({ file: file.filePath, line: msg.line, col: msg.column, severity: msg.severity === 2 ? 'error' : 'warning', message: msg.message, code: msg.ruleId ?? undefined })
      }
    }
  } catch {}
  return diags
}
