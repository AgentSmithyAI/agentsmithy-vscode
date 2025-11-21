import {describe, it, expect, beforeEach, vi} from 'vitest';
import {createVSCodeMock} from './mocks/vscode';
import {ConfigWebviewProvider} from '../configWebviewProvider';
import type {ApiService} from '../api/ApiService';
import * as vscode from 'vscode';

vi.mock('vscode', () => {
  const mock = createVSCodeMock();
  mock.window.createWebviewPanel = vi.fn();
  return mock;
});

describe('ConfigWebviewProvider - validation refresh', () => {
  let provider: ConfigWebviewProvider;
  let apiService: {
    getConfig: ReturnType<typeof vi.fn>;
    getHealth: ReturnType<typeof vi.fn>;
    updateConfig: ReturnType<typeof vi.fn>;
  };
  let mockPanel: {
    webview: {postMessage: ReturnType<typeof vi.fn>};
  };

  beforeEach(() => {
    apiService = {
      getConfig: vi.fn().mockResolvedValue({config: {}, metadata: null}),
      getHealth: vi.fn(),
      updateConfig: vi.fn(),
    };

    provider = new ConfigWebviewProvider(vscode.Uri.file('/tmp'), apiService as unknown as ApiService);
    mockPanel = {
      webview: {
        postMessage: vi.fn(),
      },
    };
    (provider as any).panel = mockPanel;
    (provider as any).webviewReady = true;
  });

  it('posts validation errors when health reports invalid config', async () => {
    apiService.getHealth.mockResolvedValue({
      config_valid: false,
      config_errors: ['Missing API key'],
    });

    await (provider as any).loadConfig();

    expect(apiService.getHealth).toHaveBeenCalled();
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'validationErrors',
      errors: ['Missing API key'],
    });
  });

  it('clears validation errors when health reports valid config', async () => {
    apiService.getHealth.mockResolvedValue({
      config_valid: true,
      config_errors: [],
    });

    await (provider as any).loadConfig();

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'validationErrors',
      errors: [],
    });
  });

  it('refreshes validation on show when panel already exists', async () => {
    const panel = {
      reveal: vi.fn(),
      webview: {postMessage: vi.fn()},
    };
    (provider as any).panel = panel;
    (provider as any).webviewReady = true;
    const refreshSpy = vi.spyOn(provider as any, 'refreshValidationErrors').mockResolvedValue(undefined);

    await provider.show();

    expect(panel.reveal).toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalled();
  });
});
