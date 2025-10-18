import * as vscode from 'vscode';
import {ChatWebviewProvider} from './chatWebviewProvider';

export const activate = (context: vscode.ExtensionContext) => {
  // Register the webview provider
  const provider = new ChatWebviewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register command to open chat
  context.subscriptions.push(
    vscode.commands.registerCommand('agentsmithy.openChat', async () => {
      // Focus on the AgentSmithy view container
      await vscode.commands.executeCommand('workbench.view.extension.agentsmithy');
      // Focus on the chat view
      await vscode.commands.executeCommand('agentsmithy.chatView.focus');
    }),
  );

  // Register command to move to secondary sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('agentsmithy.moveToSecondarySidebar', async () => {
      vscode.window.showInformationMessage(
        'To move AgentSmithy to secondary sidebar: Right-click on AgentSmithy icon in activity bar → "Move to Secondary Side Bar"',
      );
    }),
  );

  // Register command to send current selection
  context.subscriptions.push(
    vscode.commands.registerCommand('agentsmithy.sendSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected');
        return;
      }

      const selectedText = editor.document.getText(selection);
      const fileName = editor.document.fileName.split('/').pop() || editor.document.fileName;

      // Open the chat view
      await vscode.commands.executeCommand('agentsmithy.openChat');

      // Give the webview time to initialize
      setTimeout(() => {
        const message = `Please help me with this code from ${fileName}:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
        provider.sendMessage(message);
      }, 500);
    }),
  );

  // Show a welcome message
  const config = vscode.workspace.getConfiguration('agentsmithy');
  const hasShownWelcome = context.globalState.get('agentsmithy.welcomeShown', false);

  if (!hasShownWelcome) {
    vscode.window
      .showInformationMessage(
        'AgentSmithy is ready! Open the chat from the sidebar or use Command Palette → "AgentSmithy: Open Chat"',
        'Open Chat',
      )
      .then((selection) => {
        if (selection === 'Open Chat') {
          vscode.commands.executeCommand('agentsmithy.openChat');
        }
      });

    context.globalState.update('agentsmithy.welcomeShown', true);
  }
};

export const deactivate = () => {};
