import * as vscode from 'vscode';
import {AgentSmithyClient} from './agentSmithyClient';
import {ChatWebviewProvider} from './chatWebviewProvider';
import {registerCommands} from './commands';
import {COMMANDS, ERROR_MESSAGES, VIEWS, WELCOME_MESSAGE} from './constants';
import {ConfigService} from './services/ConfigService';
import {HistoryService} from './services/HistoryService';

export const activate = (context: vscode.ExtensionContext) => {
  // Create services
  const configService = new ConfigService();
  const client = new AgentSmithyClient(configService.getServerUrl());
  const historyService = new HistoryService(client);

  // Note: When server URL changes, we recreate the client instance,
  // but existing services will continue using the old client.
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
  const hasShownWelcome = Boolean(context.globalState.get('agentsmithy.welcomeShown', false));

  if (hasShownWelcome === false) {
    void vscode.window.showInformationMessage(WELCOME_MESSAGE, ERROR_MESSAGES.OPEN_CHAT).then((selection) => {
      if (selection === ERROR_MESSAGES.OPEN_CHAT) {
        void vscode.commands.executeCommand(COMMANDS.OPEN_CHAT);
      }
    });

    void context.globalState.update('agentsmithy.welcomeShown', true);
  }
};

// VSCode does not require a deactivate export; intentionally omitted.
