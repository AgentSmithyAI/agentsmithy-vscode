import {describe, it, expect} from 'vitest';
import * as vscode from 'vscode';
import {MoveToSecondarySidebarCommand} from '../MoveToSecondarySidebarCommand';
import {MOVE_TO_SECONDARY_MESSAGE} from '../../constants';

describe('MoveToSecondarySidebarCommand', () => {
  it('shows information message', async () => {
    const cmd = new MoveToSecondarySidebarCommand();

    await cmd.execute();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(MOVE_TO_SECONDARY_MESSAGE);
  });
});
