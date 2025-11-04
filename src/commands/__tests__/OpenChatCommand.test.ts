import {describe, it, expect} from 'vitest';
import * as vscode from 'vscode';
import {OpenChatCommand} from '../OpenChatCommand';
import {VIEWS} from '../../constants';

describe('OpenChatCommand', () => {
  it('focuses container and chat view', async () => {
    const cmd = new OpenChatCommand();

    await cmd.execute();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`workbench.view.extension.${VIEWS.CONTAINER}`);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${VIEWS.CHAT}.focus`);
    expect((vscode.commands.executeCommand as any).mock.calls.length).toBe(2);
  });
});
