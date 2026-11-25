import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const CACHE_FILE = path.join(os.homedir(), '.localcode', 'update-cache.json')
const CHECK_INTERVAL = 1000 * 60 * 60 * 6  // 6 hours

const NPM_PACKAGE  = 'localcode-agent'
const GITHUB_REPO  = 'lsheasel/LocalCode'
/**
 * New versions are published as GitHub releases with the npm package
 * attached (.github/workflows/release-tarball.yml). This URL always points at
 * the newest one, and npm installs it like any other package.
 */
export const INSTALL_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/${NPM_PACKAGE}.tgz`

interface UpdateCache {
  checkedAt: number
  latestVersion: string | null
  installMethod: 'npm' | 'git'
}

export interface UpdateInfo {
  latestVersion: string
  installMethod: 'npm' | 'git'
  updateCommand: string
}

/** One command /update runs, in `cwd`. */
export interface UpdateStep {
  cmd: string
  args: string[]
  cwd?: string
}

// ── Install-method detection ─────────────────────────────────────────────────

/** How this copy was installed, and for a git clone, where the clone is. */
export function installInfo(): { method: 'npm' | 'git'; dir?: string } {
  const script = fs.existsSync(process.argv[1] ?? '') ? fs.realpathSync(process.argv[1]) : process.argv[1] ?? ''

  // npm global installs always have "node_modules" somewhere in the path
  if (script.includes('node_modules')) return { method: 'npm' }

  // If running from a directory that has a .git folder nearby → git clone
  let dir = path.dirname(script)
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return { method: 'git', dir }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Fallback: assume npm
  return { method: 'npm' }
}

function detectInstallMethod(): 'npm' | 'git' {
  return installInfo().method
}

function updateCommandFor(method: 'npm' | 'git'): string {
  if (method === 'git') {
    const dir = installInfo().dir ?? '~/LocalCode'
    return `cd ${dir} && git pull && npm install && npm run build`
  }
  return `npm install -g ${INSTALL_URL}`
}

/** What /update runs, step by step (no shell syntax, so it works in any shell). */
export function updateSteps(): UpdateStep[] {
  const { method, dir } = installInfo()
  if (method === 'git' && dir) {
    return [
      { cmd: 'git', args: ['pull', '--ff-only'], cwd: dir },
      { cmd: 'npm', args: ['install', '--no-audit', '--no-fund'], cwd: dir },
      { cmd: 'npm', args: ['run', 'build'], cwd: dir },
    ]
  }
  return [{ cmd: 'npm', args: ['install', '-g', '--no-audit', '--no-fund', INSTALL_URL] }]
}

// ── Semver helper ────────────────────────────────────────────────────────────

/**
 * "1.2.3" from a version or a release tag. release-please tags look like
 * "localcode-agent-v0.8.1", so a leading "v" is not the only prefix.
 */
export function versionOf(tag: string): string | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(tag)
  return m ? m[0] : null
}

export function semverGt(a: string, b: string): boolean {
  const pa = (versionOf(a) ?? '0.0.0').split('.').map(Number)
  const pb = (versionOf(b) ?? '0.0.0').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return true
    if (na < nb) return false
  }
  return false
}

// ── Cache helpers ────────────────────────────────────────────────────────────

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as UpdateCache
  } catch { return null }
}

function writeCache(data: UpdateCache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8')
  } catch {}
}

// ── Remote version fetchers ──────────────────────────────────────────────────

async function fetchNpmLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`, {
      signal: AbortSignal.timeout(6000),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return typeof data.version === 'string' ? data.version : null
  } catch { return null }
}

async function fetchGitHubLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: AbortSignal.timeout(6000),
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string }
    return typeof data.tag_name === 'string' ? versionOf(data.tag_name) : null
  } catch { return null }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check npm AND GitHub for a newer version.
 * Uses a 6-hour file cache to avoid hammering the registry on every launch.
 * Returns an UpdateInfo if an update is available, otherwise null.
 */
export async function checkForUpdate(currentVersion: string, opts: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  const installMethod = detectInstallMethod()

  // Return cached result if still fresh (and made for the same kind of install)
  const cache = opts.force ? null : readCache()
  if (cache && cache.installMethod === installMethod && Date.now() - cache.checkedAt < CHECK_INTERVAL) {
    if (cache.latestVersion && semverGt(cache.latestVersion, currentVersion)) {
      return {
        latestVersion: cache.latestVersion,
        installMethod: cache.installMethod,
        updateCommand: updateCommandFor(cache.installMethod),
      }
    }
    return null
  }

  // Releases happen on GitHub, and both kinds of install update from there
  // (npm through INSTALL_URL). The npm registry is only a fallback for when
  // GitHub can't be reached.
  const latest = (await fetchGitHubLatest()) ?? (await fetchNpmLatest())

  writeCache({ checkedAt: Date.now(), latestVersion: latest, installMethod })

  if (latest && semverGt(latest, currentVersion)) {
    return {
      latestVersion: latest,
      installMethod,
      updateCommand: updateCommandFor(installMethod),
    }
  }
  return null
}

/** The newest released version, or null when neither GitHub nor npm answers. */
export async function latestVersion(): Promise<string | null> {
  return (await fetchGitHubLatest()) ?? (await fetchNpmLatest())
}
