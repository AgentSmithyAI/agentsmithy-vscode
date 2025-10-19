import * as vscode from 'vscode';
import { COMMANDS, VIEWS } from '../constants';
import { ICommand } from './BaseCommand';

export class OpenChatCommand implements ICommand {
  readonly id = COMMANDS.OPEN_CHAT;

  execute = async (): Promise<void> => {
    // Focus on the AgentSmithy view container
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEWS.CONTAINER}`);
    // Focus on the chat view
    await vscode.commands.executeCommand(`${VIEWS.CHAT}.focus`);
  };
}

