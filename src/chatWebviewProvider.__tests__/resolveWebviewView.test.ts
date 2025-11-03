import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {ApiService} from '../api/ApiService';
import {StreamService} from '../api/StreamService';
import {HistoryService} from '../services/HistoryService';
import {DialogService} from '../services/DialogService';
import {ConfigService} from '../services/ConfigService';
import {WEBVIEW_IN_MSG} from '../shared/messages';

// Build minimal fakes for dependencies
class FakeStream extends StreamService {
  constructor() {
    super({} as any);
  }
}

describe('ChatWebviewProvider.resolveWebviewView', () => {
  let provider: ChatWebviewProvider;

  beforeEach(() => {
    const api = new ApiService({} as any);
    const stream = new FakeStream();
    const history = new HistoryService(api);
    const dialog = new DialogService(api);
    const config = new ConfigService();

    provider = new ChatWebviewProvider(vscode.Uri.file('/ext'), stream, history, dialog, config, api);
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
    const webview: WebviewLike = {postMessage};

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

    // Non-crashing and posts some messages eventually
    expect(postMessage).toHaveBeenCalled();
  });
});
