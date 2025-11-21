# Server Management

AgentSmithy VSCode extension now includes automatic server management capabilities. The extension can automatically download, install, and manage the AgentSmithy server binary.

## Features

### Automatic Server Download

The extension automatically downloads the correct server binary for your platform from [GitHub releases](https://github.com/AgentSmithyAI/agentsmithy-agent/releases) when needed.

Supported platforms:

- **Linux**: x64
- **macOS**: x64 and ARM64 (Apple Silicon)
- **Windows**: x64

### Auto-Start

By default, the server starts automatically when the extension activates. This behavior can be configured in settings.

### Server Management Commands

Access these commands through the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **AgentSmithy: Start Server** - Manually start the server
- **AgentSmithy: Stop Server** - Stop the running server
- **AgentSmithy: Restart Server** - Restart the server
- **AgentSmithy: Show Server Status** - Check if server is running and on which port

## Configuration

### Settings

Available in VSCode settings (`Preferences: Open Settings`):

#### `agentsmithy.autoStartServer`

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically start the managed AgentSmithy server when the extension activates

#### AgentSmithy configuration panel

All other server options (providers, credentials, workloads, ports, etc.) are managed inside the dedicated AgentSmithy configuration panel. Launch it via Command Palette → `AgentSmithy: Open Configuration`. The panel communicates directly with the running server, so there is no need to edit VS Code settings manually.

### Example Configuration

```json
{
  "agentsmithy.autoStartServer": true
}
```

## Server Storage

The server binary is stored in the extension's global storage directory:

- **Linux**: `~/.config/Code/User/globalStorage/agentsmithy.agentsmithy-vscode/server/`
- **macOS**: `~/Library/Application Support/Code/User/globalStorage/agentsmithy.agentsmithy-vscode/server/`
- **Windows**: `%APPDATA%\Code\User\globalStorage\agentsmithy.agentsmithy-vscode\server\`

## Monitoring Server

### Output Channel

Server logs are available in the "AgentSmithy Server" output channel:

1. Open Output panel (`View > Output`)
2. Select "AgentSmithy Server" from the dropdown

This shows:

- Server startup logs
- Server output (stdout/stderr)
- Download progress
- Error messages

### Health Checks

The extension automatically checks if the server is running by making health check requests to `/health` endpoint.

## Troubleshooting

### Server Won't Start

1. Check the "AgentSmithy Server" output channel for errors
2. The server automatically selects an available port, so port conflicts should not occur
3. Try manually restarting: `AgentSmithy: Restart Server`
4. Check your firewall settings

### Download Issues

If the server binary fails to download:

1. Check your internet connection
2. Verify access to GitHub (github.com)
3. Check the output channel for detailed error messages
4. Try manually downloading from [releases](https://github.com/AgentSmithyAI/agentsmithy-agent/releases)

### Permission Issues (Linux/macOS)

The extension automatically makes the binary executable (`chmod +x`). If you encounter permission issues:

```bash
chmod +x ~/.config/Code/User/globalStorage/agentsmithy.agentsmithy-vscode/server/agentsmithy-agent
```

### Using External Server

If you prefer to run your own server instance:

1. Set `agentsmithy.autoStartServer` to `false`
2. Start your server manually and ensure it writes a valid `.agentsmithy/status.json` file in the workspace (or exports the same API as the managed server)
3. Open the AgentSmithy configuration panel to verify connectivity and credentials

## Architecture

### ServerManager Class

The `ServerManager` class handles:

- Platform detection
- Binary download from GitHub releases
- Process lifecycle management
- Health checks
- Automatic server restart on configuration changes

### Integration with Extension

The server manager is initialized during extension activation and:

- Checks if auto-start is enabled
- Downloads binary if not present
- Starts the server process
- Registers command handlers
- Manages cleanup on deactivation

## Development

### Testing Server Management

To test server management features during development:

1. Clear the server directory to force a fresh download
2. Use `agentsmithy.autoStartServer: false` to test manual start
3. Monitor the output channel for debugging
4. Check `.agentsmithy/status.json` in workspace to see the auto-selected port

### Debugging

Enable verbose logging by checking the "AgentSmithy Server" output channel. All server-related operations are logged there.
