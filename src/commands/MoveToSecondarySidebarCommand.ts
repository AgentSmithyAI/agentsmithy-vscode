import * as vscode from 'vscode';
import {COMMANDS, MOVE_TO_SECONDARY_MESSAGE} from '../constants';
import {ICommand} from './BaseCommand';

export class MoveToSecondarySidebarCommand implements ICommand {
  readonly id = COMMANDS.MOVE_TO_SECONDARY;

  execute = async (): Promise<void> => {
    vscode.window.showInformationMessage(MOVE_TO_SECONDARY_MESSAGE);
  };
}
