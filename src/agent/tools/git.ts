import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { ToolResult } from '../../shared/types'
import { runShell } from './shell'

export async function gitBranchTool(action: string, name: string, cwd: string): Promise<ToolResult> {
  switch (action) {
    case 'create':
      if (!name) return { success: false, output: '', error: 'Branch name required' }
      return runShell(`git checkout -b ${JSON.stringify(name)}`, cwd)
    case 'checkout':
      if (!name) return { success: false, output: '', error: 'Branch name required' }
      return runShell(`git checkout ${JSON.stringify(name)}`, cwd)
    case 'delete':
      if (!name) return { success: false, output: '', error: 'Branch name required' }
      return runShell(`git branch -d ${JSON.stringify(name)}`, cwd)
    default:
      return runShell('git branch -a', cwd)
  }
}

export async function gitStashTool(action: string, message: string, cwd: string): Promise<ToolResult> {
  switch (action) {
    case 'pop':  return runShell('git stash pop', cwd)
    case 'list': return runShell('git stash list', cwd)
    case 'drop': return runShell('git stash drop', cwd)
    default: {
      const msg = message ? ` push -m ${JSON.stringify(message)}` : ''
      return runShell(`git stash${msg}`, cwd)
    }
  }
}

export async function runTestsTool(cwd: string): Promise<ToolResult> {
  if (existsSync(join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8'))
      if (pkg.scripts?.test) return runShell('npm test', cwd)
    } catch {}
  }
  if (existsSync(join(cwd, 'Cargo.toml'))) return runShell('cargo test', cwd)
  if (existsSync(join(cwd, 'go.mod')))     return runShell('go test ./...', cwd)
  if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml')))
    return runShell('python3 -m pytest', cwd)
  if (existsSync(join(cwd, 'pom.xml')))    return runShell('mvn test -q', cwd)
  if (existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts')))
    return runShell('./gradlew test', cwd)

  return { success: false, output: '', error: 'No test runner detected. Run tests manually with run_shell.' }
}
