import * as vscode from 'vscode';
import { ChatWebviewProvider } from './chatWebviewProvider';
import { COMMANDS, ERROR_MESSAGES, MOVE_TO_SECONDARY_MESSAGE, TIMEOUTS, VIEWS, WELCOME_MESSAGE } from './constants';

export const activate = (context: vscode.ExtensionContext) => {
  // Register the webview provider
  const provider = new ChatWebviewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEWS.CHAT, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register command to open chat
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_CHAT, async () => {
      // Focus on the AgentSmithy view container
      await vscode.commands.executeCommand(`workbench.view.extension.${VIEWS.CONTAINER}`);
      // Focus on the chat view
      await vscode.commands.executeCommand(`${VIEWS.CHAT}.focus`);
    }),
  );

  // Register command to move to secondary sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.MOVE_TO_SECONDARY, async () => {
      vscode.window.showInformationMessage(MOVE_TO_SECONDARY_MESSAGE);
    }),
  );

  // Register command to send current selection
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SEND_SELECTION, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(ERROR_MESSAGES.NO_ACTIVE_EDITOR);
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage(ERROR_MESSAGES.NO_SELECTION);
        return;
      }

      const selectedText = editor.document.getText(selection);
      const fileName = editor.document.fileName.split('/').pop() || editor.document.fileName;

      // Open the chat view
      await vscode.commands.executeCommand(COMMANDS.OPEN_CHAT);

      // Give the webview time to initialize
      setTimeout(() => {
        const message = `Please help me with this code from ${fileName}:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
        provider.sendMessage(message);
      }, TIMEOUTS.WEBVIEW_INIT);
    }),
  );

  // Show a welcome message
  const hasShownWelcome = Boolean(context.globalState.get('agentsmithy.welcomeShown', false));

  if (hasShownWelcome === false) {
    void vscode.window
      .showInformationMessage(WELCOME_MESSAGE, ERROR_MESSAGES.OPEN_CHAT)
      .then((selection) => {
        if (selection === ERROR_MESSAGES.OPEN_CHAT) {
          void vscode.commands.executeCommand(COMMANDS.OPEN_CHAT);
        }
      });

    void context.globalState.update('agentsmithy.welcomeShown', true);
  }
};

// VSCode does not require a deactivate export; intentionally omitted.
