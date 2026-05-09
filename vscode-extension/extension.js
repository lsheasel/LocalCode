const vscode = require("vscode");

function activate(context) {
  const command = vscode.commands.registerCommand("erpcode.openTerminal", () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const terminal = vscode.window.createTerminal({
      name: "ERPCode",
      cwd: workspaceFolder?.uri.fsPath,
    });

    terminal.show(true);
    terminal.sendText("erpcode", true);
  });

  const view = vscode.window.registerWebviewViewProvider(
    "erpcode.view",
    {
      resolveWebviewView(webviewView) {
        vscode.commands.executeCommand("erpcode.openTerminal");

        webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ERPCode</title>
    <style>
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        padding: 12px;
      }
      .title {
        font-weight: 600;
        margin-bottom: 8px;
      }
      .hint {
        opacity: 0.8;
        margin-bottom: 12px;
      }
    </style>
  </head>
  <body>
    <div class="title">ERPCode</div>
    <div class="hint">Terminal wurde geoeffnet.</div>
  </body>
</html>`;
      },
    }
  );

  context.subscriptions.push(command, view);
}

function deactivate() {}

module.exports = { activate, deactivate };
