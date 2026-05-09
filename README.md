# ⚡ LocalCode

An AI coding agent that runs entirely in your terminal — no cloud account required. Point it at a local model (Ollama, LM Studio) or any OpenAI-compatible server and start building.

---

## What it does

LocalCode gives you an autonomous agent that can read your codebase, write and edit files, run shell commands, and commit to git — all from a keyboard-driven terminal UI. You describe the task, the agent does the work, and asks for confirmation before touching anything destructive.

---

## Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A running **local LLM server** — Ollama or LM Studio (see below)

---

## Quick start

### 1. Install a local model server

**Ollama** (recommended, free, runs on Linux / macOS / Windows)

```bash
# Install from https://ollama.com, then:
ollama serve
ollama pull deepseek-coder   # or any other model
```

**LM Studio** — download the desktop app from [lmstudio.ai](https://lmstudio.ai), load a model, and click **Start Local Server**.

---

### 2. Install LocalCode

```bash
git clone <this-repo>
cd LocalCode
npm install
npm run build
npm link          # adds 'localcode' to your PATH
```

> **Windows:** run the commands in PowerShell or Windows Terminal.  
> **macOS / Linux:** a regular terminal works fine.

---

### 3. Run it

```bash
localcode
```

That opens the interactive TUI. Type a task and press `Enter`.

You can also run tasks directly without entering the TUI:

```bash
localcode fix the auth bug in src/auth.ts
localcode add unit tests for the user service
localcode explain the architecture of this project
```

---

## Connecting to a server

Press `/connect` inside the TUI (or type `/connect` and hit Enter) to open the connection popup:

1. **Choose a provider** — Ollama, LM Studio, or any OpenAI-compatible API
2. **Enter the IP address** — use `localhost` for a server on the same machine
3. **Enter the port** — default is `11434` for Ollama and `1234` for LM Studio

The connection is saved automatically.

---

## Switching models

Type `/model` to open the model picker. LocalCode fetches the list of available models from your server and lets you search and select with the arrow keys.

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

**Shell passthrough** — prefix any command with `$` or `!` to run it directly in your shell without the agent:

```
$ npm test
! git log --oneline -10
```

---

## Slash commands

Type `/` to see all available commands. Highlights:

| Command | What it does |
|---|---|
| `/connect` | Open the server connection popup |
| `/model` | Pick a model from the server |
| `/models` | List all available models as text |
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

Settings are stored in `~/.localcode/config.json` and are created automatically on first run. You can edit it by hand if needed:

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

**Providers:** `ollama` · `lmstudio`

---

## What the agent can do

When you give it a task, the agent can:

- Read and search files in your project
- Write new files or edit existing ones (with a diff preview before applying)
- Run shell commands (git, npm, compilers, test runners, …)
- Create git commits

Dangerous operations — like `rm -rf`, `sudo`, force-push, or database drops — are blocked automatically. Write and shell operations ask for your confirmation before running.

---

## Troubleshooting

**"Ollama is not reachable"**  
Make sure Ollama is running: `ollama serve`. Then check the URL with `/doctor`.

**"LM Studio is not reachable"**  
Open LM Studio, load a model, and click **Start Local Server**. The default port is `1234`.

**"Model not found"**  
Run `/models` to see what's available, then switch with `/model` or `/config model <name>`.

**The TUI looks broken / garbled**  
LocalCode needs a terminal that supports 256 colors and UTF-8. Use Windows Terminal on Windows, or any modern terminal on macOS / Linux.

---

## Development

```bash
npm run dev        # watch mode — rebuilds on every file change
node dist/localcode.js   # run the built output directly
```
