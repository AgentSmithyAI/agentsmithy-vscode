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

  it('saveConfig clears validation errors and posts CONFIG_SAVED', async () => {
    apiService.updateConfig.mockResolvedValue({config: {}});
    apiService.getHealth.mockResolvedValue({config_valid: true, config_errors: []});

    (provider as any).panel = mockPanel;
    (provider as any).webviewReady = true;
    (provider as any).pendingValidationErrors = ['stale'];

    await (provider as any).saveConfig({providers: {}});

    expect(apiService.updateConfig).toHaveBeenCalledWith({providers: {}});
    expect((provider as any).pendingValidationErrors).toEqual([]);
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({type: 'loading'});
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({type: 'validationErrors', errors: []});
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({type: 'configSaved', data: {config: {}}});
  });

  it('saveConfig posts error when update fails', async () => {
    apiService.updateConfig.mockRejectedValue(new Error('boom'));

    (provider as any).panel = mockPanel;
    (provider as any).webviewReady = true;

    await (provider as any).saveConfig({});

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({type: 'loading'});
    const errorPayload = mockPanel.webview.postMessage.mock.calls.find(([msg]) => msg.type === 'error')?.[0];
    expect(errorPayload).toBeDefined();
    expect(errorPayload.message).toContain('Failed to save configuration');
  });

  it('loadConfig posts error message when getConfig fails', async () => {
    apiService.getConfig.mockRejectedValue(new Error('load failed'));

    await (provider as any).loadConfig();

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({type: 'loading'});
    const errorPayload = mockPanel.webview.postMessage.mock.calls.find(([msg]) => msg.type === 'error')?.[0];
    expect(errorPayload).toBeDefined();
    expect(errorPayload.message).toContain('Failed to load configuration');
  });

  it('refreshValidationErrors keeps existing errors when health check fails', async () => {
    (provider as any).panel = mockPanel;
    (provider as any).webviewReady = true;
    (provider as any).pendingValidationErrors = ['original'];
    apiService.getHealth.mockRejectedValue(new Error('boom'));

    await (provider as any).refreshValidationErrors();

    expect((provider as any).pendingValidationErrors).toEqual(['original']);
    const validationPayload = mockPanel.webview.postMessage.mock.calls.find(
      ([msg]) => msg.type === 'validationErrors',
    )?.[0];
    expect(validationPayload).toEqual({type: 'validationErrors', errors: ['original']});
  });

  it('gates validation posting until webview is ready', () => {
    const panel = {
      webview: {postMessage: vi.fn()},
    };
    (provider as any).panel = panel;
    (provider as any).webviewReady = false;
    (provider as any).pendingValidationErrors = ['Missing API key'];

    (provider as any).postValidationErrors();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();

    (provider as any).webviewReady = true;
    (provider as any).postValidationErrors();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'validationErrors',
      errors: ['Missing API key'],
    });
  });

  it('marks webview ready on READY message and loads config', async () => {
    const loadSpy = vi.spyOn(provider as any, 'loadConfig').mockResolvedValue(undefined);
    (provider as any).webviewReady = false;
    expect((provider as any).webviewReady).toBe(false);

    await (provider as any).handleMessage({type: 'ready'});

    expect(loadSpy).toHaveBeenCalled();
    expect((provider as any).webviewReady).toBe(true);
  });

  it('handles saveConfig message payloads', async () => {
    const saveSpy = vi.spyOn(provider as any, 'saveConfig').mockResolvedValue(undefined);
    const payload = {providers: {openai: {api_key: 'sk'}}};

    await (provider as any).handleMessage({type: 'saveConfig', config: payload});

    expect(saveSpy).toHaveBeenCalledWith(payload);
  });

  it('handles showInputBox message and returns result', async () => {
    (vscode.window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue('my-provider');

    await (provider as any).handleMessage({
      type: 'showInputBox',
      requestId: 'input_1',
      prompt: 'Enter provider name:',
      placeholder: 'e.g., my-openai',
    });

    expect(vscode.window.showInputBox).toHaveBeenCalledWith({
      prompt: 'Enter provider name:',
      placeHolder: 'e.g., my-openai',
      value: undefined,
    });
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'inputResult',
      requestId: 'input_1',
      value: 'my-provider',
    });
  });

  it('handles showInputBox cancellation (returns null)', async () => {
    (vscode.window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await (provider as any).handleMessage({
      type: 'showInputBox',
      requestId: 'input_2',
      prompt: 'Enter name:',
    });

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'inputResult',
      requestId: 'input_2',
      value: null,
    });
  });

  it('handles showQuickPick message and returns selected item', async () => {
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValue('openai');

    await (provider as any).handleMessage({
      type: 'showQuickPick',
      requestId: 'pick_1',
      items: ['openai', 'anthropic', 'azure'],
      placeholder: 'Select provider type',
    });

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(['openai', 'anthropic', 'azure'], {
      placeHolder: 'Select provider type',
    });
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'quickPickResult',
      requestId: 'pick_1',
      value: 'openai',
    });
  });

  it('handles showQuickPick cancellation (returns null)', async () => {
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await (provider as any).handleMessage({
      type: 'showQuickPick',
      requestId: 'pick_2',
      items: ['a', 'b'],
    });

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'quickPickResult',
      requestId: 'pick_2',
      value: null,
    });
  });

  it('handles showConfirm message and returns true when confirmed', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Yes');

    await (provider as any).handleMessage({
      type: 'showConfirm',
      requestId: 'confirm_1',
      message: 'Delete provider "test"?',
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Delete provider "test"?',
      {modal: true},
      'Yes',
      'No',
    );
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'confirmResult',
      requestId: 'confirm_1',
      confirmed: true,
    });
  });

  it('handles showConfirm message and returns false when declined', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('No');

    await (provider as any).handleMessage({
      type: 'showConfirm',
      requestId: 'confirm_2',
      message: 'Delete?',
    });

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'confirmResult',
      requestId: 'confirm_2',
      confirmed: false,
    });
  });

  it('handles showConfirm cancellation (returns false)', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await (provider as any).handleMessage({
      type: 'showConfirm',
      requestId: 'confirm_3',
      message: 'Delete?',
    });

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'confirmResult',
      requestId: 'confirm_3',
      confirmed: false,
    });
  });

  it('resets state when panel is disposed', async () => {
    const disposeHandlers: Array<() => void> = [];
    apiService.getHealth.mockResolvedValue({config_valid: true, config_errors: []});
    const panel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((value) => value),
        onDidReceiveMessage: vi.fn(() => ({dispose: vi.fn()})),
      },
      iconPath: undefined,
      reveal: vi.fn(),
      onDidDispose: vi.fn((cb: () => void) => {
        disposeHandlers.push(cb);
        return {dispose: vi.fn()};
      }),
    };
    (provider as any).panel = undefined;
    (provider as any).webviewReady = false;
    (vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(panel as any);

    await provider.show(['initial']);
    expect(disposeHandlers).toHaveLength(1);

    disposeHandlers[0]();
    expect((provider as any).panel).toBeUndefined();
    expect((provider as any).webviewReady).toBe(false);
    expect((provider as any).pendingValidationErrors).toEqual([]);
  });
});
