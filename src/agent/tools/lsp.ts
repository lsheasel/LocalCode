import { resolve } from 'path'
import { ToolResult } from '../../shared/types'
import { lspCheck } from '../../lsp/LspRunner'

export async function lspCheckTool(targetPath: string, cwd: string): Promise<ToolResult> {
  const resolved = targetPath === '.' ? undefined : resolve(cwd, targetPath)
  const { diagnostics, tool, error } = await lspCheck(cwd, resolved)

  if (error && diagnostics.length === 0) {
    return { success: false, output: '', error }
  }
  if (diagnostics.length === 0) {
    return { success: true, output: `✓ No issues found  (${tool})` }
  }

  const errors   = diagnostics.filter(d => d.severity === 'error').length
  const warnings = diagnostics.filter(d => d.severity === 'warning').length
  const lines = [
    `${tool}: ${errors} error${errors !== 1 ? 's' : ''}, ${warnings} warning${warnings !== 1 ? 's' : ''}`,
    '',
    ...diagnostics.slice(0, 60).map(d =>
      `${d.file}:${d.line}:${d.col}  ${d.severity}  ${d.message}${d.code ? `  [${d.code}]` : ''}`
    ),
  ]
  if (diagnostics.length > 60) lines.push(`… and ${diagnostics.length - 60} more`)

  return {
    success: errors === 0,
    output: lines.join('\n'),
    error: errors > 0 ? `${errors} error(s)` : undefined,
  }
}
