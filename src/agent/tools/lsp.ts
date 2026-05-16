import { resolve } from 'path'
import { ToolResult } from '../../shared/types'
import { lspCheck } from '../../lsp/LspRunner'
import { LspManager } from '../../lsp/LspManager'

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

export async function lspHoverTool(filePath: string, line: number, col: number, cwd: string): Promise<ToolResult> {
  try {
    const result = await LspManager.getInstance().hover(filePath, line, col, cwd)
    if (!result) {
      return {
        success: false,
        output: '',
        error: 'No LSP server available for this file type, or no hover info at this position.\nMake sure typescript-language-server / rust-analyzer / gopls / pylsp is installed.',
      }
    }
    return { success: true, output: `[${result.server}]\n${result.text}` }
  } catch (e) {
    return { success: false, output: '', error: String(e) }
  }
}

export async function lspDefinitionTool(filePath: string, line: number, col: number, cwd: string): Promise<ToolResult> {
  try {
    const result = await LspManager.getInstance().definition(filePath, line, col, cwd)
    if (!result) {
      return {
        success: false,
        output: '',
        error: 'No LSP server available for this file type, or no definition found at this position.',
      }
    }
    return {
      success: true,
      output: `[${result.server}] Defined in: ${result.targetFile}:${result.targetLine}`,
    }
  } catch (e) {
    return { success: false, output: '', error: String(e) }
  }
}
