import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {SendSelectionCommand} from '../SendSelectionCommand';
import {COMMANDS, ERROR_MESSAGES, TIMEOUTS} from '../../constants';
import {ChatWebviewProvider} from '../../chatWebviewProvider';

describe('SendSelectionCommand', () => {
  let provider: ChatWebviewProvider;

  beforeEach(() => {
    // Minimal provider stub with spy
    provider = {
      sendMessage: vi.fn(),
    } as unknown as ChatWebviewProvider;

    // Fake editor and selection
    const document = {
      fileName: '/path/to/file.ts',
      languageId: 'typescript',
      getText: vi.fn((sel?: any) => (sel ? 'selected code' : 'full file')),
    } as any;

    const selection = {
      isEmpty: false,
      start: {line: 0, character: 0},
      end: {line: 0, character: 10},
    } as any;

    (vscode.window as any).activeTextEditor = {document, selection};
  });

  it('warns when no active editor', async () => {
    (vscode.window as any).activeTextEditor = undefined;
    const cmd = new SendSelectionCommand(provider);

    await cmd.execute();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(ERROR_MESSAGES.NO_ACTIVE_EDITOR);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('warns when selection is empty', async () => {
    const editor = (vscode.window as any).activeTextEditor;
    editor.selection = {isEmpty: true};
    const cmd = new SendSelectionCommand(provider);

    await cmd.execute();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(ERROR_MESSAGES.NO_SELECTION);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('opens chat and sends message with selected code after timeout', async () => {
    vi.useFakeTimers();
    const cmd = new SendSelectionCommand(provider);

    await cmd.execute();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(COMMANDS.OPEN_CHAT);

    // Fast-forward webview init timeout
    vi.advanceTimersByTime(TIMEOUTS.WEBVIEW_INIT + 1);

    expect(provider.sendMessage).toHaveBeenCalled();
    const [[message]] = (provider.sendMessage as any).mock.calls;
    expect(message).toContain('```typescript');
    expect(message).toContain('selected code');

    vi.useRealTimers();
  });
});
