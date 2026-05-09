# ⚡ LocalCode

**An AI coding agent that runs entirely in your terminal — no cloud account required.**  
Point it at a local model (Ollama, LM Studio) or any OpenAI-compatible server and start building.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

---

## What it does

LocalCode gives you an autonomous agent that can read your codebase, write and edit files, run shell commands, and commit to git — all from a keyboard-driven terminal UI. You describe the task, the agent does the work, and asks for your confirmation before touching anything destructive.

---

## Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A running **local LLM server** — Ollama or LM Studio (see below)

---

## Quick start

### 1. Install a local model server

**Ollama** (recommended — free, works on Linux / macOS / Windows)

```bash
# Install from https://ollama.com, then run:
ollama serve
ollama pull deepseek-coder   # or any model you prefer
```

**LM Studio** — download the desktop app from [lmstudio.ai](https://lmstudio.ai), load a model, and click **Start Local Server**.

---

### 2. Install LocalCode

```bash
git clone https://github.com/lsheasel/LocalCode.git
cd LocalCode
npm install
npm run build
npm link          # adds 'localcode' to your PATH
```

> **Windows:** use PowerShell or Windows Terminal.  
> **macOS / Linux:** any terminal works.

---

### 3. Run it

```bash
localcode
```

This opens the interactive TUI. Type a task and press `Enter`.

You can also pass a task directly on the command line:

```bash
localcode fix the auth bug in src/auth.ts
localcode add unit tests for the user service
localcode explain the architecture of this project
```

---

## Connecting to a server

Type `/connect` and press `Enter` to open the connection popup:

1. **Choose a provider** — Ollama, LM Studio, or any OpenAI-compatible API
2. **Enter the IP address** — use `localhost` for a server on the same machine
3. **Enter the port** — `11434` for Ollama, `1234` for LM Studio

The connection is saved automatically to `~/.localcode/config.json`.

---

## Switching models

Type `/model` to open the model picker. LocalCode fetches all available models from your server. Use the arrow keys to navigate, `/` to search, and `Enter` to select.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send message / run task |
| `Tab` | Accept autocomplete suggestion |
| `↑ / ↓` | Browse command history |
| `PageUp / PageDown` | Scroll chat history |
| `Ctrl+C` | Stop the running agent |
| `Ctrl+L` | Clear the screen |
| `Esc` | Close popup / cancel input |

**Shell passthrough** — prefix a command with `$` or `!` to run it directly without the agent:

```
$ npm test
! git log --oneline -10
```

---

## Slash commands

Type `/` to open the command picker. All commands are searchable.

| Command | What it does |
|---|---|
| `/connect` | Open the server connection popup |
| `/model` | Pick a model from the server (searchable popup) |
| `/models` | List all available models as plain text |
| `/doctor` | Check server connectivity and current config |
| `/config` | Show the current configuration |
| `/config provider ollama` | Switch to Ollama |
| `/config provider lmstudio` | Switch to LM Studio |
| `/config model <name>` | Set the active model by name |
| `/config url <url>` | Override the server base URL |
| `/config temperature <0–1>` | Adjust model temperature |
| `/clear` | Clear the chat |
| `/exit` | Quit |

---

## Configuration file

Settings live in `~/.localcode/config.json` and are created automatically on first run. You can also edit the file directly:

```json
{
  "llm": {
    "provider": "ollama",
    "model": "deepseek-coder:latest",
    "baseURL": "http://localhost:11434",
    "temperature": 0.1
  }
}
```

**Supported providers:** `ollama` · `lmstudio`

---

## What the agent can do

When you give it a task, the agent can:

- Read and search files in your project
- Write new files or edit existing ones (with a diff preview and confirmation before applying)
- Run shell commands — git, npm, compilers, test runners, anything
- Create git commits

**Safety:** Dangerous operations (`rm -rf`, `sudo`, force-push, database drops) are blocked automatically. File writes and shell commands ask for confirmation before running.

---

## Troubleshooting

**"Ollama is not reachable"**  
Make sure Ollama is running (`ollama serve`) and the URL matches. Run `/doctor` to check.

**"LM Studio is not reachable"**  
Open LM Studio, load a model, and click **Start Local Server**. Default port is `1234`.

**"Model not found"**  
Type `/models` to see what's loaded, then switch with `/model` or `/config model <name>`.

**The TUI looks broken / garbled**  
LocalCode requires a terminal with 256-color and UTF-8 support.  
Use **Windows Terminal** on Windows, or any modern terminal on macOS / Linux (iTerm2, Ghostty, Alacritty, etc.).

---

## Contributing

Contributions are welcome. To get started:

1. Fork the repository and create a branch for your change
2. Install dependencies: `npm install`
3. Start watch mode: `npm run dev`
4. Make your changes in `src/`
5. Test with `node dist/localcode.js`
6. Open a pull request with a clear description of what you changed and why

Please keep pull requests focused — one feature or fix per PR. If you're planning something large, open an issue first to discuss the approach.

---

## License

[MIT](./LICENSE) — free to use, modify, and distribute.
