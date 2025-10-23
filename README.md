# AgentSmithy VSCode Extension

[![GitHub release](https://img.shields.io/github/v/release/AgentSmithyAI/agentsmithy-vscode)](https://github.com/AgentSmithyAI/agentsmithy-vscode/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/AgentSmithyAI/agentsmithy-vscode/actions/workflows/workflow.yaml/badge.svg?branch=master)](https://github.com/AgentSmithyAI/agentsmithy-vscode/actions/workflows/workflow.yaml)
[![codecov](https://codecov.io/gh/AgentSmithyAI/agentsmithy-vscode/branch/master/graph/badge.svg)](https://codecov.io/gh/AgentSmithyAI/agentsmithy-vscode)
[![VSCode Version](https://img.shields.io/badge/VSCode-1.100.0%2B-blue)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

VSCode interface for [AgentSmithy](https://github.com/AgentSmithyAI/agentsmithy-agent) - AI coding assistant that writes code for you.

Ask it to implement features, refactor code, fix bugs, or explain how something works. It understands your codebase and makes changes directly in your files.

Supports Code-OSS, VSCodium, and any VSCode fork.

Requires [AgentSmithy server](https://github.com/AgentSmithyAI/agentsmithy-agent) running locally.

## Prerequisites

- [AgentSmithy server](https://github.com/AgentSmithyAI/agentsmithy-agent) running locally (default: http://localhost:8765)
- Any version of Visual Studio Code (including Code-OSS, VSCodium)

### Setting up AgentSmithy server

1. Download binary from [releases page](https://github.com/AgentSmithyAI/agentsmithy-agent/releases)

2. Make it executable:
   ```bash
   chmod +x agentsmithy
   ```

3. Configure OpenAI API key:
   
   Via environment variable:
   ```bash
   export OPENAI_API_KEY=your_key_here
   ```
   
   Or directly in `<your-project>/.agentsmithy/config.json` providers section:
   ```json
   "providers": {
     "gpt5": {
       "type": "openai",
       "model": "gpt-4o",
       "api_key": "your_key_here"
     }
   }
   ```

4. Start the server:
   ```bash
   ./agentsmithy --workdir /path/to/your/project --ide vscode
   ```

Server will start on `http://localhost:8765`. All project data (conversation history, code index, config) is stored in `<your-project>/.agentsmithy/`.

See [server documentation](https://github.com/AgentSmithyAI/agentsmithy-agent#readme) for details.

## Installation

### From VSIX

```bash
npm run format && npm run lint:fix && npm ci && npm run compile && npx @vscode/vsce package
code --install-extension $(ls -t agentsmithy-vscode-*.vsix | head -1) --force
```

Or install manually: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`

### Development

1. Clone the repository
2. Run `npm install`
3. Press `F5` to launch in debug mode

## Usage

First, start the agent server:
```bash
./agentsmithy --workdir /path/to/your/project --ide vscode
```

Then in VSCode:
- Click AgentSmithy icon in Activity Bar
- Or: `Ctrl+Shift+P` → `AgentSmithy: Open Chat`
- Send selected code: Right-click → `Send Selection to AgentSmithy`

## Configuration

Access settings via `File → Preferences → Settings` → search for "AgentSmithy":

- `agentsmithy.serverUrl`: Local server URL (default: "http://localhost:8765")

## License

Apache License 2.0 - see [LICENSE](LICENSE) file.

Copyright 2025 Alexander Morozov
