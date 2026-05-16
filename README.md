<p align="center">
  <img src="logo.png" width="120" alt="LocalCode" />
</p>

# ⚡ LocalCode

**An AI coding agent that runs entirely in your terminal — no cloud account required.**  
Point it at a local model (Ollama, LM Studio) and start building.

![npm](https://img.shields.io/npm/v/localcode-agent)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

---

## What it does

LocalCode is an autonomous AI coding agent with a keyboard-driven terminal UI. Describe a task — the agent reads your codebase, edits files, runs commands, and commits to git. Every write operation shows a diff preview and asks for confirmation before applying.

---

## Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A running **local LLM server** — Ollama or LM Studio

---

## Install

```bash
npm install -g localcode-agent
```

Then run it inside any project:

```bash
localcode
```

---

## Quick start

### 1. Start a local model server

**Ollama** (recommended — free, Linux / macOS / Windows)

```bash
# Install from https://ollama.com, then:
ollama serve
ollama pull deepseek-coder
```

**LM Studio** — download from [lmstudio.ai](https://lmstudio.ai), load a model, click **Start Local Server**.

---

### 2. Connect

On first launch, type `/connect` to open the connection popup, pick your provider, and enter the address. The config is saved to `~/.localcode/config.json`.

---

### 3. Give it a task

```bash
localcode fix the auth bug in src/auth.ts
localcode add unit tests for the user service
localcode explain the architecture of this project
```

Or just open the TUI and type naturally.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send message / run task |
| `Tab` | Autocomplete or toggle BUILD ↔ PLAN mode |
| `↑ / ↓` | Browse input history (or scroll chat when input is empty) |
| `PageUp / PageDown` | Scroll chat history |
| `Ctrl+C` | Abort running agent / quit |
| `Ctrl+L` | Clear chat |
| `Ctrl+K` | Clear input line |
| `Esc` | Close popup / cancel |

**Shell passthrough** — prefix a command with `$` or `!` to run it directly:

```
$ npm test
! git log --oneline -10
```

**Inject a message while the agent is running** — just type and press Enter. Short messages are sent to the agent immediately; longer ones are queued and run after the current task finishes.

---

## Slash commands

Type `/` to open the searchable command picker.

| Command | What it does |
|---|---|
| `/connect` | Open the server connection popup |
| `/model` | Pick a model (searchable popup) |
| `/models` | List all available models |
| `/doctor` | Check server connectivity and config |
| `/trust <path>` | Trust a folder — auto-approve all write ops inside it |
| `/trust` | List all trusted paths |
| `/trust remove <path>` | Remove trust from a folder |
| `/config` | Show current configuration |
| `/config provider ollama` | Switch to Ollama |
| `/config provider lmstudio` | Switch to LM Studio |
| `/config model <name>` | Set the active model |
| `/config url <url>` | Override the server base URL |
| `/config temperature <0–1>` | Adjust model temperature |
| `/attach` | Attach a file or image to your message |
| `/compact` | Summarize and compress the conversation history |
| `/session save <name>` | Save the current session |
| `/session load <name>` | Restore a saved session |
| `/lsp` | Run diagnostics — tsc, eslint, cargo check, go vet, ruff/pyflakes, rubocop, dotnet build |
| `/lsp hover <file>:<line>:<col>` | Hover info for a symbol via the LSP server (e.g. type, signature, docs) |
| `/lsp def <file>:<line>:<col>` | Jump to definition — returns the file and line where a symbol is defined |
| `/plugin` | List installed plugins |
| `/plugin install <path>` | Install a plugin |
| `/clear` | Clear the chat |
| `/exit` | Quit |

---

## Confirmation & trust

Every file write and shell command asks for confirmation before running:

```
Allow  Write file: src/auth.ts
[y] yes  /  [n] no  /  [t] trust folder
```

- **`y`** — approve once
- **`t`** — trust the folder permanently (all future ops in this path and subfolders are auto-approved, including new files)
- **`n`** — deny

Dangerous operations (`rm -rf`, `sudo`, force-push, etc.) always require explicit confirmation even in trusted folders.

Manage trusted paths:
```
/trust .                  # trust current directory
/trust /home/user/project # trust absolute path
/trust                    # list all trusted paths
/trust remove <path>      # remove trust
```

---

## BUILD vs PLAN mode

Press `Tab` (with empty input) to toggle between modes:

- **BUILD** — agent uses tools, edits files, runs commands
- **PLAN** — agent thinks through the task and returns a structured plan without touching anything

---

## File reading

The agent reads entire files. For large files it shows the total line count and supports ranged reads:

```json
{"tool": "read_file", "arguments": {"path": "src/big.ts", "start_line": 100, "end_line": 200}}
```

---

## Conversation history & context

The last 20 turns (40 messages) are kept in context and sent to the model each iteration. Use `/compact` to summarize and free up context when working on long tasks.

---

## Discord Rich Presence

LocalCode shows your current status in Discord ("Idle", "Thinking…", "Running agent") with the active folder name and elapsed time.

It connects automatically to Discord if it is running. No setup needed for users — just install and go.

---

## Configuration file

`~/.localcode/config.json` is created automatically. Direct editing is supported:

```json
{
  "llm": {
    "provider": "ollama",
    "model": "deepseek-coder:latest",
    "baseURL": "http://localhost:11434",
    "temperature": 0.1
  },
  "trustedPaths": [
    "/home/user/projects/myapp"
  ]
}
```

---

## What the agent can do

- Read, write, edit, move, copy, delete files
- Search inside files (grep) and find files by pattern
- Run any shell command (PowerShell on Windows, bash on Linux/macOS)
- Create git commits
- Fetch URLs and make HTTP requests
- Run LSP diagnostics (tsc, cargo check, go vet, ruff/pyflakes, eslint, rubocop, dotnet build, and more)
- Get hover info and jump-to-definition via real LSP servers (typescript-language-server, rust-analyzer, gopls, pylsp, clangd)
- Retry automatically on errors and try alternative approaches when a tool fails

---

## Error recovery

If the LLM stream fails, the agent retries up to 3 times automatically. If a tool returns an error, the model is told to try a different approach and continue rather than stopping.

---

## Plugins

LocalCode supports plugins — Node.js modules that add custom slash commands and tools.

```bash
/plugin install ./my-plugin.js
/plugin list
/plugin remove my-plugin
```

---

## Troubleshooting

**"Ollama is not reachable"**  
Run `ollama serve` and check the URL with `/doctor`.

**"LM Studio is not reachable"**  
Load a model in LM Studio and click **Start Local Server** (default port 1234).

**"Model not found"**  
Use `/models` to list loaded models, `/model` to switch.

**TUI looks broken / garbled**  
Requires a UTF-8 terminal with 256-color support.  
Use **Windows Terminal** on Windows, or any modern terminal on macOS / Linux (iTerm2, Ghostty, Alacritty, kitty, etc.).

---

## Language Intelligence (LSP)

LocalCode integrates with real **Language Server Protocol** servers to give the agent (and you) IDE-quality language intelligence — the same engine powering VS Code, Neovim, and others.

### What it does

| Feature | Description |
|---|---|
| **Diagnostics** (`/lsp`) | Runs errors and warnings via CLI tools (tsc, eslint, cargo check, …) |
| **Hover** (`/lsp hover`) | Gets the type, signature, or docs for any symbol |
| **Go-to-definition** (`/lsp def`) | Finds where any symbol is defined |

The agent also has access to `lsp_hover` and `lsp_definition` as tools — it can look up types and definitions on its own while working.

### Supported LSP servers

| Language | Server | Install |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `npm install -g typescript-language-server typescript` |
| Rust | `rust-analyzer` | [rust-analyzer.github.io](https://rust-analyzer.github.io) |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Python | `pylsp` | `pip install python-lsp-server` |
| C / C++ | `clangd` | [clangd.llvm.org](https://clangd.llvm.org) |

Servers are **optional** — if none is installed for a language, `/lsp` still works via CLI tools. Hover and definition require the LSP server to be installed and on your `PATH`.

### Usage

```
# Run diagnostics (CLI-based, always works):
/lsp
/lsp src/auth.ts

# Hover — get type info for the symbol at line 42, col 15:
/lsp hover src/auth.ts:42:15

# Go-to-definition — find where a symbol is defined:
/lsp def src/auth.ts:42:15
```

LSP servers start automatically on the first request and stay running in the background for fast subsequent calls.

---

## Contributing

1. Fork and create a branch
2. `npm install`
3. `npm run dev` — watch mode
4. Edit files in `src/`
5. Test with `node dist/localcode.js`
6. Open a focused pull request (one feature or fix per PR)

---

## License

[MIT](./LICENSE) — free to use, modify, and distribute.
