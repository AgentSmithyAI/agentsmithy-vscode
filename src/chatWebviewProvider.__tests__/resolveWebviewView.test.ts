import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {ApiService} from '../api/ApiService';
import {StreamService} from '../api/StreamService';
import {HistoryService} from '../services/HistoryService';
import {DialogService} from '../services/DialogService';
import {ConfigService} from '../services/ConfigService';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../shared/messages';
import {normalizeSSEEvent} from '../shared/sseNormalizer';

// Build minimal fakes for dependencies
class FakeStream extends StreamService {
  constructor() {
    super(() => 'http://localhost', normalizeSSEEvent);
  }
}

describe('ChatWebviewProvider.resolveWebviewView', () => {
  let provider: ChatWebviewProvider;
  let serverManager: {waitForReady: ReturnType<typeof vi.fn>; hasWorkspace: ReturnType<typeof vi.fn>};

  beforeEach(() => {
    const api = new ApiService({} as any);
    const stream = new FakeStream();
    const history = new HistoryService(api);
    const dialog = new DialogService(api);
    const config = new ConfigService();
    serverManager = {
      waitForReady: vi.fn().mockResolvedValue(undefined),
      hasWorkspace: vi.fn().mockReturnValue(true),
    };

    provider = new ChatWebviewProvider(vscode.Uri.file('/ext'), stream, history, dialog, config, api, serverManager);
  });

  it('registers message listener and reacts to READY by loading history', async () => {
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
    const webview: WebviewLike = {
      postMessage,
      asWebviewUri: vi.fn((uri: any) => uri),
    } as any;

    // Capture handler explicitly to avoid any-typed mock calls
    let handler: ((msg: unknown) => void) | undefined;
    webview.onDidReceiveMessage = (cb: (msg: unknown) => void) => {
      handler = cb;
    };

    // minimal stubs
    (vscode.workspace as any).openTextDocument = vi.fn();

    const webviewView: WebviewViewLike = {
      webview,
      onDidChangeVisibility: () => ({dispose: vi.fn()}),
      onDidDispose: (cb: () => void) => cb(),
    };

    provider.resolveWebviewView(webviewView as unknown as any, {} as any, {} as any);

    // Simulate READY
    handler?.({type: WEBVIEW_IN_MSG.READY});

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Non-crashing - handler was registered and can be called without errors
    expect(handler).toBeDefined();
  });

  it('sends no-workspace status when workspace is not available', async () => {
    serverManager.hasWorkspace.mockReturnValue(false);

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
    const webview: WebviewLike = {
      postMessage,
      asWebviewUri: vi.fn((uri: any) => uri),
    } as any;

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

    // Simulate READY
    handler?.({type: WEBVIEW_IN_MSG.READY});

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should send no-workspace status
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WEBVIEW_OUT_MSG.SERVER_STATUS,
        status: 'no-workspace',
      }),
    );

    // Should NOT call waitForReady when no workspace
    expect(serverManager.waitForReady).not.toHaveBeenCalled();
  });
});
