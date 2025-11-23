import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {ApiService} from '../api/ApiService';
import {ConfigService} from '../services/ConfigService';
import {StreamService} from '../api/StreamService';
import {HistoryService} from '../services/HistoryService';
import {DialogService} from '../services/DialogService';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../shared/messages';
import {ServerManager} from '../services/ServerManager';

// Mock vscode
vi.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({fsPath: path, with: vi.fn(), toString: () => path}),
    joinPath: (...args: any[]) => ({fsPath: args.join('/'), with: vi.fn(), toString: () => args.join('/')}),
  },
  window: {
    createOutputChannel: vi.fn(() => ({appendLine: vi.fn(), dispose: vi.fn()})),
    showErrorMessage: vi.fn(),
    activeTextEditor: undefined,
  },
  workspace: {
    getConfiguration: vi.fn(),
    openTextDocument: vi.fn(),
  },
  ConfigurationTarget: {
    Global: 1,
  },
  WebviewViewProvider: class {},
  Disposable: {
    from: vi.fn(),
  },
}));

describe('ChatWebviewProvider Full Flow', () => {
  let provider: ChatWebviewProvider;
  let apiService: ApiService;
  let streamService: StreamService;
  let historyService: HistoryService;
  let dialogService: DialogService;
  let configService: ConfigService;
  let serverManager: ServerManager;
  let context: vscode.ExtensionContext;
  let webviewPostMessage: any;

  beforeEach(() => {
    webviewPostMessage = vi.fn();

    // Mock Webview
    const mockWebview = {
      options: {},
      html: '',
      onDidReceiveMessage: vi.fn(),
      asWebviewUri: vi.fn((uri) => uri),
      cspSource: 'self',
      postMessage: webviewPostMessage,
    };

    const mockWebviewView = {
      webview: mockWebview,
      show: vi.fn(),
      onDidChangeVisibility: vi.fn(),
      onDidDispose: vi.fn(),
    };

    // Services
    apiService = {
      getConfig: vi.fn().mockResolvedValue({config: {}, metadata: {}}),
      updateConfig: vi.fn(),
      approveSession: vi.fn(),
      resetToApproved: vi.fn(),
      getSessionStatus: vi.fn().mockResolvedValue({has_unapproved: false, changed_files: []}),
    } as unknown as ApiService;

    streamService = {
      streamChat: vi.fn(),
      abort: vi.fn(),
    } as unknown as StreamService;

    historyService = {
      onDidChangeState: vi.fn(),
      currentDialogId: 'dialog-1',
      resolveCurrentDialogId: vi.fn().mockResolvedValue('dialog-1'),
      loadLatest: vi.fn().mockResolvedValue({events: [], hasMore: false}),
    } as unknown as HistoryService;

    dialogService = {
      loadDialogs: vi.fn(),
      dialogs: [],
    } as unknown as DialogService;

    configService = {
      getWorkspaceRoot: vi.fn().mockReturnValue('/root'),
    } as unknown as ConfigService;

    serverManager = {
      waitForReady: vi.fn().mockResolvedValue(undefined),
    } as unknown as ServerManager;

    context = {
      extensionUri: vscode.Uri.file('/'),
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    provider = new ChatWebviewProvider(
      vscode.Uri.file('/'),
      streamService,
      historyService,
      dialogService,
      configService,
      apiService,
      serverManager,
      context,
    );

    // Initialize view
    provider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );
  });

  it('SEND_MESSAGE triggers stream and forwards events to webview', async () => {
    // Mock stream generator with explicit chat_start
    async function* mockStream() {
      yield {type: 'chat_start'};
      yield {type: 'chat', content: 'Hello'};
      yield {type: 'chat', content: ' World'};
      yield {type: 'chat_end'};
    }
    (streamService.streamChat as any).mockReturnValue(mockStream());

    // Send message from webview
    const handler = (provider as any)._view.webview.onDidReceiveMessage.mock.calls[0][0];
    await handler({type: WEBVIEW_IN_MSG.SEND_MESSAGE, text: 'Hi there'});

    // Check stream service called with correct args
    expect(streamService.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{role: 'user', content: 'Hi there'}],
        stream: true,
        dialog_id: 'dialog-1',
      }),
    );

    // Check webview received stream events in correct order
    // We use expect.objectContaining because postMessage sends objects
    const calls = webviewPostMessage.mock.calls.map((args: any[]) => args[0]);

    expect(calls).toContainEqual(expect.objectContaining({type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE}));
    expect(calls).toContainEqual(
      expect.objectContaining({type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT, content: 'Hello'}),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT, content: ' World'}),
    );
    expect(calls).toContainEqual(expect.objectContaining({type: WEBVIEW_OUT_MSG.END_ASSISTANT_MESSAGE}));
  });

  it('APPROVE_SESSION calls API and updates status', async () => {
    // Setup API response
    (apiService.approveSession as any).mockResolvedValue({});
    (apiService.getSessionStatus as any).mockResolvedValue({
      has_unapproved: false,
      changed_files: [],
    });

    const handler = (provider as any)._view.webview.onDidReceiveMessage.mock.calls[0][0];
    await handler({type: WEBVIEW_IN_MSG.APPROVE_SESSION, dialogId: 'dialog-1'});

    expect(apiService.approveSession).toHaveBeenCalledWith('dialog-1');
    expect(apiService.getSessionStatus).toHaveBeenCalledWith('dialog-1');

    // Check status update sent to webview
    expect(webviewPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE,
        hasUnapproved: false,
      }),
    );
  });
});
