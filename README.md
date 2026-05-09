# ⚡ ERPCode

Futuristic AI Developer Terminal — autonomous coding agent, AI-powered TUI.

## Install

```bash
npm install
npm run build
npm link          # makes 'erpcode' available globally
```

### Windows Installer (Inno Setup)

1. Build: `npm install` then `npm run build`
2. Bundle Node.js: see `installer/BUNDLE_NODE.md`
3. Open `installer/ERPCodeSetup.iss` in Inno Setup and click Build
4. Run the generated `ERPCodeSetup.exe`

## Usage

```bash
erpcode                                    # Start interactive TUI
erpcode fix auth bug                       # Run AI task directly
erpcode analyze architecture               # Analyze project
erpcode --provider ollama --model llama3   # Override model
```

## Config

`~/.erpcode/config.json` — auto-created on first run.

```json
{
  "llm": {
    "provider": "ollama",
    "model": "deepseek-coder",
    "baseURL": "http://localhost:11434"
  }
}
```

**Providers:** `ollama` · `openai` · `claude` · `openrouter` · `lmstudio`

Set API keys via environment:
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## TUI Controls

| Key | Action |
|-----|--------|
| `Enter` | Submit command / AI task |
| `Tab` | Accept autocomplete |
| `↑ / ↓` | Navigate history |
| `Ctrl+C` | Abort running agent |
| `Ctrl+L` | Clear screen |
| `$ cmd` | Run shell command directly |

## Agent Tools

The AI agent can: `run_shell` · `read_file` · `write_file` · `edit_file` · `list_files` · `search_files` · `git_status` · `git_diff` · `git_commit`

Dangerous commands (`rm -rf`, `sudo`, `shutdown`, etc.) are blocked automatically.

## Dev

```bash
npm run dev      # watch + rebuild
node dist/erpcode.js
```
