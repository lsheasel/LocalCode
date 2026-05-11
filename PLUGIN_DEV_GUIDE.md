# LocalCode Plugin Developer Guide

Plugins extend LocalCode with custom **slash commands** (e.g. `/deploy prod`) and custom **agent tools** (callable by the AI during a task). They are plain CommonJS `.js` files — no build step required.

---

## Quick Start

```
~/.localcode/plugins/
└── my-plugin/
    └── index.js    ← entry point (CommonJS)
```

Install via LocalCode:
```
/plugin install ./path/to/my-plugin
```

Or copy manually:
```
mkdir -p ~/.localcode/plugins/my-plugin
cp index.js ~/.localcode/plugins/my-plugin/
```

---

## Plugin Structure

A plugin is a CommonJS module that exports a single object:

```js
/** @type {import('localcode/plugins').LocalCodePlugin} */
const plugin = {
  name:        'my-plugin',   // unique identifier, used as folder name
  version:     '1.0.0',
  description: 'What this plugin does',

  commands: [ /* slash command definitions */ ],
  tools:    [ /* agent tool definitions    */ ],
}

module.exports = plugin
```

Both `commands` and `tools` are optional. A plugin can provide only one, both, or neither.

---

## Slash Commands

Slash commands are triggered by the user in the LocalCode input bar.

```js
commands: [
  {
    cmd: '/deploy ',           // the slash command; trailing space = accepts args
    description: 'Deploy to an environment',

    async handler(args, ctx) {
      // args: string — everything the user typed after "/deploy "
      // ctx:  { cwd: string }

      const env = args.trim() || 'staging'
      // ... your logic ...

      return {
        type: 'text',          // 'text' | 'error' | 'done' | 'command'
        content: `Deployed to ${env}!`,
        title: 'deploy',       // only used when type === 'command'
      }
    },
  },
],
```

### `cmd` naming rules

| Pattern         | Meaning                                    |
|-----------------|--------------------------------------------|
| `/hello`        | Exact command, no arguments                |
| `/hello `       | Command with arguments (trailing space)    |
| `/deploy prod`  | Fixed phrase — matches only that exact text |

### Return types

| `type`      | What LocalCode renders                          |
|-------------|-------------------------------------------------|
| `'text'`    | Plain text output                               |
| `'done'`    | Styled "done" block (green checkmark area)      |
| `'error'`   | Red error line                                  |
| `'command'` | Code-block style panel; use `title` as header   |

---

## Agent Tools

Agent tools are functions the AI can call during a task. Define them in `tools:` and the agent automatically learns about them via the system prompt.

```js
tools: [
  {
    name: 'send_slack',                          // snake_case, used in JSON
    description: 'Send a message to a Slack channel',

    async handler(args, ctx) {
      // args: Record<string, unknown> — parsed from the agent's JSON call
      // ctx:  { cwd: string }

      const channel = String(args.channel ?? '#general')
      const text    = String(args.text    ?? '')
      // ... call Slack API ...

      return {
        success: true,
        output:  `Message sent to ${channel}`,
        // error: 'Something went wrong',  ← set on failure
        // images: ['base64...'],          ← optional screenshots / images
      }
    },
  },
],
```

The agent calls your tool like this:
```json
{"tool": "send_slack", "arguments": {"channel": "#builds", "text": "Build passed!"}}
```

### `ToolResult` shape

```ts
{
  success: boolean
  output:  string          // shown to the agent as the tool result
  error?:  string          // message on failure
  images?: string[]        // base64 images (optional)
}
```

---

## TypeScript Types (JSDoc)

You do not need TypeScript to write plugins, but you can use JSDoc for editor support:

```js
/** @type {import('localcode/plugins').LocalCodePlugin} */
```

Relevant types (from `src/plugins/PluginLoader.ts`):

```ts
interface PluginContext {
  cwd: string
}

interface PluginCommandResult {
  type:    'text' | 'error' | 'done' | 'command'
  content: string
  title?:  string    // only for type === 'command'
}

interface PluginCommand {
  cmd:         string
  description: string
  handler: (args: string, ctx: PluginContext) => Promise<PluginCommandResult>
}

interface PluginTool {
  name:        string
  description: string
  handler: (args: Record<string, unknown>, ctx: PluginContext) => Promise<ToolResult>
}

interface LocalCodePlugin {
  name:         string
  version:      string
  description?: string
  commands?:    PluginCommand[]
  tools?:       PluginTool[]
}
```

---

## Plugin Lifecycle

| Event              | What happens                                                      |
|--------------------|-------------------------------------------------------------------|
| App start          | All plugins in `~/.localcode/plugins/` are loaded automatically   |
| `/plugin install`  | Plugin is copied to the plugin dir and immediately activated      |
| `/plugin remove`   | Plugin folder is deleted; changes take effect immediately         |
| `/plugin reload`   | All plugins are unloaded and re-loaded from disk                  |

---

## Plugin Management Commands

```
/plugin                      List all installed plugins
/plugin install <path>       Install from a folder or .js file
/plugin remove  <name>       Uninstall by plugin name
/plugin reload               Reload all plugins from disk
```

---

## File Layout Options

```
# Option A: single file
~/.localcode/plugins/my-plugin.js

# Option B: directory (recommended for multi-file plugins)
~/.localcode/plugins/my-plugin/
├── index.js       ← entry point (or index.cjs)
├── lib/
│   └── helper.js
└── package.json   ← optional; not required
```

> **Important:** Plugins run as **CommonJS** (`.js` / `.cjs`).  
> Do **not** use ES module syntax (`import` / `export`) — use `require()` and `module.exports`.

---

## Error Handling

If your plugin throws during load, LocalCode records the error and skips the plugin. Run `/plugin list` to see load errors.

In handlers, prefer returning `{ type: 'error', content: '...' }` (commands) or `{ success: false, error: '...' }` (tools) over throwing — this gives the user a clean error message.

---

## Examples

Two ready-to-run example plugins are included:

```
examples/plugins/hello-world/   ← /hello command + "greet" agent tool
examples/plugins/file-stats/    ← /stats command + "file_stats" agent tool
```

Install them:
```
/plugin install examples/plugins/hello-world
/plugin install examples/plugins/file-stats
```

---

## Security Notes

- Plugins run with **full Node.js permissions** in the same process as LocalCode.
- Only install plugins from sources you trust.
- The plugin directory is `~/.localcode/plugins/` — review files there before reloading.
- The agent asks for user confirmation before calling any tool (including plugin tools).

---

## Minimal Complete Example

```js
// ~/.localcode/plugins/time/index.js

const plugin = {
  name:    'time',
  version: '1.0.0',

  commands: [
    {
      cmd:         '/time',
      description: 'Show the current time',
      async handler(_args, _ctx) {
        return { type: 'text', content: new Date().toLocaleTimeString() }
      },
    },
  ],

  tools: [
    {
      name:        'current_time',
      description: 'Returns the current date and time as a string',
      async handler(_args, _ctx) {
        return { success: true, output: new Date().toISOString() }
      },
    },
  ],
}

module.exports = plugin
```

After saving the file, run `/plugin reload` (or restart LocalCode) and type `/time`.
