import { ToolCall, ToolResult } from '../../shared/types'
import { runShell } from './shell'
import {
  readFileTool, writeFileTool, appendFileTool, editFileTool,
  deleteFileTool, moveFileTool, copyFileTool, createDirTool,
  listFilesTool, findFilesTool, searchFilesTool,
} from './filesystem'
import { webFetchTool, httpRequestTool } from './network'
import { lspCheckTool } from './lsp'
import { gitBranchTool, gitStashTool, runTestsTool } from './git'
import { PluginLoader } from '../../plugins/PluginLoader'

export async function executeTool(toolCall: ToolCall, cwd: string): Promise<ToolResult> {
  const { tool, arguments: args } = toolCall
  try {
    switch (tool) {
      // ── Shell ─────────────────────────────────────────────────────────────────
      case 'run_shell':
        return runShell(String(args.command || ''), String(args.cwd || cwd))

      // ── File system ───────────────────────────────────────────────────────────
      case 'read_file':
        return readFileTool(
          String(args.path || ''),
          cwd,
          args.start_line ? Number(args.start_line) : undefined,
          args.end_line   ? Number(args.end_line)   : undefined,
          args.format     ? String(args.format)      : undefined,
        )
      case 'write_file':
        return writeFileTool(String(args.path || ''), String(args.content || ''), cwd)
      case 'append_file':
        return appendFileTool(String(args.path || ''), String(args.content || ''), cwd)
      case 'edit_file':
        return editFileTool(String(args.path || ''), String(args.old || ''), String(args.new || ''), cwd)
      case 'delete_file':
        return deleteFileTool(String(args.path || ''), cwd, Boolean(args.recursive))
      case 'move_file':
        return moveFileTool(String(args.from || ''), String(args.to || ''), cwd)
      case 'copy_file':
        return copyFileTool(String(args.from || ''), String(args.to || ''), cwd)
      case 'create_dir':
        return createDirTool(String(args.path || ''), cwd)
      case 'list_files':
        return listFilesTool(String(args.path || '.'), cwd, Boolean(args.recursive))
      case 'find_files':
        return findFilesTool(String(args.pattern || ''), String(args.path || '.'), cwd)
      case 'search_files':
        return searchFilesTool(String(args.pattern || ''), String(args.path || '.'), cwd)

      // ── Git ───────────────────────────────────────────────────────────────────
      case 'git_status':
        return runShell('git status', cwd)
      case 'git_diff':
        return runShell(args.staged ? 'git diff --staged' : 'git diff', cwd)
      case 'git_log':
        return runShell(`git log --oneline -${Number(args.limit) || 20}`, cwd)
      case 'git_commit':
        return runShell(
          `git add -A && git commit -m ${JSON.stringify(String(args.message || 'chore: update'))}`,
          cwd,
        )
      case 'git_branch':
        return gitBranchTool(String(args.action || 'list'), String(args.name || ''), cwd)
      case 'git_stash':
        return gitStashTool(String(args.action || 'push'), String(args.message || ''), cwd)

      // ── Testing ───────────────────────────────────────────────────────────────
      case 'run_tests':
        return runTestsTool(cwd)

      // ── Network ───────────────────────────────────────────────────────────────
      case 'web_fetch':
        return webFetchTool(String(args.url || ''), String(args.format || 'text'))
      case 'http_request':
        return httpRequestTool(
          String(args.method || 'GET'),
          String(args.url || ''),
          args.headers as Record<string, string> | undefined,
          args.body,
        )

      // ── LSP / Diagnostics ─────────────────────────────────────────────────────
      case 'lsp_check':
        return lspCheckTool(String(args.path || '.'), cwd)

      default: {
        const pluginTool = PluginLoader.getInstance().getTool(tool)
        if (pluginTool) return pluginTool.handler(args, { cwd })
        return { success: false, output: '', error: `Unknown tool: ${tool}` }
      }
    }
  } catch (err) {
    return { success: false, output: '', error: String(err) }
  }
}
