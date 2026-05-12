import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

let cachedVersion: string | null = null

export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion

  // Walk upward from this file to find package.json (works in src/ and dist/).
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf8')
        const parsed = JSON.parse(raw) as { version?: string }
        if (parsed.version) {
          cachedVersion = parsed.version
          return cachedVersion
        }
      } catch {
        // Ignore and keep walking upward.
      }
    }

    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  cachedVersion = '0.0.0'
  return cachedVersion
}
