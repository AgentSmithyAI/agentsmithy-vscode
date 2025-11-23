import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {WEBVIEW_OUT_MSG} from '../shared/messages';
import {ConfigService} from '../services/ConfigService';
import {ApiService} from '../api/ApiService';

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
  },
  WebviewViewProvider: class {},
  Disposable: {
    from: vi.fn(),
  },
}));

// Mock dependencies
const mockWebview = {
  postMessage: vi.fn(),
  asWebviewUri: vi.fn((uri) => uri), // Return URI itself which has toString from our mock
  options: {},
  html: '',
  onDidReceiveMessage: vi.fn(),
  cspSource: 'self',
};

const mockWebviewView = {
  webview: mockWebview,
  show: vi.fn(),
  onDidChangeVisibility: vi.fn(),
  onDidDispose: vi.fn(),
};

describe('ChatWebviewProvider - Workloads Loading', () => {
  let provider: ChatWebviewProvider;
  let apiService: ApiService;
  let configService: ConfigService;

  beforeEach(() => {
    apiService = {
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
    } as unknown as ApiService;

    configService = {
      getWorkspaceRoot: vi.fn(),
    } as unknown as ConfigService;

    provider = new ChatWebviewProvider(
      vscode.Uri.file('/'),
      {} as any,
      {onDidChangeState: vi.fn()} as any,
      {} as any,
      configService,
      apiService,
      {waitForReady: vi.fn()} as any,
    );

    // Initialize view
    provider.resolveWebviewView(mockWebviewView as unknown as vscode.WebviewView, {} as any, {} as any);
  });

  it('loads and sends workloads on ready', async () => {
    const mockConfig = {
      models: {agents: {reasoning: {workload: 'my-reasoning'}}},
      workloads: {
        'my-reasoning': {provider: 'openai', model: 'gpt-4'},
      },
    };
    const mockMetadata = {
      providers: [{name: 'openai', type: 'openai_type'}],
      model_catalog: {
        openai_type: {chat: ['gpt-4', 'gpt-5']},
      },
    };

    (apiService.getConfig as any).mockResolvedValue({
      config: mockConfig,
      metadata: mockMetadata,
    });

    // Mock private methods dependencies
    (provider as any)._historyService = {
      resolveCurrentDialogId: vi.fn().mockResolvedValue('dialog-1'),
      loadLatest: vi.fn().mockResolvedValue({events: []}),
      onDidChangeState: vi.fn(),
      currentDialogId: undefined, // allow setter
    };
    (provider as any)._dialogService = {
      loadDialogs: vi.fn(),
      dialogs: [],
      getDialogDisplayTitle: vi.fn(),
    };

    await provider.refreshAfterServerStart();

    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
        selected: 'gpt-4',
        workloads: [
          {name: 'gpt-4', displayName: 'gpt-4'},
          {name: 'gpt-5', displayName: 'gpt-5'},
        ],
      }),
    );
  });

  it('defaults to current model if catalog is empty', async () => {
    const mockConfig = {
      models: {agents: {reasoning: {workload: 'reasoning'}}},
      workloads: {
        reasoning: {provider: 'openai', model: 'custom-model'},
      },
    };
    // Empty metadata
    const mockMetadata = {};

    (apiService.getConfig as any).mockResolvedValue({
      config: mockConfig,
      metadata: mockMetadata,
    });

    // Mock private deps
    (provider as any)._historyService = {
      resolveCurrentDialogId: vi.fn().mockResolvedValue('dialog-1'),
      loadLatest: vi.fn().mockResolvedValue({events: []}),
      onDidChangeState: vi.fn(),
      currentDialogId: undefined,
    };
    (provider as any)._dialogService = {
      loadDialogs: vi.fn(),
      dialogs: [],
      getDialogDisplayTitle: vi.fn(),
    };

    await provider.refreshAfterServerStart();

    // Should still send the current model
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
        selected: 'custom-model',
        workloads: [{name: 'custom-model', displayName: 'custom-model'}],
      }),
    );
  });
});
