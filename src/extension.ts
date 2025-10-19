import * as vscode from 'vscode';
import {AgentSmithyClient} from './agentSmithyClient';
import {ApiService} from './api/ApiService';
import {ChatWebviewProvider} from './chatWebviewProvider';
import {registerCommands} from './commands';
import {COMMANDS, ERROR_MESSAGES, STATE_KEYS, VIEWS, WELCOME_MESSAGE} from './constants';
import {ConfigService} from './services/ConfigService';
import {HistoryService} from './services/HistoryService';

export const activate = (context: vscode.ExtensionContext) => {
  // Create services
  const configService = new ConfigService();
  const serverUrl = configService.getServerUrl();

  const apiService = new ApiService(serverUrl);
  const client = new AgentSmithyClient(serverUrl);
  const historyService = new HistoryService(apiService);

  // Note: When server URL changes, we recreate service instances,
  // but existing providers will continue using old instances.
  // This is acceptable as config changes are rare.

  // Register the webview provider
  const provider = new ChatWebviewProvider(context.extensionUri, client, historyService, configService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEWS.CHAT, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register commands using Command Pattern
  registerCommands(context, provider);

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

// VSCode does not require a deactivate export; intentionally omitted.
