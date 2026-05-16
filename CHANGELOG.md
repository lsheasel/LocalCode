# Changelog

<<<<<<< HEAD
## [Unreleased]

### Features

* **LSP integration** — real Language Server Protocol client (`LspClient`, `LspManager`) that communicates with language servers via JSON-RPC over stdin/stdout
* **`lsp_hover` agent tool** — lets the agent query type information and documentation for any symbol at a given file position
* **`lsp_definition` agent tool** — lets the agent resolve where any symbol is defined (file + line)
* **`/lsp hover <file>:<line>:<col>`** slash command — hover info from the LSP server directly in the TUI
* **`/lsp def <file>:<line>:<col>`** slash command — go-to-definition directly in the TUI
* Supported LSP servers: `typescript-language-server` (TS/JS), `rust-analyzer` (Rust), `gopls` (Go), `pylsp` (Python), `clangd` (C/C++)
* Servers start lazily on first use and stay running in the background
=======
## [0.4.0](https://github.com/lsheasel/LocalCode/compare/localcode-agent-v0.3.0...localcode-agent-v0.4.0) (2026-05-14)


### Features

* add plugin management functionality ([9cbfd71](https://github.com/lsheasel/LocalCode/commit/9cbfd71fef9c965cf1ad02dea5e5fd7209f799a1))
>>>>>>> 331793fb4fe6586843678d849e6fb84620b8005e

## [0.3.0](https://github.com/lsheasel/LocalCode/compare/localcode-agent-v0.2.0...localcode-agent-v0.3.0) (2026-05-12)


### Features

* implement plugin system with dynamic loading and management ([5467f9a](https://github.com/lsheasel/LocalCode/commit/5467f9a6a5f87b20282231efc1b08858fe64eea5))

## [0.2.0](https://github.com/lsheasel/LocalCode/compare/localcode-agent-v0.1.10...localcode-agent-v0.2.0) (2026-05-12)


### Features

* add release configuration and manifest files for automated versioning ([d03ae49](https://github.com/lsheasel/LocalCode/commit/d03ae49a5d24f451af6d87a30a903563921316fd))
* enhance tool commands and diagnostics ([efc6304](https://github.com/lsheasel/LocalCode/commit/efc6304cd6970f3b7c997a09e767bdc0e0e22b79))
* Implement configuration management and LLM providers ([2ed6ad3](https://github.com/lsheasel/LocalCode/commit/2ed6ad3263f1c5d7cb69fb5d5f2a8ab5faec96c3))
* implement dynamic app version retrieval and update user agent headers ([768c4fb](https://github.com/lsheasel/LocalCode/commit/768c4fba2d786a14f2ef568a105c8f9fce801788))
