import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {COMMANDS, ERROR_MESSAGES, TIMEOUTS} from '../constants';
import {ICommand} from './BaseCommand';

export class SendSelectionCommand implements ICommand {
  readonly id = COMMANDS.SEND_SELECTION;

  constructor(private readonly provider: ChatWebviewProvider) {}

  execute = async (): Promise<void> => {
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
      this.provider.sendMessage(message);
    }, TIMEOUTS.WEBVIEW_INIT);
  };
}
