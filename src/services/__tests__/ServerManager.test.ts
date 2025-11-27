/* eslint-disable @typescript-eslint/no-misused-promises */
import {describe, it, expect, beforeEach, vi} from 'vitest';
// Mock vscode MUST be before imports

const listeners: Array<(e: any) => void> = [];

vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    ProgressLocation: {
      Notification: 15,
    },
    Uri: {
      file: (path: string) => ({fsPath: path, scheme: 'file', path}),
    },
    window: {
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createOutputChannel: vi.fn().mockReturnValue({
        appendLine: vi.fn(),
        append: vi.fn(),
        dispose: vi.fn(),
      }),
      withProgress: vi.fn().mockImplementation(async (_options, task) => {
        return task({report: vi.fn()});
      }),
    },
    EventEmitter: class {
      fire(data: any) {
        listeners.forEach((l) => l(data));
      }
      event(callback: any) {
        listeners.push(callback);
        return {dispose: vi.fn()};
      }
      dispose() {
        // Cleanup not needed for mock
      }
    },
  };
});

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

// Mock platform utils to control getBinaryName behavior
const platformUtilsMock = {
  getBinaryName: vi.fn().mockReturnValue('agentsmithy-agent'),
  getAssetName: vi.fn(),
  createFileLink: vi.fn(),
};
vi.mock('../../platform', () => ({
  getPlatformUtils: () => platformUtilsMock,
  getPlatformInfo: () => ({platform: 'linux', arch: 'x64'}),

  IPlatformUtils: {},
}));

describe('ServerManager', () => {
  let manager: ServerManager;
  let configInvalidEvents: Array<{errors: string[]}>;
  let outputChannel: {appendLine: ReturnType<typeof vi.fn>};
  let configService: {getServerUrl: any; getWorkspaceRoot: any};

  const createManager = () => {
    // Ensure we clear listeners on new manager creation to avoid side effects
    listeners.length = 0;

    const context = {
      globalStorageUri: vscode.Uri.file('/tmp/agent-smithy'),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    configService = {
      getServerUrl: vi.fn().mockReturnValue('http://localhost:9999'),
      getWorkspaceRoot: vi.fn().mockReturnValue('/tmp/workspace'),
    };
    return new ServerManager(context, configService);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock behaviors
    downloadManagerMock.fetchLatestRelease.mockResolvedValue({
      version: '1.0.0',
      size: 100,
      sha256: 'sha',
    });
    downloadManagerMock.getLatestInstalled.mockReturnValue('1.0.0');
    downloadManagerMock.compareVersions.mockReturnValue(0);
    downloadManagerMock.verifyIntegrity.mockReturnValue(true);
    downloadManagerMock.verifySHA256.mockResolvedValue(true);
    processManagerMock.isAlive.mockReturnValue(false);
    platformUtilsMock.getAssetName.mockReturnValue('agentsmithy-linux-amd64-1.0.0');

    configInvalidEvents = [];
    manager = createManager();
    manager.onConfigInvalid((payload) => configInvalidEvents.push(payload));
    outputChannel = (manager as any).outputChannel;
  });

  describe('checkHealthStatus', () => {
    it('emits config invalid event when health reports errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          config_valid: false,
          config_errors: ['Missing API key'],
        }),
      }) as unknown as typeof fetch;

      await (manager as any).checkHealthStatus();
      expect(configInvalidEvents).toEqual([{errors: ['Missing API key']}]);
    });
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

    it('should satisfy waitForReady while starting (race condition fix)', async () => {
      // Mock ensureServer to simulate delay
      vi.spyOn(manager as any, 'ensureServer').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Mock successful start

      processManagerMock.start.mockImplementation(
        async (_path: string, _root: string, onReady: () => void, _onError: (err: Error) => void) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          onReady();
        },
      );

      const startPromise = manager.startServer();
      const waitPromise = manager.waitForReady();

      await waitPromise;
      await startPromise;
    });

    it('should abort start if ensureServer fails', async () => {
      vi.spyOn(manager as any, 'ensureServer').mockRejectedValue(new Error('Download failed'));

      await expect(manager.startServer()).rejects.toThrow('Download failed');
      expect(processManagerMock.start).not.toHaveBeenCalled();
      expect((manager as any).isStarting).toBe(false);
    });

    it('should silently skip start if no workspace folder is open', async () => {
      configService.getWorkspaceRoot.mockReturnValue(null);
      vi.spyOn(manager as any, 'ensureServer').mockResolvedValue(undefined);

      await manager.startServer();

      expect(outputChannel.appendLine).toHaveBeenCalledWith('No workspace folder open');
      expect(processManagerMock.start).not.toHaveBeenCalled();
      expect((manager as any).isStarting).toBe(false);
    });

    it('should execute ensureServer even if no workspace folder is open', async () => {
      configService.getWorkspaceRoot.mockReturnValue(null);
      const ensureServerSpy = vi.spyOn(manager as any, 'ensureServer').mockResolvedValue(undefined);

      await manager.startServer();

      expect(ensureServerSpy).toHaveBeenCalled();
    });

    it('should handle process start failure', async () => {
      // Mock ensureServer to skip checks
      vi.spyOn(manager as any, 'ensureServer').mockResolvedValue(undefined);

      // Force server path to be valid to avoid path.join errors in this test
      (manager as any).getServerPath = () => '/tmp/server/agent';

      processManagerMock.start.mockImplementation(
        async (_path: string, _root: string, _onReady: () => void, _onError: (err: Error) => void) => {
          throw new Error('Process failed to spawn');
        },
      );

      await expect(manager.startServer()).rejects.toThrow('Process failed to spawn');
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      expect(processManagerMock.stop).toHaveBeenCalled();
      expect((manager as any).isStarting).toBe(false);
    });

    it('trigger health check on successful start', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({config_valid: true}),
      } as any);

      processManagerMock.start.mockImplementation(
        async (_path: string, _root: string, onReady: () => void, _onError: (err: Error) => void) => {
          onReady();
        },
      );

      await manager.startServer();

      // Wait for next tick to allow fire-and-forget checkHealthStatus to run
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('waitForReady', () => {
    it('should return immediately if server is already running', async () => {
      processManagerMock.isAlive.mockReturnValue(true);
      await expect(manager.waitForReady()).resolves.not.toThrow();
    });

    it('should throw if server is not starting and not running', async () => {
      processManagerMock.isAlive.mockReturnValue(false);
      (manager as any).startPromise = null;
      await expect(manager.waitForReady()).rejects.toThrow('Server is not starting or running');
    });
  });

  describe('ensureServer', () => {
    it('skips download when installed version is valid', async () => {
      downloadManagerMock.fetchLatestRelease.mockResolvedValue({version: '1.0.0', size: 100, sha256: 'sha'});
      downloadManagerMock.getLatestInstalled.mockReturnValue('1.0.0');
      downloadManagerMock.compareVersions.mockReturnValue(0);
      downloadManagerMock.verifyIntegrity.mockReturnValue(true);
      downloadManagerMock.verifySHA256.mockResolvedValue(true);
      // Mock serverExists to return true so we don't try to create links
      vi.spyOn(manager as any, 'serverExists').mockReturnValue(true);

      await (manager as any).ensureServer();

      expect(downloadManagerMock.downloadBinary).not.toHaveBeenCalled();
    });

    it('downloads if no version installed', async () => {
      downloadManagerMock.fetchLatestRelease.mockResolvedValue({version: '1.0.0', size: 100, sha256: 'sha'});
      downloadManagerMock.getLatestInstalled.mockReturnValue(null);
      (vscode.window.showInformationMessage as any).mockResolvedValue('Download');
      downloadManagerMock.acquireLock.mockResolvedValue(true);

      await (manager as any).ensureServer();

      expect(downloadManagerMock.downloadBinary).toHaveBeenCalled();
    });

    it('downloads if new version available', async () => {
      downloadManagerMock.fetchLatestRelease.mockResolvedValue({version: '2.0.0', size: 100, sha256: 'sha'});
      downloadManagerMock.getLatestInstalled.mockReturnValue('1.0.0');
      downloadManagerMock.compareVersions.mockReturnValue(1);
      (vscode.window.showInformationMessage as any).mockResolvedValue('Download');
      downloadManagerMock.acquireLock.mockResolvedValue(true);

      await (manager as any).ensureServer();

      expect(downloadManagerMock.downloadBinary).toHaveBeenCalled();
    });

    it('throws if user cancels download', async () => {
      downloadManagerMock.fetchLatestRelease.mockResolvedValue({version: '1.0.0', size: 100, sha256: 'sha'});
      downloadManagerMock.getLatestInstalled.mockReturnValue(null);
      (vscode.window.showInformationMessage as any).mockResolvedValue('Cancel');

      await expect((manager as any).ensureServer()).rejects.toThrow('Server download cancelled by user');
    });

    it('logs error when ensureServer fails internally', async () => {
      // Make fetchLatestRelease throw to trigger catch block in ensureServer
      downloadManagerMock.fetchLatestRelease.mockRejectedValue(new Error('GitHub API error'));

      await expect((manager as any).ensureServer()).rejects.toThrow('GitHub API error');
      expect(outputChannel.appendLine).toHaveBeenCalledWith('ERROR in ensureServer: GitHub API error');
    });
  });

  describe('dispose', () => {
    it('should cleanup resources', () => {
      manager.dispose();
      expect(processManagerMock.stop).toHaveBeenCalled();
      expect(outputChannel.dispose).toHaveBeenCalled();
    });
  });

  describe('hasWorkspace', () => {
    it('should return true when workspace is available', () => {
      configService.getWorkspaceRoot.mockReturnValue('/tmp/workspace');
      expect(manager.hasWorkspace()).toBe(true);
    });

    it('should return false when no workspace is open', () => {
      configService.getWorkspaceRoot.mockReturnValue(null);
      expect(manager.hasWorkspace()).toBe(false);
    });
  });
});
