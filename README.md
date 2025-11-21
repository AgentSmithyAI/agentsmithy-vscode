## AgentSmithy VS Code Extension

[![Open VSX](https://img.shields.io/open-vsx/v/agentsmithy/agentsmithy?label=Open%20VSX)](https://open-vsx.org/extension/agentsmithy/agentsmithy)
[![GitHub release](https://img.shields.io/github/v/release/AgentSmithyAI/agentsmithy-vscode)](https://github.com/AgentSmithyAI/agentsmithy-vscode/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/AgentSmithyAI/agentsmithy-vscode/actions/workflows/workflow.yaml/badge.svg?branch=master)](https://github.com/AgentSmithyAI/agentsmithy-vscode/actions/workflows/workflow.yaml)
[![codecov](https://codecov.io/gh/AgentSmithyAI/agentsmithy-vscode/branch/master/graph/badge.svg)](https://codecov.io/gh/AgentSmithyAI/agentsmithy-vscode)
[![VS Code Version](https://img.shields.io/badge/VSCode-1.100.0%2B-blue)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

> **Status: Alpha.** APIs and UX are still evolving. Expect breaking changes and rough edges.  
> **Provider support:** OpenAI only (for now).  
> **Requirement:** You must bring your own OpenAI API key.

AgentSmithy is an AI coding assistant that runs as a server and integrates into VS Code / Code-OSS.

Supports Code-OSS, VSCodium, and other VS Code forks.

## AgentSmithy server

This extension is a **client UI** for the standalone AgentSmithy server: [`AgentSmithyAI/agentsmithy-agent`](https://github.com/AgentSmithyAI/agentsmithy-agent).

The server:

- Runs locally as a **self-hosted AI coding assistant**
- Orchestrates the LLM with tools, RAG over your repository, and safe multi-step edits
- Exposes an HTTP API (FastAPI) with real-time streaming via SSE
- Stores configuration on disk and hot-reloads changes without restarts

For deeper technical details (architecture, API, RAG, checkpoints, etc.), see the server documentation in the [agentsmithy-agent repository](https://github.com/AgentSmithyAI/agentsmithy-agent).

## Requirements

- **VS Code / Code‑OSS / VSCodium** (1.100.0+)
- **OpenAI API key** – required for all AI features
- **OpenAI streaming enabled** – your OpenAI account must allow streaming responses for the models you configure

## Quick start

1. **Install the extension**
   - From Marketplace (when available): search for `AgentSmithy` in the Extensions view and click **Install**, or
   - From a VSIX file (see [Installation](#installation) for details).

2. **Get an OpenAI API key**
   - Create or sign in to your OpenAI account.
   - Generate an API key and keep it somewhere safe.

3. **Configure AgentSmithy** (recommended: config panel)
   - Open the Command Palette: `Ctrl+Shift+P`.
   - Run `AgentSmithy: Open Configuration`.
   - In the configuration webview:
     - Add an **OpenAI provider** if it’s not already present.
     - Paste your **OpenAI API key**.
     - Select a **chat model** (for example `gpt-4o`) and, optionally, an embeddings model.
   - Click **Save Configuration**.

4. **Start using AgentSmithy**
   - Click the AgentSmithy icon in the Activity Bar to open the chat view.
   - On first use, the extension will automatically download and start the server.
   - Start chatting with your AI assistant, or send code selections as context.

## Configuration

Most users should configure AgentSmithy entirely through the built‑in configuration panel.

### Configuration via VS Code panel (recommended)

- Open the AgentSmithy view from the Activity Bar (left sidebar) and click the **settings (gear) button**, or
- Open Command Palette (`Ctrl+Shift+P`) → **`AgentSmithy: Open Configuration`**.
- Use the configuration webview tabs to:
  - Manage **providers** (currently only OpenAI is supported in this alpha build)
  - Define **workloads** (e.g. reasoning vs embeddings)
  - Bind **model slots** for agents and tools
  - Adjust other runtime options
- Changes are applied via hot reload on the server side — no manual restart required.

See [configuration management documentation](docs/configuration-management.md) for more details.

### Global configuration file (advanced)

Under the hood, the configuration is stored on the server side:

- **Linux**: `~/.config/agentsmithy/config.json` (respects `XDG_CONFIG_HOME`)
- **macOS**: `~/Library/Application Support/AgentSmithy/config.json`
- **Windows**: `%APPDATA%/AgentSmithy/config.json`

You can edit this file directly if you prefer managing JSON, but the **config panel is recommended** and kept in sync with the file.

> **Note:** The exact shape of configuration may change during the alpha phase. Prefer using the configuration panel when possible.

## Usage

### Server management

By default, the extension manages the AgentSmithy server for you:

- On first use, it **downloads** the matching binary for your platform.
- It **starts, restarts, and stops** the server as needed.

You can control it via Command Palette (`Ctrl+Shift+P`):

- `AgentSmithy: Start Server` – Manually start the server
- `AgentSmithy: Stop Server` – Stop the running server
- `AgentSmithy: Restart Server` – Restart the server
- `AgentSmithy: Show Server Status` – Check current server health

### Monitoring logs

- Open `View → Output`, then choose **AgentSmithy Server** from the dropdown to see server logs.
- This is the best place to look if the server fails to start or if configuration validation fails.

## Manual server management (advanced / optional)

If you prefer to manage the server yourself instead of using the built‑in manager:

1. Set `agentsmithy.autoStartServer` to `false` in VS Code settings.
2. Download the AgentSmithy server binary from the [agentsmithy-agent releases](https://github.com/AgentSmithyAI/agentsmithy-agent/releases).
3. Start it manually, pointing it at your workspace:

   ```bash
   ./agentsmithy --workdir /path/to/your/project --ide vscode
   ```

See [server management documentation](docs/server-management.md) for more details and CLI options.

## Installation

### From Open VSX Registry

For VSCodium, Code‑OSS, and other VS Code alternatives:

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for **"AgentSmithy"**.
3. Click **Install**.

Or visit the extension page on Open VSX:  
`https://open-vsx.org/extension/agentsmithy/agentsmithy`

### From VSIX (user)

1. Download the latest `.vsix` from the [releases page](https://github.com/AgentSmithyAI/agentsmithy-vscode/releases) (for example, `agentsmithy.agentsmithy-<version>.vsix`).
2. In VS Code / Code‑OSS / VSCodium, open the Command Palette: `Ctrl+Shift+P`.
3. Run **`Extensions: Install from VSIX...`** and select the downloaded file.

### From source (building the VSIX)

For contributors or if you want to build the extension yourself:

```
npm ci
npm run compile
npx @vscode/vsce package
```

This produces a `.vsix` file in the project root (for example, `agentsmithy.agentsmithy-<version>.vsix`), which you can then install as described above.

## Limitations (Alpha)

- The extension is in **alpha** – APIs, configuration format, and UX may change without backward compatibility.
- Other providers (Anthropic, etc.) are not yet wired through the VS Code extension, even if present in the server codebase.
- Some features described in the server / CLI docs may not yet be exposed in the VS Code UI.

## Links

- **VS Code extension (this repo)**: [`AgentSmithyAI/agentsmithy-vscode`](https://github.com/AgentSmithyAI/agentsmithy-vscode)
- **Open VSX listing**: [`agentsmithy/agentsmithy`](https://open-vsx.org/extension/agentsmithy/agentsmithy)
- **AgentSmithy server**: [`AgentSmithyAI/agentsmithy-agent`](https://github.com/AgentSmithyAI/agentsmithy-agent)

## Feedback & support

- File bugs and feature requests via [GitHub Issues](https://github.com/AgentSmithyAI/agentsmithy-vscode/issues).
- When reporting a problem, please include:
  - Extension version
  - VS Code / Code‑OSS version
  - OS and architecture
  - Relevant snippets from the **AgentSmithy Server** output channel

## License

Apache License 2.0 – see the [LICENSE](LICENSE) file.

Copyright 2025 Alexander Morozov
