import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {ICommand} from './BaseCommand';
import {MoveToSecondarySidebarCommand} from './MoveToSecondarySidebarCommand';
import {OpenChatCommand} from './OpenChatCommand';
import {SendSelectionCommand} from './SendSelectionCommand';

/**
 * Register all commands in the extension
 */
export const registerCommands = (context: vscode.ExtensionContext, chatProvider: ChatWebviewProvider): void => {
  const commands: ICommand[] = [
    new OpenChatCommand(),
    new SendSelectionCommand(chatProvider),
    new MoveToSecondarySidebarCommand(),
  ];

  commands.forEach((cmd) => {
    context.subscriptions.push(vscode.commands.registerCommand(cmd.id, () => cmd.execute()));
  });
};
