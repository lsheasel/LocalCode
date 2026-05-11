/**
 * file-stats — Plugin with a useful agent tool
 *
 * Install: /plugin install examples/plugins/file-stats
 *
 * Adds a "file_stats" agent tool + a "/stats " slash command.
 */

const fs = require('fs')
const path = require('path')

/** @type {import('../../../src/plugins/PluginLoader').LocalCodePlugin} */
const plugin = {
  name: 'file-stats',
  version: '1.0.0',
  description: 'Reports line/word/char counts for a file',

  commands: [
    {
      cmd: '/stats ',
      description: 'Show line/word/char count for a file',
      async handler(args, ctx) {
        const filePath = path.resolve(ctx.cwd, args.trim())
        if (!fs.existsSync(filePath)) {
          return { type: 'error', content: `File not found: ${filePath}` }
        }
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines   = content.split('\n').length
        const words   = content.split(/\s+/).filter(Boolean).length
        const chars   = content.length
        return {
          type: 'command',
          title: 'file-stats',
          content: [
            `  file  : ${filePath}`,
            `  lines : ${lines}`,
            `  words : ${words}`,
            `  chars : ${chars}`,
          ].join('\n'),
        }
      },
    },
  ],

  tools: [
    {
      name: 'file_stats',
      description: 'Count lines, words and characters of a file',
      async handler(args, ctx) {
        const filePath = path.resolve(ctx.cwd, String(args.path ?? ''))
        if (!fs.existsSync(filePath)) {
          return { success: false, output: '', error: `File not found: ${filePath}` }
        }
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines   = content.split('\n').length
        const words   = content.split(/\s+/).filter(Boolean).length
        const chars   = content.length
        return {
          success: true,
          output: `${filePath}: ${lines} lines, ${words} words, ${chars} chars`,
        }
      },
    },
  ],
}

module.exports = plugin
