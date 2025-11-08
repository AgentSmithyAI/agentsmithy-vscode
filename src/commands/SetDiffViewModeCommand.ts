import * as vscode from 'vscode';
import {ICommand} from './BaseCommand';

export class SetDiffViewModeCommand implements ICommand {
  readonly id = 'agentsmithy.setDiffViewMode';

  execute = async (): Promise<void> => {
    const config = vscode.workspace.getConfiguration('diffEditor');
    const current = config.get<boolean>('renderSideBySide', true);

    const pick = await vscode.window.showQuickPick(
      [
        {label: 'Two-pane (side-by-side)', description: current ? 'current' : undefined, value: true},
        {label: 'Inline', description: !current ? 'current' : undefined, value: false},
      ],
      {title: 'Choose diff view mode', placeHolder: 'Select how to display diffs'},
    );

    if (!pick) {
      return;
    }

    await config.update('renderSideBySide', pick.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Diff view mode set to ${pick.value ? 'two-pane (side-by-side)' : 'inline'}.`);
  };
}
