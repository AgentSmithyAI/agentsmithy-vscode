import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import {ChatWebviewProvider} from '../chatWebviewProvider';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../shared/messages';
import {ConfigService} from '../services/ConfigService';
import {ApiService} from '../api/ApiService';

// Mock vscode
vi.mock('vscode', () => {
  // EventEmitter must be defined inside vi.mock since it's hoisted
  class MockEventEmitter<T = void> {
    private listeners: Array<(e: T) => unknown> = [];
    event = (listener: (e: T) => unknown) => {
      this.listeners.push(listener);
      return {dispose: () => this.listeners.splice(this.listeners.indexOf(listener), 1)};
    };
    fire(data?: T) {
      for (const listener of this.listeners) {
        listener(data as T);
      }
    }
    dispose() {
      this.listeners = [];
    }
  }

  return {
    EventEmitter: MockEventEmitter,
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
  };
});

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
      {waitForReady: vi.fn(), hasWorkspace: vi.fn().mockReturnValue(true)} as any,
    );

    // Initialize view
    provider.resolveWebviewView(mockWebviewView as unknown as vscode.WebviewView, {} as any, {} as any);
  });

  it('loads and sends chat workloads on ready', async () => {
    const mockConfig = {
      models: {agents: {universal: {workload: 'gpt-4-codex'}}},
      workloads: {
        'gpt-4-codex': {provider: 'openai', model: 'gpt-4', kind: 'chat'},
        'gpt-5-codex': {provider: 'openai', model: 'gpt-5', kind: 'chat'},
        'text-embed': {provider: 'openai', model: 'text-embedding-3', kind: 'embeddings'},
      },
    };
    const mockMetadata = {
      providers: [{name: 'openai', type: 'openai'}],
      workloads: [
        {name: 'gpt-4-codex', provider: 'openai', model: 'gpt-4', kind: 'chat'},
        {name: 'gpt-5-codex', provider: 'openai', model: 'gpt-5', kind: 'chat'},
        {name: 'text-embed', provider: 'openai', model: 'text-embedding-3', kind: 'embeddings'},
      ],
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

    // Only chat workloads should be sent (not embeddings)
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
        selected: 'gpt-4-codex',
        workloads: [
          {name: 'gpt-4-codex', displayName: 'gpt-4-codex'},
          {name: 'gpt-5-codex', displayName: 'gpt-5-codex'},
        ],
      }),
    );
  });

  it('sends empty list when no chat workloads in metadata', async () => {
    const mockConfig = {
      models: {agents: {universal: {workload: 'some-workload'}}},
    };
    // Empty metadata - no workloads
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

    // Should send empty list when no chat workloads
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
        selected: 'some-workload',
        workloads: [],
      }),
    );
  });

  it('updates universal workload when selecting', async () => {
    const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

    await handler({
      type: WEBVIEW_IN_MSG.SELECT_WORKLOAD,
      workload: 'new-workload',
    });

    // Verify updateConfig called with models.agents.universal.workload
    expect(apiService.updateConfig).toHaveBeenCalledWith({
      models: {
        agents: {
          universal: {
            workload: 'new-workload',
          },
        },
      },
    });
  });

  it('fires onDidChangeConfig event after workload selection', async () => {
    (apiService.updateConfig as any).mockResolvedValue({});
    (apiService.getConfig as any).mockResolvedValue({
      config: {models: {agents: {universal: {workload: 'new-workload'}}}},
      metadata: {workloads: []},
    });

    const listener = vi.fn();
    provider.onDidChangeConfig(listener);

    const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
    await handler({
      type: WEBVIEW_IN_MSG.SELECT_WORKLOAD,
      workload: 'new-workload',
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not fire onDidChangeConfig on selection error', async () => {
    (apiService.updateConfig as any).mockRejectedValue(new Error('update failed'));

    const listener = vi.fn();
    provider.onDidChangeConfig(listener);

    const handler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
    await handler({
      type: WEBVIEW_IN_MSG.SELECT_WORKLOAD,
      workload: 'new-workload',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('refreshWorkloads updates selector from API', async () => {
    const mockConfig = {
      models: {agents: {universal: {workload: 'refreshed-workload'}}},
    };
    const mockMetadata = {
      workloads: [{name: 'refreshed-workload', provider: 'openai', model: 'gpt-5', kind: 'chat'}],
    };

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

    mockWebview.postMessage.mockClear();

    await provider.refreshWorkloads();

    expect(apiService.getConfig).toHaveBeenCalled();
    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
      workloads: [{name: 'refreshed-workload', displayName: 'refreshed-workload'}],
      selected: 'refreshed-workload',
    });
  });

  it('refreshWorkloads does nothing when view is not available', async () => {
    (provider as any)._view = undefined;

    await provider.refreshWorkloads();

    expect(apiService.getConfig).not.toHaveBeenCalled();
  });
});
