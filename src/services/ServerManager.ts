import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {getBinaryName, getPlatformInfo} from '../utils/platform';
import {DownloadManager} from './server/DownloadManager';
import {ProcessManager} from './server/ProcessManager';

export class ServerManager {
  private readonly context: vscode.ExtensionContext;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly serverDir: string;
  private readonly configService: {getServerUrl: () => string; getWorkspaceRoot: () => string | null};
  private readonly downloadManager: DownloadManager;
  private readonly processManager: ProcessManager;
  private isStarting = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  constructor(
    context: vscode.ExtensionContext,
    configService: {getServerUrl: () => string; getWorkspaceRoot: () => string | null},
  ) {
    this.context = context;
    this.configService = configService;
    this.outputChannel = vscode.window.createOutputChannel('AgentSmithy Server');
    this.serverDir = path.join(context.globalStorageUri.fsPath, 'server');

    // Ensure server directory exists
    if (!fs.existsSync(this.serverDir)) {
      fs.mkdirSync(this.serverDir, {recursive: true});
    }

    this.downloadManager = new DownloadManager(this.serverDir, this.outputChannel);
    this.processManager = new ProcessManager(this.outputChannel);

    // Create ready promise
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  /**
   * Get path to server binary (symlink)
   */
  private getServerPath = (): string => {
    return path.join(this.serverDir, getBinaryName());
  };

  /**
   * Check if server binary exists and is valid
   */
  private serverExists = (): boolean => {
    const serverPath = this.getServerPath();
    if (!fs.existsSync(serverPath)) {
      return false;
    }

    try {
      const stats = fs.statSync(serverPath);
      if (stats.size === 0) {
        this.outputChannel.appendLine('Server binary is empty (0 bytes)');
        return false;
      }

      const {platform} = getPlatformInfo();
      if (platform !== 'win32') {
        const isExecutable = (stats.mode & 0o100) !== 0;
        if (!isExecutable) {
          this.outputChannel.appendLine('Server binary is not executable');
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Verify installed binary integrity
   */
  private verifyInstalledBinary = async (
    version: string,
    expectedSize: number,
    expectedSHA: string,
  ): Promise<boolean> => {
    // Check size first (fast check)
    const isValidSize = this.downloadManager.verifyIntegrity(version, expectedSize);
    if (!isValidSize) {
      this.outputChannel.appendLine(`Binary size check failed`);
      return false;
    }

    // Check SHA256 if available (thorough check)
    if (expectedSHA) {
      this.outputChannel.appendLine('Verifying SHA256...');
      const isValidSHA = await this.downloadManager.verifySHA256(version, expectedSHA);
      if (!isValidSHA) {
        this.outputChannel.appendLine(`SHA256 check failed`);
        return false;
      }
    }

    return true;
  };

  /**
   * Handle installed version checks
   */
  private handleInstalledVersion = async (
    installedVersion: string,
    latestVersionTag: string,
    latestVersion: string,
    expectedSize: number,
    expectedSHA: string,
  ): Promise<boolean> => {
    this.outputChannel.appendLine(`Installed version: ${installedVersion}`);

    const comparison = this.downloadManager.compareVersions(latestVersion, installedVersion);

    if (comparison === 0) {
      // Same version - verify integrity
      const isValid = await this.verifyInstalledBinary(installedVersion, expectedSize, expectedSHA);

      if (!isValid) {
        this.outputChannel.appendLine(`Re-downloading corrupted binary...`);
        await this.downloadWithLock(latestVersionTag, latestVersion, 'Re-downloading');
        return true;
      }

      this.outputChannel.appendLine('Server is up to date and valid');
      return true;
    }

    if (comparison > 0) {
      this.outputChannel.appendLine(`New version available: ${latestVersion}`);
      return false;
    }

    this.outputChannel.appendLine(
      `Warning: Installed version ${installedVersion} is newer than latest ${latestVersion}`,
    );
    return true;
  };

  /**
   * Ensure server binary is available, download/update if necessary
   */
  private ensureServer = async (): Promise<void> => {
    try {
      this.outputChannel.appendLine('Fetching latest release info from GitHub...');
      const latestRelease = await this.downloadManager.fetchLatestRelease();
      const {version: latestVersionTag, size: expectedSize, sha256: expectedSHA} = latestRelease;
      const latestVersion = latestVersionTag.replace(/^v/, '');

      this.outputChannel.appendLine(`Latest available version: ${latestVersion} (size: ${expectedSize} bytes)`);
      if (expectedSHA) {
        this.outputChannel.appendLine(`Expected SHA256: ${expectedSHA}`);
      }

      const installedVersion = this.downloadManager.getLatestInstalled();

      if (installedVersion) {
        const handled = await this.handleInstalledVersion(
          installedVersion,
          latestVersionTag,
          latestVersion,
          expectedSize,
          expectedSHA,
        );
        if (handled) {
          return;
        }
      }

      // Download new version
      await this.downloadWithLock(latestVersionTag, latestVersion, 'Downloading');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`ERROR in ensureServer: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        this.outputChannel.appendLine(`Stack: ${error.stack}`);
      }
      throw error;
    }
  };

  /**
   * Download server with lock protection
   * @param versionTag - version tag with 'v' prefix for GitHub URL (e.g., 'v1.9.0')
   * @param versionClean - version without 'v' for filenames (e.g., '1.9.0')
   */
  private downloadWithLock = async (versionTag: string, versionClean: string, actionName: string): Promise<void> => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'AgentSmithy',
        cancellable: false,
      },
      async (progress) => {
        progress.report({message: 'Acquiring download lock...'});
        const lockAcquired = await this.downloadManager.acquireLock();

        if (!lockAcquired) {
          throw new Error('Failed to acquire download lock - another VSCode instance may be downloading');
        }

        try {
          progress.report({message: `${actionName} server ${versionClean}...`});

          const linkPath = this.getServerPath();
          await this.downloadManager.downloadBinary(versionTag, versionClean, linkPath);

          progress.report({message: 'Cleaning up old versions...'});
          await this.downloadManager.cleanupOldVersions(versionClean);

          progress.report({message: 'Server ready!'});
        } finally {
          this.downloadManager.releaseLock();
        }
      },
    );
  };

  /**
   * Start server
   */
  startServer = async (): Promise<void> => {
    this.outputChannel.appendLine('=== Starting server ===');

    if (this.isStarting) {
      this.outputChannel.appendLine('Server is already starting...');
      return;
    }

    if (this.processManager.isAlive()) {
      this.outputChannel.appendLine('Server is already running');
      return;
    }

    const workspaceRoot = this.configService.getWorkspaceRoot();
    if (!workspaceRoot) {
      this.outputChannel.appendLine('No workspace folder open');
      void vscode.window.showErrorMessage('AgentSmithy: Please open a workspace folder first');
      return;
    }

    this.outputChannel.appendLine(`Workspace: ${workspaceRoot}`);
    this.isStarting = true;

    try {
      this.outputChannel.appendLine('Checking server binary...');
      await this.ensureServer();
      this.outputChannel.appendLine('Server binary check complete');

      const serverPath = this.getServerPath();

      await this.processManager.start(
        serverPath,
        workspaceRoot,
        () => {
          // On ready callback
          const serverUrl = this.configService.getServerUrl();
          this.outputChannel.appendLine(`Server is ready! URL: ${serverUrl}`);
          void vscode.window.showInformationMessage('AgentSmithy server started successfully');

          if (this.readyResolve) {
            this.readyResolve();
            this.readyResolve = null;
          }
        },
        (error: Error) => {
          // On error callback
          if (this.readyReject) {
            this.readyReject(error);
            this.readyReject = null;
            this.readyResolve = null;
          }

          // Reset ready promise for potential restart
          this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
          });
        },
      );
    } catch (error) {
      this.outputChannel.appendLine('Server failed to start. Check the output for details.');
      void vscode.window.showErrorMessage('AgentSmithy server failed to start. Check the output for details.');
      await this.processManager.stop();
      throw error;
    } finally {
      this.isStarting = false;
    }
  };

  /**
   * Stop server
   */
  stopServer = async (): Promise<void> => {
    await this.processManager.stop();
  };

  /**
   * Restart server
   */
  restartServer = async (): Promise<void> => {
    await this.stopServer();
    await this.startServer();
  };

  /**
   * Wait for server to be ready
   */
  waitForReady = async (): Promise<void> => {
    if (!this.readyPromise) {
      if (this.processManager.isAlive()) {
        return;
      }
      throw new Error('Server is not running');
    }

    await this.readyPromise;
  };

  /**
   * Check if server is ready
   */
  isReady = (): boolean => {
    return this.readyResolve === null && this.processManager.isAlive();
  };

  /**
   * Get server status
   */
  getStatus = async (): Promise<{running: boolean; port: number | null; pid: number | null}> => {
    return this.processManager.getStatus(this.configService.getWorkspaceRoot());
  };

  /**
   * Dispose resources
   */
  dispose = (): void => {
    void this.stopServer();
    this.outputChannel.dispose();
  };
}
