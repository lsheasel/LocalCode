import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
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

// ── ESLint config detection (legacy .eslintrc* and new flat eslint.config.*) ──
function hasEslintConfig(workDir: string): boolean {
  return [
    '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.mjs',
    '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc',
    'eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs',
  ].some(f => existsSync(join(workDir, f)))
}

// ── Find .csproj / .sln files in workDir (non-recursive) ─────────────────────
async function hasDotNet(workDir: string): Promise<boolean> {
  try {
    const entries = await readdir(workDir)
    return entries.some(e => e.endsWith('.csproj') || e.endsWith('.sln') || e.endsWith('.fsproj'))
  } catch { return false }
}

export async function lspCheck(workDir: string, targetPath?: string): Promise<LspResult> {
  const target = targetPath ? resolve(workDir, targetPath) : undefined
  const results: LspResult[] = []

  // ── TypeScript / JavaScript ───────────────────────────────────────────────────
  if (existsSync(join(workDir, 'tsconfig.json'))) {
    results.push(await runTsc(workDir, target))
    if (hasEslintConfig(workDir)) results.push(await runEslint(workDir, target))
  } else if (hasEslintConfig(workDir)) {
    results.push(await runEslint(workDir, target))
  }

  // ── Rust ──────────────────────────────────────────────────────────────────────
  if (existsSync(join(workDir, 'Cargo.toml'))) {
    results.push(await runCargo(workDir))
  }

  // ── Go ────────────────────────────────────────────────────────────────────────
  if (existsSync(join(workDir, 'go.mod'))) {
    results.push(await runGoVet(workDir, target))
  }

  // ── Python ────────────────────────────────────────────────────────────────────
  if (
    existsSync(join(workDir, 'pyproject.toml')) ||
    existsSync(join(workDir, 'setup.py')) ||
    existsSync(join(workDir, 'requirements.txt'))
  ) {
    results.push(await runPython(workDir, target))
  }

  // ── Ruby ──────────────────────────────────────────────────────────────────────
  if (existsSync(join(workDir, 'Gemfile'))) {
    results.push(await runRubocop(workDir, target))
  }

  // ── PHP ───────────────────────────────────────────────────────────────────────
  if (existsSync(join(workDir, 'composer.json'))) {
    results.push(await runPhpLint(workDir, target))
  }

  // ── Java (Maven) ──────────────────────────────────────────────────────────────
  if (existsSync(join(workDir, 'pom.xml'))) {
    results.push(await runMaven(workDir))
  }

  // ── Kotlin / Java (Gradle) ───────────────────────────────────────────────────
  if (existsSync(join(workDir, 'build.gradle')) || existsSync(join(workDir, 'build.gradle.kts'))) {
    results.push(await runGradle(workDir))
  }

  // ── C# / F# (.NET) ───────────────────────────────────────────────────────────
  if (await hasDotNet(workDir)) {
    results.push(await runDotnet(workDir))
  }

  if (results.length === 0) {
    return {
      diagnostics: [],
      tool: 'none',
      error: 'No supported project detected (tsconfig.json, Cargo.toml, go.mod, Gemfile, composer.json, pom.xml, build.gradle, .csproj, pyproject.toml)',
    }
  }

  // Merge all results
  const combined: Diagnostic[] = []
  const tools: string[] = []
  const errors: string[] = []

  for (const r of results) {
    combined.push(...r.diagnostics)
    if (r.tool !== 'none') tools.push(r.tool)
    if (r.error && r.diagnostics.length === 0) errors.push(r.error)
  }

  return {
    diagnostics: combined,
    tool: tools.join(' + ') || 'none',
    error: errors.length > 0 && combined.length === 0 ? errors.join('; ') : undefined,
  }
}

// ── Runners ───────────────────────────────────────────────────────────────────

async function runTsc(workDir: string, targetFile?: string): Promise<LspResult> {
  try {
    const extra = targetFile ? `"${targetFile}"` : ''
    const { stdout } = await execAsync(
      `npx --yes tsc --noEmit --pretty false ${extra} 2>&1 || true`,
      { cwd: workDir, timeout: 30000 },
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
      { cwd: workDir, timeout: 60000 },
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
      { cwd: workDir, timeout: 30000 },
    )
    return { diagnostics: parseGoVet(stdout + stderr), tool: 'go vet' }
  } catch (e) {
    return { diagnostics: [], tool: 'go vet', error: String(e) }
  }
}

async function runPython(workDir: string, targetFile?: string): Promise<LspResult> {
  const target = targetFile ? `"${targetFile}"` : '.'

  // Try ruff first (fast, modern linter)
  try {
    const { stdout } = await execAsync(
      `ruff check --output-format json ${target} 2>/dev/null || true`,
      { cwd: workDir, timeout: 15000 },
    )
    const diags = parseRuff(stdout)
    if (diags.length > 0 || stdout.trim().startsWith('[')) {
      return { diagnostics: diags, tool: 'ruff' }
    }
  } catch {}

  // Fallback to pyflakes
  try {
    const py = await execAsync('python3 --version 2>&1').then(() => 'python3').catch(() => 'python')
    const { stdout, stderr } = await execAsync(
      `${py} -m pyflakes ${target} 2>&1 || true`,
      { cwd: workDir, timeout: 15000 },
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
      { cwd: workDir, timeout: 20000 },
    )
    return { diagnostics: parseEslint(stdout), tool: 'eslint' }
  } catch (e) {
    return { diagnostics: [], tool: 'eslint', error: String(e) }
  }
}

async function runRubocop(workDir: string, targetFile?: string): Promise<LspResult> {
  try {
    const target = targetFile ? `"${targetFile}"` : ''
    const { stdout } = await execAsync(
      `bundle exec rubocop --format json ${target} 2>/dev/null || rubocop --format json ${target} 2>/dev/null || true`,
      { cwd: workDir, timeout: 30000 },
    )
    return { diagnostics: parseRubocop(stdout), tool: 'rubocop' }
  } catch (e) {
    return { diagnostics: [], tool: 'rubocop', error: String(e) }
  }
}

async function runPhpLint(workDir: string, targetFile?: string): Promise<LspResult> {
  const diagnostics: Diagnostic[] = []
  try {
    if (targetFile) {
      const { stdout, stderr } = await execAsync(
        `php -l "${targetFile}" 2>&1 || true`,
        { cwd: workDir, timeout: 10000 },
      )
      diagnostics.push(...parsePhpLint(stdout + stderr, targetFile))
    } else {
      // Scan .php files in workDir (non-recursive for speed)
      const { readdir } = await import('fs/promises')
      let phpFiles: string[] = []
      try {
        const entries = await readdir(workDir)
        phpFiles = entries.filter(e => e.endsWith('.php')).slice(0, 20)
      } catch {}

      for (const file of phpFiles) {
        const { stdout, stderr } = await execAsync(
          `php -l "${join(workDir, file)}" 2>&1 || true`,
          { cwd: workDir, timeout: 5000 },
        )
        diagnostics.push(...parsePhpLint(stdout + stderr, file))
      }
    }
    return { diagnostics, tool: 'php -l' }
  } catch (e) {
    return { diagnostics: [], tool: 'php -l', error: String(e) }
  }
}

async function runMaven(workDir: string): Promise<LspResult> {
  try {
    const { stdout, stderr } = await execAsync(
      'mvn compile -q 2>&1 || true',
      { cwd: workDir, timeout: 120000 },
    )
    return { diagnostics: parseMaven(stdout + stderr), tool: 'mvn compile' }
  } catch (e) {
    return { diagnostics: [], tool: 'mvn compile', error: String(e) }
  }
}

async function runGradle(workDir: string): Promise<LspResult> {
  try {
    const gradle = existsSync(join(workDir, 'gradlew')) ? './gradlew' : 'gradle'
    const { stdout, stderr } = await execAsync(
      `${gradle} compileJava compileKotlin --quiet 2>&1 || true`,
      { cwd: workDir, timeout: 120000 },
    )
    return { diagnostics: parseMaven(stdout + stderr), tool: 'gradle compile' }
  } catch (e) {
    return { diagnostics: [], tool: 'gradle compile', error: String(e) }
  }
}

async function runDotnet(workDir: string): Promise<LspResult> {
  try {
    const { stdout, stderr } = await execAsync(
      'dotnet build --nologo 2>&1 || true',
      { cwd: workDir, timeout: 60000 },
    )
    return { diagnostics: parseDotnet(stdout + stderr), tool: 'dotnet build' }
  } catch (e) {
    return { diagnostics: [], tool: 'dotnet build', error: String(e) }
  }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

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

function parseRuff(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  try {
    const results = JSON.parse(output) as Array<{
      filename: string
      location: { row: number; column: number }
      code: string
      message: string
    }>
    for (const r of results) {
      diags.push({
        file: r.filename,
        line: r.location?.row ?? 1,
        col: r.location?.column ?? 1,
        severity: 'error',
        message: r.message,
        code: r.code,
      })
    }
  } catch {}
  return diags
}

function parseEslint(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  try {
    const results = JSON.parse(output) as Array<{
      filePath: string
      messages: Array<{ line: number; column: number; severity: number; message: string; ruleId?: string }>
    }>
    for (const file of results) {
      for (const msg of file.messages ?? []) {
        diags.push({ file: file.filePath, line: msg.line, col: msg.column, severity: msg.severity === 2 ? 'error' : 'warning', message: msg.message, code: msg.ruleId ?? undefined })
      }
    }
  } catch {}
  return diags
}

function parseRubocop(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  try {
    const result = JSON.parse(output) as {
      files: Array<{
        path: string
        offenses: Array<{ severity: string; message: string; location: { line: number; column: number }; cop_name: string }>
      }>
    }
    for (const file of result.files ?? []) {
      for (const offense of file.offenses ?? []) {
        const sev = offense.severity === 'error' || offense.severity === 'fatal' ? 'error'
          : offense.severity === 'warning' || offense.severity === 'convention' || offense.severity === 'refactor' ? 'warning'
          : 'info'
        diags.push({ file: file.path, line: offense.location?.line ?? 1, col: offense.location?.column ?? 1, severity: sev, message: offense.message, code: offense.cop_name })
      }
    }
  } catch {}
  return diags
}

function parsePhpLint(output: string, file: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  const re = /(?:Parse|Fatal) error:\s+(.+?)\s+in\s+.+?\s+on line\s+(\d+)/gi
  let m
  while ((m = re.exec(output)) !== null) {
    diags.push({ file, line: +m[2], col: 1, severity: 'error', message: m[1].trim() })
  }
  return diags
}

function parseMaven(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  // Java compiler: File.java:[line,col] message
  const re = /\[(?:ERROR|WARNING)\]\s+(.+\.(?:java|kt)(?::\d+)?)?[:\s]+(.+)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    const locMatch = (m[1] || '').match(/^(.+):(\d+)/)
    const severity = output.slice(Math.max(0, output.indexOf(m[0]) - 10), output.indexOf(m[0]) + 10).includes('ERROR') ? 'error' as const : 'warning' as const
    diags.push({
      file: locMatch ? locMatch[1].trim() : (m[1] || '').trim() || 'unknown',
      line: locMatch ? +locMatch[2] : 1,
      col: 1,
      severity,
      message: m[2].trim(),
    })
  }
  return diags
}

function parseDotnet(output: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  // Format: path/File.cs(line,col): error CS0001: message
  const re = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z]+\d+):\s+(.+)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    diags.push({ file: m[1].trim(), line: +m[2], col: +m[3], severity: m[4] as Diagnostic['severity'], message: m[6].trim(), code: m[5] })
  }
  return diags
}
