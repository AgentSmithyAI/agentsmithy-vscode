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

**New in v1.5.0**: The extension now automatically downloads and manages the AgentSmithy server! No manual setup required.

## Features

- 🚀 **Automatic Server Management** - Downloads and starts the server automatically
- 🔄 **Cross-Platform Support** - Works on Linux, macOS (Intel & Apple Silicon), and Windows
- 💬 **AI Code Assistant** - Ask it to implement features, refactor code, or fix bugs
- 📝 **Direct File Editing** - Makes changes directly in your files
- 🔍 **Context-Aware** - Understands your codebase

## Prerequisites

- Visual Studio Code (any version, including Code-OSS, VSCodium)
- OpenAI API key (for AI features)

## Quick Start

1. **Install the extension** (see [Installation](#installation) below)

2. **Configure your OpenAI API key**:

   Create `<your-project>/.agentsmithy/config.json`:

   ```json
   {
     "providers": {
       "openai": {
         "type": "openai",
         "api_key": "your_key_here",
         "base_url": "https://api.openai.com/v1"
       }
     },
     "workloads": {
       "reasoning": {"provider": "openai", "model": "gpt-4o"},
       "embeddings": {"provider": "openai", "model": "text-embedding-3-large"}
     },
     "models": {
       "agents": {
         "universal": {"workload": "reasoning"}
       },
       "embeddings": {"workload": "embeddings"}
     }
   }
   ```

   Or set environment variable:

   ```bash
   export OPENAI_API_KEY=your_key_here
   ```

3. **Start using AgentSmithy**:
   - Click the AgentSmithy icon in the Activity Bar
   - The server will download and start automatically on first use
   - Start chatting with your AI assistant!

### Manual Server Management (Optional)

If you prefer to manage the server yourself:

1. Set `agentsmithy.autoStartServer` to `false` in settings
2. Download binary from [releases page](https://github.com/AgentSmithyAI/agentsmithy-agent/releases)
3. Start manually:
   ```bash
   ./agentsmithy --workdir /path/to/your/project --ide vscode
   ```

See [server management documentation](docs/server-management.md) for details.

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

### Chat Interface

- **Open Chat**: Click AgentSmithy icon in Activity Bar or use `Ctrl+Shift+P` → `AgentSmithy: Open Chat`
- **Send Selection**: Right-click selected code → `Send Selection to AgentSmithy`
- **Ask Questions**: Type your question or request in the chat input

### Server Management Commands

Access via Command Palette (`Ctrl+Shift+P`):

- `AgentSmithy: Start Server` - Manually start the server
- `AgentSmithy: Stop Server` - Stop the running server
- `AgentSmithy: Restart Server` - Restart the server
- `AgentSmithy: Show Server Status` - Check server status

### Monitor Server Logs

View server output in `View → Output → AgentSmithy Server`

## Configuration

Access settings via `File → Preferences → Settings` → search for "AgentSmithy":

### Server Settings

- `agentsmithy.autoStartServer`: Automatically start the managed server on extension activation (default: `true`)

### Server configuration panel

Server credentials, models, and other runtime options now live entirely inside the AgentSmithy configuration panel. Open it via Command Palette → `AgentSmithy: Open Configuration` from inside VS Code.

For additional details, see [server management documentation](docs/server-management.md).

## License

Apache License 2.0 - see [LICENSE](LICENSE) file.

Copyright 2025 Alexander Morozov
