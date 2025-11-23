import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ServerManager} from '../ServerManager';
import * as vscode from 'vscode';

const downloadManagerMock = {
  fetchLatestRelease: vi.fn(),
  getLatestInstalled: vi.fn(),
  compareVersions: vi.fn(),
  verifyIntegrity: vi.fn(),
  verifySHA256: vi.fn(),
  downloadBinary: vi.fn(),
  cleanupOldVersions: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
};
vi.mock('../server/DownloadManager', () => ({
  DownloadManager: class {
    constructor() {
      return downloadManagerMock;
    }
  },
}));

const processManagerMock = {
  isAlive: vi.fn().mockReturnValue(false),
  start: vi.fn(),
  stop: vi.fn(),
  getStatus: vi.fn().mockResolvedValue({running: false, port: null, pid: null}),
};
vi.mock('../server/ProcessManager', () => ({
  ProcessManager: class {
    constructor() {
      return processManagerMock;
    }
  },
}));

describe('ServerManager checkHealthStatus', () => {
  let manager: ServerManager;
  let configInvalidEvents: Array<{errors: string[]}>;
  let outputChannel: {appendLine: ReturnType<typeof vi.fn>};

  const createManager = () => {
    const context = {
      globalStorageUri: vscode.Uri.file('/tmp/agent-smithy'),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    const configService = {
      getServerUrl: vi.fn().mockReturnValue('http://localhost:9999'),
      getWorkspaceRoot: vi.fn().mockReturnValue('/tmp/workspace'),
    };
    return new ServerManager(context, configService);
  };

  beforeEach(() => {
    for (const fn of Object.values(downloadManagerMock)) {
      fn.mock?.reset?.();
    }
    for (const fn of Object.values(processManagerMock)) {
      fn.mock?.reset?.();
    }
    configInvalidEvents = [];
    manager = createManager();
    manager.onConfigInvalid((payload) => configInvalidEvents.push(payload));
    outputChannel = (manager as any).outputChannel;
  });

  it('emits config invalid event when health reports errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        config_valid: false,
        config_errors: ['Missing API key', 'Invalid base URL'],
      }),
    }) as unknown as typeof fetch;

    await (manager as any).checkHealthStatus();

    expect(configInvalidEvents).toEqual([{errors: ['Missing API key', 'Invalid base URL']}]);
    expect(outputChannel.appendLine).toHaveBeenCalledWith('Config valid: false');
    expect(outputChannel.appendLine).toHaveBeenCalledWith('Config errors:\n  - Missing API key\n  - Invalid base URL');
  });

  it('filters non-string errors before emitting', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        config_valid: false,
        config_errors: ['Valid string', {foo: 'bar'}, 42],
      }),
    }) as unknown as typeof fetch;

    await (manager as any).checkHealthStatus();

    expect(configInvalidEvents).toEqual([{errors: ['Valid string']}]);
  });

  it('does nothing when config is valid', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        config_valid: true,
        config_errors: ['should be ignored'],
      }),
    }) as unknown as typeof fetch;

    await (manager as any).checkHealthStatus();

    expect(configInvalidEvents).toEqual([]);
    expect(outputChannel.appendLine).toHaveBeenCalledWith('Config valid: true');
    expect(outputChannel.appendLine).toHaveBeenCalledTimes(1);
  });

  it('logs and aborts when health endpoint responds with non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch;

    await (manager as any).checkHealthStatus();

    expect(outputChannel.appendLine).toHaveBeenCalledWith('Health check failed: 503');
    expect(configInvalidEvents).toEqual([]);
  });

  it('logs failure when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    await (manager as any).checkHealthStatus();

    expect(outputChannel.appendLine).toHaveBeenCalledWith('Failed to check health status: network down');
  });

  it('logs placeholder when config errors is not an array', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        config_valid: false,
        config_errors: 'oops',
      }),
    }) as unknown as typeof fetch;

    await (manager as any).checkHealthStatus();

    expect(outputChannel.appendLine).toHaveBeenCalledWith('Config errors:\n  - (no details provided)');
    expect(configInvalidEvents).toEqual([{errors: []}]);
  });

  describe('startServer', () => {
    it('returns existing promise when already starting', async () => {
      const existingPromise = Promise.resolve();
      (manager as any).isStarting = true;
      (manager as any).startPromise = existingPromise;

      const returned = manager.startServer();

      expect(processManagerMock.start).not.toHaveBeenCalled();
      expect(outputChannel.appendLine).toHaveBeenCalledWith(
        'Server is already starting, waiting on existing operation...',
      );
      await returned;
    });
  });

  describe('ensureServer', () => {
    it('skips download when installed version is valid', async () => {
      downloadManagerMock.fetchLatestRelease.mockResolvedValue({
        version: 'v1.0.0',
        size: 10,
        sha256: 'abc',
      });
      downloadManagerMock.getLatestInstalled.mockReturnValue('1.0.0');
      downloadManagerMock.compareVersions.mockReturnValue(0);
      downloadManagerMock.verifyIntegrity.mockResolvedValue(true);
      downloadManagerMock.verifySHA256.mockResolvedValue(true);

      await (manager as any).ensureServer();

      expect(downloadManagerMock.downloadBinary).not.toHaveBeenCalled();
    });
  });
});
