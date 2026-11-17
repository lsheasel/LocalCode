# Release notes

Release notes come from two places. Both are optional, but together they make a release worth reading.

## 1. Commit messages: the list of changes

release-please turns every conventional commit since the last release into one line of the changelog. One commit can carry several lines: put each change on its own line in the message body, separated by blank lines.

```
feat(agent): web_search tool to find real pages (DuckDuckGo, no API key)

feat(tui): command palette on ctrl+p for commands, models, sessions and files

fix(agent): ctrl+c cancels the request on the model server
```

Write each line for someone who uses LocalCode, not for someone who reads the code: what they can do now, or what no longer goes wrong. "add tests for X" tells a user nothing; "fix: Y no longer crashes" does.

| Type | Section in the notes |
|---|---|
| `feat` | ✨ Features |
| `fix` | 🐛 Bug Fixes |
| `perf` | ⚡ Performance |
| `docs` | 📖 Documentation |
| `refactor`, `test`, `build`, `ci` | 🔧 Under the hood |
| `chore` | not shown |

## 2. Highlights: the story

For a bigger release, add `.github/release-notes/<version>.md` (for example `0.9.0.md`) before merging the release PR. When the release is created, the workflow puts it above the generated list. Good highlights open with one or two sentences on what the release is about, show a GIF or screenshot, and explain the three to five changes people will notice most.

The version is the one in the open release PR's title.
