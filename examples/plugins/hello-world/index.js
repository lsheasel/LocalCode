/**
 * hello-world — Minimal LocalCode Plugin Example
 *
 * Install: /plugin install examples/plugins/hello-world
 * Use:     /hello
 *          /hello LocalCode
 */

/** @type {import('../../../src/plugins/PluginLoader').LocalCodePlugin} */
const plugin = {
  name: 'hello-world',
  version: '1.0.0',
  description: 'A minimal example plugin',

  // ── Slash Commands ─────────────────────────────────────────────────────────
  commands: [
    {
      cmd: '/hello ',          // trailing space = accepts arguments
      description: 'Say hello from the plugin',

      /**
       * @param {string} args   Everything the user typed after "/hello"
       * @param {{ cwd: string }} ctx
       * @returns {Promise<import('../../../src/plugins/PluginLoader').PluginCommandResult>}
       */
      async handler(args, ctx) {
        const name = args.trim() || 'World'
        return {
          type: 'text',
          content: `Hello, ${name}!  (cwd: ${ctx.cwd})`,
        }
      },
    },
  ],

  // ── Agent Tools ────────────────────────────────────────────────────────────
  tools: [
    {
      name: 'greet',
      description: 'Return a greeting for the given name',

      /**
       * @param {{ name?: string }} args
       * @param {{ cwd: string }} ctx
       * @returns {Promise<import('../../../src/shared/types').ToolResult>}
       */
      async handler(args, ctx) {
        const name = String(args.name ?? 'World')
        return {
          success: true,
          output: `Hello, ${name}!  (from plugin, cwd: ${ctx.cwd})`,
        }
      },
    },
  ],
}

module.exports = plugin
