// Project instructions: a LOCALCODE.md in the project (AGENTS.md as the
// common fallback) plus an optional global one in ~/.localcode. Sent with
// every task so conventions, build commands and preferences don't have to be
// repeated in each prompt.

import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import * as os from 'os'

export const PROJECT_FILES = ['LOCALCODE.md', 'AGENTS.md']
/** Long files are cut: they share the context window with the task. */
const MAX_CHARS = 12_000

export interface Instructions {
  /** Text for the system prompt; empty when there are none. */
  text: string
  /** Files it came from, for the UI. */
  sources: string[]
}

function readSmall(path: string): string | null {
  try {
    if (!statSync(path).isFile()) return null
    const text = readFileSync(path, 'utf8').trim()
    if (!text) return null
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n\n[… cut off — the file is longer]' : text
  } catch {
    return null
  }
}

export function globalInstructionsPath(): string {
  return join(os.homedir(), '.localcode', 'LOCALCODE.md')
}

/** The project file that applies in `dir`, if any. */
export function projectInstructionsPath(dir: string): string | null {
  for (const name of PROJECT_FILES) {
    const p = join(dir, name)
    if (readSmall(p) !== null) return p
  }
  return null
}

export function loadInstructions(dir: string): Instructions {
  const parts: string[] = []
  const sources: string[] = []
  const global = readSmall(globalInstructionsPath())
  if (global) {
    parts.push(`### Your preferences (all projects)\n\n${global}`)
    sources.push('~/.localcode/LOCALCODE.md')
  }
  const projectPath = projectInstructionsPath(dir)
  const project = projectPath ? readSmall(projectPath) : null
  if (project && projectPath) {
    const name = projectPath.slice(dir.length).replace(/^[\\/]/, '')
    parts.push(`### This project (${name})\n\n${project}`)
    sources.push(name)
  }
  return { text: parts.join('\n\n'), sources }
}

/** Starting point for /init. */
export const INSTRUCTIONS_TEMPLATE = `# Project instructions for LocalCode

<!-- Sent to the model with every task. Keep it short and concrete. -->

## About this project
- What it is:
- Main language / framework:

## Commands
- Install: \`npm install\`
- Build: \`npm run build\`
- Test: \`npm test\`

## Conventions
- Code style:
- Where things live:

## Don't
-
`
