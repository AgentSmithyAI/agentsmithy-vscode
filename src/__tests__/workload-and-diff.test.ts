import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';

// Mock vscode
vi.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({fsPath: path, with: vi.fn(), toString: () => path}),
    joinPath: (...args: any[]) => ({fsPath: args.join('/'), with: vi.fn(), toString: () => args.join('/')}),
  },
  window: {
    createOutputChannel: vi.fn(() => ({appendLine: vi.fn(), dispose: vi.fn()})),
    showErrorMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(),
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  WebviewViewProvider: class {},
  Disposable: {
    from: vi.fn(),
  },
}));

import {ApiService} from '../api/ApiService';
import {ConfigService} from '../services/ConfigService';
import {StreamService} from '../api/StreamService';
import {HistoryService} from '../services/HistoryService';
import {DialogService} from '../services/DialogService';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../shared/messages';

// Mocks
const mockWebview = {
  options: {},
  html: '',
  onDidReceiveMessage: vi.fn(),
  asWebviewUri: vi.fn((uri) => uri),
  cspSource: 'self',
  postMessage: vi.fn(),
};

const mockWebviewView = {
  webview: mockWebview,
  show: vi.fn(),
  onDidChangeVisibility: vi.fn(),
  onDidDispose: vi.fn(),
};

describe('ChatWebviewProvider - Workload and Diff', () => {
  let provider: ChatWebviewProvider;
  let apiService: ApiService;
  let configService: ConfigService;
  let context: vscode.ExtensionContext;
  let diffConfigUpdateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock VS Code config
    diffConfigUpdateSpy = vi.fn();
    const getConfigurationMock = vi.fn().mockReturnValue({
      get: vi.fn((key, def) => (key === 'renderSideBySide' ? true : def)),
      update: diffConfigUpdateSpy,
    });
    vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(getConfigurationMock);

    // Mock services
    apiService = {
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
    } as unknown as ApiService;

    configService = {
      getWorkspaceRoot: vi.fn().mockReturnValue('/home/user/project'),
    } as unknown as ConfigService;

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
      {} as StreamService,
      {
        onDidChangeState: vi.fn(),
        currentDialogId: 'dialog-1',
        resolveCurrentDialogId: vi.fn().mockResolvedValue('dialog-1'),
        loadLatest: vi.fn().mockResolvedValue({events: [], hasMore: false}),
      } as unknown as HistoryService,
      {
        loadDialogs: vi.fn().mockResolvedValue(undefined),
        dialogs: [],
        getDialogDisplayTitle: vi.fn(),
        currentDialog: null,
      } as unknown as DialogService,
      configService,
      apiService,
      {waitForReady: vi.fn().mockResolvedValue(undefined)},
    );

    // Trigger resolve to attach listeners
    provider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );
  });

  describe('OPEN_FILE', () => {
    it('opens file inside workspace', async () => {
      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      const file = '/home/user/project/src/file.ts';

      // Mock vscode.workspace.openTextDocument
      (vscode.workspace.openTextDocument as any) = vi.fn().mockResolvedValue({});
      (vscode.window.showTextDocument as any) = vi.fn();

      await handler({
        type: WEBVIEW_IN_MSG.OPEN_FILE,
        file,
      });

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({fsPath: file}));
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });

    it('blocks file outside workspace', async () => {
      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      const file = '/etc/passwd';

      // Reset mocks
      (vscode.workspace.openTextDocument as any) = vi.fn();
      (vscode.window.showTextDocument as any) = vi.fn();

      await handler({
        type: WEBVIEW_IN_MSG.OPEN_FILE,
        file,
      });

      // Should NOT open
      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
      // Should show error message
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('File outside workspace'));
    });

    it('resolves relative paths from workspace root', async () => {
      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      const file = 'src/file.ts'; // Relative path
      const expectedAbsPath = '/home/user/project/src/file.ts'; // Since mock workspace is /home/user/project

      // Mock path.resolve to work in test environment same as real execution
      // Note: in real execution path is node's path module

      (vscode.workspace.openTextDocument as any) = vi.fn().mockResolvedValue({});

      await handler({
        type: WEBVIEW_IN_MSG.OPEN_FILE,
        file,
      });

      // Should resolve to absolute path
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({fsPath: expectedAbsPath}),
      );
    });
  });

  describe('TOGGLE_DIFF_VIEW', () => {
    it('toggles diff editor renderSideBySide setting', async () => {
      // Get the message handler
      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

      // Simulate message
      await handler({type: WEBVIEW_IN_MSG.TOGGLE_DIFF_VIEW});

      // Verify config update (toggle true -> false)
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('diffEditor');
      expect(diffConfigUpdateSpy).toHaveBeenCalledWith('renderSideBySide', false, vscode.ConfigurationTarget.Global);
    });
  });

  describe('SELECT_WORKLOAD', () => {
    it('updates workload model in config', async () => {
      // Mock current config
      const mockConfig = {
        models: {
          agents: {
            reasoning: {workload: 'my-reasoning'},
          },
        },
        workloads: {
          'my-reasoning': {provider: 'openai', model: 'old-model'},
        },
      };

      (apiService.getConfig as any).mockResolvedValue({
        config: mockConfig,
        metadata: {},
      });

      // Get the message handler
      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

      // Simulate select workload "gpt-5"
      await handler({
        type: WEBVIEW_IN_MSG.SELECT_WORKLOAD,
        workload: 'gpt-5',
      });

      // Verify updateConfig called with updated model
      expect(apiService.getConfig).toHaveBeenCalled();
      expect(apiService.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workloads: expect.objectContaining({
            'my-reasoning': expect.objectContaining({
              model: 'gpt-5',
            }),
          }),
        }),
      );
    });

    it('handles missing workload gracefully by creating it', async () => {
      // Config without workloads
      const mockConfig = {models: {}};
      (apiService.getConfig as any).mockResolvedValue({
        config: mockConfig,
        metadata: {},
      });

      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

      await handler({
        type: WEBVIEW_IN_MSG.SELECT_WORKLOAD,
        workload: 'gpt-5',
      });

      // Should create 'reasoning' workload with default provider
      expect(apiService.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workloads: {
            reasoning: {
              provider: 'openai',
              model: 'gpt-5',
            },
          },
        }),
      );
    });
  });

  describe('WORKLOADS_UPDATE', () => {
    it('sends workloads list to webview on ready', async () => {
      // Mock config with reasoning workload
      const mockConfig = {
        models: {
          agents: {
            reasoning: {workload: 'my-reasoning'},
          },
        },
        workloads: {
          'my-reasoning': {provider: 'openai', model: 'gpt-4'},
        },
      };

      const mockMetadata = {
        providers: [{name: 'openai', type: 'openai'}],
        workloads: [
          {name: 'reasoning-gpt4', purpose: 'reasoning', model: 'gpt-4'},
          {name: 'reasoning-gpt5', purpose: 'reasoning', model: 'gpt-5'},
          {name: 'reasoning-3.5', purpose: 'reasoning', model: 'gpt-3.5-turbo'},
        ],
        model_catalog: {
          openai: {
            chat: ['gpt-4', 'gpt-5', 'gpt-3.5-turbo'],
          },
        },
      };

      (apiService.getConfig as any).mockResolvedValue({
        config: mockConfig,
        metadata: mockMetadata,
      });

      // Trigger webview ready handler
      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      await handler({type: WEBVIEW_IN_MSG.READY});

      // Verify postMessage with workloads
      // It might be called multiple times, so we check if ONE of them matches
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
          selected: 'gpt-4',
          workloads: [
            {name: 'gpt-4', displayName: 'gpt-4'},
            {name: 'gpt-5', displayName: 'gpt-5'},
            {name: 'gpt-3.5-turbo', displayName: 'gpt-3.5-turbo'},
          ],
        }),
      );
    });

    it('handles missing reasoning workload by defaulting to "reasoning"', async () => {
      // Mock empty config
      const mockConfig = {};
      const mockMetadata = {};

      (apiService.getConfig as any).mockResolvedValue({
        config: mockConfig,
        metadata: mockMetadata,
      });

      const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      await handler({type: WEBVIEW_IN_MSG.READY});
      await new Promise(process.nextTick);

      // Should try to load but find nothing, still send update with empty list
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
          selected: '',
          workloads: [],
        }),
      );
    });
  });
});
