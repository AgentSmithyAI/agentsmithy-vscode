import * as vscode from 'vscode';
import {ApiService} from './api/ApiService';
import {ChatWebviewProvider} from './chatWebviewProvider';
import {registerCommands} from './commands';
import {COMMANDS, ERROR_MESSAGES, STATE_KEYS, VIEWS, WELCOME_MESSAGE} from './constants';
import {ConfigService} from './services/ConfigService';
import {DialogService} from './services/DialogService';
import {HistoryService} from './services/HistoryService';
import {StreamService} from './api/StreamService';
import {normalizeSSEEvent} from './shared/sseNormalizer';
import {ServerManager} from './services/ServerManager';

export const activate = async (context: vscode.ExtensionContext) => {
  // Create services
  const configService = new ConfigService();
  const serverManager = new ServerManager(context, configService);

  // Add ServerManager to subscriptions for proper cleanup
  context.subscriptions.push(serverManager);

  // Create API services
  const serverUrl = configService.getServerUrl();
  const apiService = new ApiService(serverUrl);
  const streamService = new StreamService(serverUrl, normalizeSSEEvent);
  const historyService = new HistoryService(apiService);
  const dialogService = new DialogService(apiService);

  // Auto-start server if configured
  if (configService.getAutoStartServer()) {
    // Start server in background, don't block activation
    void serverManager.startServer().catch(() => {
      void vscode.window.showWarningMessage(
        'Failed to start AgentSmithy server automatically. You can start it manually from the Command Palette.',
      );
    });
  }

  // Note: When server URL changes, we recreate service instances,
  // but existing providers will continue using old instances.
  // This is acceptable as config changes are rare.

  // Register the webview provider
  const provider = new ChatWebviewProvider(
    context.extensionUri,
    streamService,
    historyService,
    dialogService,
    configService,
    apiService,
    serverManager,
  );

  // Subscribe to server ready event
  const eventsChannel = vscode.window.createOutputChannel('AgentSmithy Events');
  context.subscriptions.push(eventsChannel);

  const serverReadyDisposable = serverManager.onServerReady(() => {
    eventsChannel.appendLine(`[onServerReady callback] Event received at ${new Date().toISOString()}`);
    eventsChannel.appendLine(`[onServerReady callback] Provider has view: ${provider.hasView()}`);
    void provider.refreshAfterServerStart();
  });
  context.subscriptions.push(serverReadyDisposable);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEWS.CHAT, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register commands using Command Pattern
  registerCommands(context, provider);

  // Register server management commands
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.START_SERVER, async () => {
      await serverManager.startServer();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.STOP_SERVER, async () => {
      await serverManager.stopServer();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.RESTART_SERVER, async () => {
      await serverManager.restartServer();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SERVER_STATUS, async () => {
      const status = await serverManager.getStatus();
      const statusMessage = status.running
        ? status.port !== null
          ? `AgentSmithy server is running on port ${status.port} (PID: ${status.pid ?? 'unknown'})`
          : `AgentSmithy server is running (port unknown, PID: ${status.pid ?? 'unknown'})`
        : `AgentSmithy server is not running`;

      void vscode.window.showInformationMessage(statusMessage);
    }),
  );

  // Show a welcome message
  const hasShownWelcome = Boolean(context.globalState.get(STATE_KEYS.WELCOME_SHOWN, false));

  if (hasShownWelcome === false) {
    void vscode.window.showInformationMessage(WELCOME_MESSAGE, ERROR_MESSAGES.OPEN_CHAT).then((selection) => {
      if (selection === ERROR_MESSAGES.OPEN_CHAT) {
        void vscode.commands.executeCommand(COMMANDS.OPEN_CHAT);
      }
    });

    void context.globalState.update(STATE_KEYS.WELCOME_SHOWN, true);
  }
};

/**
 * Deactivate function to clean up resources
 */
export const deactivate = () => {
  // Resources are automatically disposed via context.subscriptions
};
