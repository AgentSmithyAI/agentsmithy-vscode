import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
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
      getWorkspaceRoot: vi.fn(),
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
      } as unknown as HistoryService,
      {} as DialogService,
      configService,
      apiService,
      {waitForReady: vi.fn().mockResolvedValue(undefined)},
      context,
    );

    // Trigger resolve to attach listeners
    provider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );
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
});
