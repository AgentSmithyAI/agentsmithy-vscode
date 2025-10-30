import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {ApiService} from '../api/ApiService';
import {StreamService} from '../api/StreamService';
import {HistoryService} from '../services/HistoryService';
import {DialogService} from '../services/DialogService';
import {ConfigService} from '../services/ConfigService';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../shared/messages';

class FakeStream extends StreamService {
  constructor() {
    super({} as any);
  }
}

const createProvider = () => {
  const api = new ApiService('http://localhost');
  const stream = new FakeStream();
  const history = new HistoryService(api);
  const dialog = new DialogService(api);
  const config = new ConfigService({} as any);
  const provider = new ChatWebviewProvider(vscode.Uri.file('/ext'), stream, history, dialog, config, api);
  return {provider, api, history, dialog};
};

describe('ChatWebviewProvider - session operations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const bootWebview = (provider: ChatWebviewProvider) => {
    type WebviewLike = {
      postMessage: (message: unknown) => Promise<boolean>;
      onDidReceiveMessage?: (cb: (msg: unknown) => void) => void;
    };
    type DisposableLike = {dispose: () => void};
    type WebviewViewLike = {
      webview: WebviewLike;
      onDidChangeVisibility: (cb: () => void) => DisposableLike;
      onDidDispose: (cb: () => void) => void;
    };

    const postMessage = vi.fn(async () => true);
    const webview: WebviewLike = {postMessage};

    let handler: ((msg: unknown) => void) | undefined;
    webview.onDidReceiveMessage = (cb: (msg: unknown) => void) => {
      handler = cb;
    };

    (vscode.workspace as any).openTextDocument = vi.fn();

    const webviewView: WebviewViewLike = {
      webview,
      onDidChangeVisibility: () => ({dispose: vi.fn()}),
      onDidDispose: (cb: () => void) => cb(),
    };

    provider.resolveWebviewView(webviewView as unknown as any, {} as any, {} as any);
    return {postMessage, send: (msg: unknown) => handler?.(msg)};
  };

  it('handles APPROVE_SESSION success path', async () => {
    const {provider, api, history, dialog} = createProvider();
    const {postMessage, send} = bootWebview(provider);

    // Seed current dialog id used inside provider
    history.currentDialogId = 'd1';

    // Mock API call and dependent loads
    vi.spyOn(api, 'approveSession').mockResolvedValue({approved_commit: 'c1', new_session: 's2', commits_approved: 3});
    vi.spyOn(history, 'loadLatest').mockResolvedValue({events: [], hasMore: false, dialogId: 'd1'} as any);
    vi.spyOn(dialog, 'loadDialogs').mockResolvedValue();

    // Trigger
    send({type: WEBVIEW_IN_MSG.APPROVE_SESSION, dialogId: 'd1'});

    // Allow async handlers to run
    await Promise.resolve();
    await Promise.resolve();

    // Expect info, history reload, session status update
    expect(api.approveSession).toHaveBeenCalledWith('d1');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SHOW_INFO}));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED}),
    );
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE}));
  });

  it('handles APPROVE_SESSION error path', async () => {
    const {provider, api, history} = createProvider();
    const {postMessage, send} = bootWebview(provider);

    history.currentDialogId = 'd1';

    vi.spyOn(api, 'approveSession').mockRejectedValue(new Error('boom'));

    send({type: WEBVIEW_IN_MSG.APPROVE_SESSION, dialogId: 'd1'});

    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SHOW_ERROR}));
  });

  it('handles RESET_TO_APPROVED cancel path', async () => {
    const {provider, api, history} = createProvider();
    const {postMessage, send} = bootWebview(provider);

    history.currentDialogId = 'd1';

    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValueOnce(undefined as any); // user cancels

    send({type: WEBVIEW_IN_MSG.RESET_TO_APPROVED, dialogId: 'd1'});

    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({type: WEBVIEW_OUT_MSG.SESSION_OPERATION_CANCELLED});
    expect(api.resetToApproved).not.toHaveBeenCalled();
  });

  it('handles RESET_TO_APPROVED success path', async () => {
    const {provider, api, history} = createProvider();
    const {postMessage, send} = bootWebview(provider);

    history.currentDialogId = 'd1';

    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValueOnce('Reset' as any);
    vi.spyOn(api, 'resetToApproved').mockResolvedValue({reset_to: 'c1', new_session: 's2'});
    vi.spyOn(history, 'loadLatest').mockResolvedValue({events: [], hasMore: false, dialogId: 'd1'} as any);

    send({type: WEBVIEW_IN_MSG.RESET_TO_APPROVED, dialogId: 'd1'});

    await Promise.resolve();
    await Promise.resolve();

    expect(api.resetToApproved).toHaveBeenCalledWith('d1');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SHOW_INFO}));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED}),
    );
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE}));
  });

  it('handles RESTORE_CHECKPOINT confirm success', async () => {
    const {provider, api, history} = createProvider();
    const {postMessage, send} = bootWebview(provider);

    history.currentDialogId = 'd1';

    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValueOnce('Restore' as any);
    vi.spyOn(api, 'restoreCheckpoint').mockResolvedValue({restored_to: 'c1', new_checkpoint: 'c2'});
    vi.spyOn(history, 'loadLatest').mockResolvedValue({events: [], hasMore: false, dialogId: 'd1'} as any);

    send({
      type: WEBVIEW_IN_MSG.RESTORE_CHECKPOINT,
      dialogId: 'd1',
      checkpointId: 'c1',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(api.restoreCheckpoint).toHaveBeenCalledWith('d1', 'c1');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SHOW_INFO}));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED}),
    );
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE}));
  });

  it('handles RESTORE_CHECKPOINT cancel path', async () => {
    const {provider, api} = createProvider();
    const {postMessage, send} = bootWebview(provider);

    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValueOnce(undefined as any);

    send({
      type: WEBVIEW_IN_MSG.RESTORE_CHECKPOINT,
      dialogId: 'd1',
      checkpointId: 'c1',
    });

    await Promise.resolve();

    expect(api.restoreCheckpoint).not.toHaveBeenCalled();
    // No explicit cancel message for restore; just ensure no errors
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({type: WEBVIEW_OUT_MSG.SHOW_ERROR}));
  });
});
