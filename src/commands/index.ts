import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {ICommand} from './BaseCommand';
import {MoveToSecondarySidebarCommand} from './MoveToSecondarySidebarCommand';
import {OpenChatCommand} from './OpenChatCommand';
import {SendSelectionCommand} from './SendSelectionCommand';
import {SetDiffViewModeCommand} from './SetDiffViewModeCommand';

/**
 * Register all commands in the extension
 */
export const registerCommands = (context: vscode.ExtensionContext, chatProvider: ChatWebviewProvider): void => {
  const commands: ICommand[] = [
    new OpenChatCommand(),
    new SendSelectionCommand(chatProvider),
    new MoveToSecondarySidebarCommand(),
    new SetDiffViewModeCommand(),
  ];

  for (const cmd of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(cmd.id, () => cmd.execute()));
  }
};
