# Bundled Node.js

To ship a single-click installer, the setup includes a portable Node.js runtime.

Steps:

1. Download the Windows x64 ZIP from https://nodejs.org/dist/
2. Extract it to: `vendor/node/`

Expected structure:

- `vendor/node/node.exe`
- `vendor/node/node_modules/`
- `vendor/node/LICENSE`

The installer will copy `vendor/node` into `{app}\node`.
