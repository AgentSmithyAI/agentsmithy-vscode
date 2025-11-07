import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {ApiService} from '../api/ApiService';
import {StreamService, type SSEEvent} from '../api/StreamService';
import {HistoryService} from '../services/HistoryService';
import {DialogService} from '../services/DialogService';
import {ConfigService} from '../services/ConfigService';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../shared/messages';
import {SSE_EVENT_TYPES as E} from '../constants';

describe('ChatWebviewProvider - stream error handling', () => {
  let provider: ChatWebviewProvider;
  let stream: StreamService;
  let history: HistoryService;
  let api: ApiService;
  let postMessage: ReturnType<typeof vi.fn>;
  let sendMessage: (msg: unknown) => void;

  const bootWebview = (prov: ChatWebviewProvider) => {
    type WebviewLike = {
      postMessage: (message: unknown) => Promise<boolean>;
      onDidReceiveMessage?: (cb: (msg: unknown) => void) => void;
      asWebviewUri?: (uri: any) => any;
      options?: any;
      html?: string;
    };
    type DisposableLike = {dispose: () => void};
    type WebviewViewLike = {
      webview: WebviewLike;
      onDidChangeVisibility: (cb: () => void) => DisposableLike;
      onDidDispose: (cb: () => void) => void;
    };

    const pm = vi.fn(async () => true);
    const webview: WebviewLike = {
      postMessage: pm,
      asWebviewUri: vi.fn((uri) => uri),
    };

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

    prov.resolveWebviewView(webviewView as unknown as any, {} as any, {} as any);
    return {postMessage: pm, send: (msg: unknown) => handler?.(msg)};
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock workspace methods
    (vscode.workspace as any).onDidChangeConfiguration = vi.fn(() => ({dispose: vi.fn()}));
    (vscode.workspace as any).getConfiguration = vi.fn(() => ({
      get: vi.fn((key: string) => {
        if (key === 'serverUrl') return 'http://localhost:8000';
        return undefined;
      }),
    }));
    (vscode.workspace as any).createFileSystemWatcher = vi.fn(() => ({
      onDidChange: vi.fn(() => ({dispose: vi.fn()})),
      onDidCreate: vi.fn(() => ({dispose: vi.fn()})),
      onDidDelete: vi.fn(() => ({dispose: vi.fn()})),
      dispose: vi.fn(),
    }));

    api = new ApiService({} as any);
    stream = new StreamService({} as any);
    history = new HistoryService(api);
    const dialog = new DialogService(api);
    const config = new ConfigService();

    provider = new ChatWebviewProvider(vscode.Uri.file('/ext'), stream, history, dialog, config, api);

    const webviewSetup = bootWebview(provider);
    postMessage = webviewSetup.postMessage;
    sendMessage = webviewSetup.send;

    // Initialize webview
    sendMessage({type: WEBVIEW_IN_MSG.READY});
  });

  it('should NOT reload history when stream ends with ERROR event', async () => {
    const dialogId = 'test-dialog-123';

    // Mock getCurrentDialog to return our test dialog
    vi.spyOn(api, 'getCurrentDialog').mockResolvedValue({id: dialogId});

    // Mock loadHistory to track if it's called
    const loadHistorySpy = vi.spyOn(api, 'loadHistory').mockResolvedValue({
      dialog_id: dialogId,
      events: [],
      total_events: 0,
      has_more: false,
      first_idx: null,
      last_idx: null,
    });

    // Mock streamChat to emit ERROR followed by DONE
    async function* mockStreamWithError(): AsyncGenerator<SSEEvent> {
      yield {type: E.USER, content: 'test message', dialog_id: dialogId};
      yield {type: E.CHAT_START, dialog_id: dialogId};
      yield {type: E.CHAT, content: 'response', dialog_id: dialogId};
      yield {type: E.ERROR, error: 'Something went wrong', dialog_id: dialogId};
      yield {type: E.DONE, dialog_id: dialogId};
    }

    vi.spyOn(stream, 'streamChat').mockImplementation(mockStreamWithError);

    // Clear any calls from initialization
    loadHistorySpy.mockClear();
    postMessage.mockClear();

    // Send a message to trigger the stream
    sendMessage({type: WEBVIEW_IN_MSG.SEND_MESSAGE, text: 'test'});

    // Wait for stream to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify error was shown
    const errorMessages = postMessage.mock.calls.filter((call) => call[0]?.type === WEBVIEW_OUT_MSG.SHOW_ERROR);
    expect(errorMessages.length).toBeGreaterThan(0);

    // Verify history was NOT reloaded (loadHistory should not be called after the error)
    // Note: it might be called once during initialization, but not after the error
    const historyCallsAfterInit = loadHistorySpy.mock.calls.length;
    expect(historyCallsAfterInit).toBe(0);
  });

  it('should reload history when stream ends successfully without ERROR', async () => {
    const dialogId = 'test-dialog-456';

    // Mock getCurrentDialog
    vi.spyOn(api, 'getCurrentDialog').mockResolvedValue({id: dialogId});

    // Mock loadHistory
    const loadHistorySpy = vi.spyOn(api, 'loadHistory').mockResolvedValue({
      dialog_id: dialogId,
      events: [
        {type: 'user', content: 'test message', idx: 0},
        {type: E.CHAT, content: 'response', idx: 1},
      ],
      total_events: 2,
      has_more: false,
      first_idx: 0,
      last_idx: 1,
    });

    // Mock streamChat to emit normal flow (no error)
    async function* mockStreamSuccess(): AsyncGenerator<SSEEvent> {
      yield {type: E.USER, content: 'test message', dialog_id: dialogId};
      yield {type: E.CHAT_START, dialog_id: dialogId};
      yield {type: E.CHAT, content: 'response', dialog_id: dialogId};
      yield {type: E.CHAT_END, dialog_id: dialogId};
      yield {type: E.DONE, dialog_id: dialogId};
    }

    vi.spyOn(stream, 'streamChat').mockImplementation(mockStreamSuccess);

    // Clear any calls from initialization
    loadHistorySpy.mockClear();
    postMessage.mockClear();

    // Send a message to trigger the stream
    sendMessage({type: WEBVIEW_IN_MSG.SEND_MESSAGE, text: 'test'});

    // Wait for stream to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify history WAS reloaded
    expect(loadHistorySpy).toHaveBeenCalled();

    // Verify HISTORY_REPLACE_ALL was sent
    const historyReplaceMessages = postMessage.mock.calls.filter(
      (call) => call[0]?.type === WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL,
    );
    expect(historyReplaceMessages.length).toBeGreaterThan(0);
  });

  it('should handle ERROR followed by connection error gracefully', async () => {
    const dialogId = 'test-dialog-789';

    vi.spyOn(api, 'getCurrentDialog').mockResolvedValue({id: dialogId});

    const loadHistorySpy = vi.spyOn(api, 'loadHistory').mockResolvedValue({
      dialog_id: dialogId,
      events: [],
      total_events: 0,
      has_more: false,
      first_idx: null,
      last_idx: null,
    });

    // Mock streamChat to emit ERROR then throw
    async function* mockStreamWithErrorAndThrow(): AsyncGenerator<SSEEvent> {
      yield {type: E.USER, content: 'test message', dialog_id: dialogId};
      yield {type: E.CHAT_START, dialog_id: dialogId};
      yield {type: E.ERROR, error: 'Stream error', dialog_id: dialogId};
      throw new Error('Connection lost');
    }

    vi.spyOn(stream, 'streamChat').mockImplementation(mockStreamWithErrorAndThrow);

    loadHistorySpy.mockClear();
    postMessage.mockClear();

    sendMessage({type: WEBVIEW_IN_MSG.SEND_MESSAGE, text: 'test'});

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should show error message
    const errorMessages = postMessage.mock.calls.filter((call) => call[0]?.type === WEBVIEW_OUT_MSG.SHOW_ERROR);
    expect(errorMessages.length).toBeGreaterThan(0);

    // Should NOT reload history
    expect(loadHistorySpy).not.toHaveBeenCalled();
  });

  it('should reload history when DONE arrives without any ERROR events', async () => {
    const dialogId = 'test-dialog-clean';

    vi.spyOn(api, 'getCurrentDialog').mockResolvedValue({id: dialogId});

    const loadHistorySpy = vi.spyOn(api, 'loadHistory').mockResolvedValue({
      dialog_id: dialogId,
      events: [],
      total_events: 0,
      has_more: false,
      first_idx: null,
      last_idx: null,
    });

    // Mock streamChat with minimal successful flow
    async function* mockMinimalStream(): AsyncGenerator<SSEEvent> {
      yield {type: E.USER, content: 'hi', dialog_id: dialogId};
      yield {type: E.DONE, dialog_id: dialogId};
    }

    vi.spyOn(stream, 'streamChat').mockImplementation(mockMinimalStream);

    loadHistorySpy.mockClear();
    postMessage.mockClear();

    sendMessage({type: WEBVIEW_IN_MSG.SEND_MESSAGE, text: 'hi'});

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should reload history since there was no error
    expect(loadHistorySpy).toHaveBeenCalled();
  });
});
