# AgentSmithy VSCode Extension

[![GitHub release](https://img.shields.io/github/v/release/AgentSmithyAI/agentsmithy-vscode)](https://github.com/AgentSmithyAI/agentsmithy-vscode/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/AgentSmithyAI/agentsmithy-vscode/actions/workflows/workflow.yaml/badge.svg?branch=master)](https://github.com/AgentSmithyAI/agentsmithy-vscode/actions/workflows/workflow.yaml)
[![codecov](https://codecov.io/gh/AgentSmithyAI/agentsmithy-vscode/branch/master/graph/badge.svg)](https://codecov.io/gh/AgentSmithyAI/agentsmithy-vscode)
[![VSCode Version](https://img.shields.io/badge/VSCode-1.100.0%2B-blue)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## Formatting, Linting & Tests

- ESLint autofix: npm run lint:fix
- Prettier write: npm run format
- Prettier check (CI): npm run format:check
- Unit tests (Vitest):
  - Run once: npm test
  - Watch mode: npm run test:watch
  - Coverage: npm run test:coverage

Prettier ignores build/test output via .prettierignore.

This VSCode extension integrates AgentSmithy AI coding assistant into Visual Studio Code through a native WebView chat interface. Works with any VSCode version, including open source builds (Code-OSS, VSCodium).

## Features

- **Native Chat Interface**: Built-in chat panel in VSCode sidebar
- **AI-powered code assistance**: Get help with coding tasks directly in VSCode
- **File context awareness**: AgentSmithy understands your current file and selection
- **Real-time streaming**: Responses stream in real-time using Server-Sent Events (SSE)
- **Tool usage visibility**: See when AgentSmithy uses tools to read/edit files
- **Diff display**: View file changes as unified diffs in the chat
- **Selection support**: Right-click to send selected code to AgentSmithy

## Prerequisites

- AgentSmithy server running locally (default: http://localhost:8765)
- Any version of Visual Studio Code (including Code-OSS, VSCodium)

## Installation

### Development Mode (Recommended for testing)

1. Clone this repository
2. Run `npm install` to install dependencies
3. Press `F5` in VSCode to launch extension in debug mode
4. Look for AgentSmithy icon in the activity bar (left sidebar)

### Install from VSIX

Build once, then install:

```bash
npm run format && \
npm run lint:fix && \
npm ci && \
npm run compile && \
npx @vscode/vsce package && \
code --install-extension $(ls -t agentsmithy-vscode-*.vsix | head -1) --force
```

Or via UI: `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → select the generated `.vsix`.

## Usage

### Open Chat

- Click the AgentSmithy icon in the activity bar (left sidebar)
- Or use Command Palette: `Ctrl+Shift+P` → `AgentSmithy: Open Chat`

### Move to Secondary Sidebar (Recommended)

Two options:

- Right‑click the AgentSmithy icon in the Activity Bar → "Move to Secondary Side Bar"
- Or `Ctrl+Shift+P` → "Toggle Secondary Side Bar", then drag the "AgentSmithy Chat" view to the right pane

After installing/updating, reload the window: `Ctrl+Shift+P` → "Developer: Reload Window".

### Send Selected Code

1. Select code in the editor
2. Right-click → `Send Selection to AgentSmithy`
3. Or use Command Palette: `Ctrl+Shift+P` → `AgentSmithy: Send Selection`

### Chat Interface

- Type your message in the input field
- Press Enter to send (Shift+Enter for new line)
- View responses with syntax highlighting and formatting
- See tool usage and file edits in real-time

## Configuration

Access settings via `File → Preferences → Settings` → search for "AgentSmithy":

- `agentsmithy.serverUrl`: AgentSmithy server URL (default: "http://localhost:8765")
- `agentsmithy.showReasoning`: Show AI reasoning/thinking process in chat (default: false)

## Troubleshooting

1. **Chat not responding**: Ensure AgentSmithy server is running at configured URL
2. **Connection errors**: Check server URL in settings
3. **No AgentSmithy icon**: Reload VSCode window (`Developer: Reload Window`)

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Copyright 2025 Alexander Morozov
