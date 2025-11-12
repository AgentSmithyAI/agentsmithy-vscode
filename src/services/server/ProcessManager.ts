/* eslint-disable no-undef */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {ChildProcess, spawn} from 'child_process';
import {withResources} from '../../utils/disposable';

interface ServerStatus {
  server_status?: string;
  port?: number;
  server_pid?: number;
}

export class ProcessManager {
  private process: ChildProcess | null = null;
  private readonly outputChannel: vscode.OutputChannel;
  private isShuttingDown = false;
  private serverPid: number | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Get path to status.json file
   */
  private getStatusPath = (workspaceRoot: string): string => {
    return path.join(workspaceRoot, '.agentsmithy', 'status.json');
  };

  /**
   * Check if process with given PID is running
   */
  private isProcessAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Read and parse status.json file
   */
  private readStatus = (statusPath: string): ServerStatus | null => {
    try {
      const content = fs.readFileSync(statusPath, 'utf8');
      return JSON.parse(content) as ServerStatus;
    } catch {
      // Ignore ENOENT and parse errors
      return null;
    }
  };

  /**
   * Get old PID from status file if it exists
   */
  private getOldPid = (statusPath: string): number | null => {
    const status = this.readStatus(statusPath);
    if (!status) {
      return null;
    }

    const oldPid = status.server_pid ?? null;
    if (oldPid !== null) {
      this.outputChannel.appendLine(`Old status file has PID ${oldPid}, waiting for new one...`);
    }
    return oldPid;
  };

  /**
   * Check if status shows server is ready with a new PID
   */
  private checkServerReady = (
    status: ServerStatus | null,
    oldPid: number | null,
  ): {ready: boolean; pid?: number; port?: number} => {
    if (!status) {
      return {ready: false};
    }

    const serverStatus = status.server_status;
    const port = status.port;
    const pid = status.server_pid;

    // Server is ready when server_status === "ready" and has port
    if (serverStatus === 'ready' && typeof port === 'number') {
      // Check if it's a new PID (not the old one)
      if (oldPid !== null && pid === oldPid) {
        return {ready: false}; // Still old status
      }
      return {ready: true, pid, port};
    }

    return {ready: false};
  };

  /**
   * Wait for status.json to show server is ready using file watcher
   * Checks for new PID (different from old one) to avoid stale status
   * Uses automatic resource cleanup pattern
   */
  waitForStatusFile = async (workspaceRoot: string, timeoutMs = 30000): Promise<boolean> => {
    const statusPath = this.getStatusPath(workspaceRoot);
    const oldPid = this.getOldPid(statusPath);

    return withResources(async (rm) => {
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const checkAndResolve = () => {
            const status = this.readStatus(statusPath);
            const result = this.checkServerReady(status, oldPid);

            if (result.ready) {
              // Server is ready!
              this.serverPid = result.pid ?? null;
              const message =
                result.pid !== undefined
                  ? `Server ready with PID ${result.pid} on port ${result.port as number}`
                  : `Server ready on port ${result.port as number}`;
              this.outputChannel.appendLine(message);
              resolve(true);
            }
          };

          // Register timeout with automatic cleanup
          rm.register(
            setTimeout(() => reject(new Error(`Timeout waiting for server (${timeoutMs}ms)`)), timeoutMs),
            (t) => clearTimeout(t),
          );

          // Register file watcher with automatic cleanup
          rm.register(
            fs.watch(path.dirname(statusPath), (_eventType, filename) => {
              if (filename === 'status.json') {
                checkAndResolve();
              }
            }),
            (w) => w.close(),
          );

          // Check immediately in case file already exists
          checkAndResolve();
        });
      } catch (error) {
        // Log and return false on any error (timeout, watch failure, etc)
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(errorMsg);
        return false;
      }
      // All registered resources automatically cleaned up here!
    });
  };

  /**
   * Check if server is already running by checking status.json
   */
  private checkExistingServer = (workspaceRoot: string): boolean => {
    const statusPath = this.getStatusPath(workspaceRoot);
    const status = this.readStatus(statusPath);

    if (!status) {
      return false;
    }

    const existingPid = status.server_pid;

    if (existingPid !== undefined && this.isProcessAlive(existingPid)) {
      this.outputChannel.appendLine(`Found existing server process (PID ${existingPid})`);
      this.serverPid = existingPid;
      return true;
    }

    return false;
  };

  /**
   * Start server process
   */
  start = async (
    serverPath: string,
    workspaceRoot: string,
    onReady: () => void,
    onError: (error: Error) => void,
  ): Promise<void> => {
    this.outputChannel.appendLine(`Starting server from: ${serverPath}`);
    this.outputChannel.appendLine(`Workspace: ${workspaceRoot}`);

    // Check if server is already running
    if (this.checkExistingServer(workspaceRoot)) {
      this.outputChannel.appendLine('Server is already running, not spawning new process');
      onReady();
      return;
    }

    this.outputChannel.appendLine('No existing server found, spawning new process...');

    // Get IDE name from VSCode environment
    const ideName = vscode.env.appName.toLowerCase().replace(/\s+/g, '-');
    this.outputChannel.appendLine(`IDE: ${ideName}`);

    this.process = spawn(serverPath, ['--workdir', workspaceRoot, '--ide', ideName, '--no-log-colors'], {
      cwd: path.dirname(serverPath),
      env: {...process.env},
    });

    this.process.stdout?.on('data', (data: unknown) => {
      this.outputChannel.append(String(data));
    });

    this.process.stderr?.on('data', (data: unknown) => {
      this.outputChannel.append(`[stderr] ${String(data)}`);
    });

    this.process.on('error', (error: Error) => {
      this.outputChannel.appendLine(`Server process error: ${error.message}`);
      void vscode.window.showErrorMessage(`AgentSmithy server failed to start: ${error.message}`);
      this.process = null;
      onError(error);
    });

    this.process.on('exit', (code: number | null, signal: string | null) => {
      if (!this.isShuttingDown) {
        this.outputChannel.appendLine(`Server process exited with code ${String(code)}, signal ${String(signal)}`);
        if (code !== 0 && code !== null) {
          void vscode.window.showWarningMessage(`AgentSmithy server stopped unexpectedly (code ${String(code)})`);
        }
        onError(new Error(`Server process exited with code ${String(code)}`));
      }
      this.process = null;
      this.serverPid = null;
    });

    // Wait for status.json
    this.outputChannel.appendLine('Waiting for server to create status.json...');
    const isReady = await this.waitForStatusFile(workspaceRoot);

    if (isReady) {
      this.outputChannel.appendLine('Server is ready!');
      onReady();
    } else {
      throw new Error('Server failed to create status.json within timeout period');
    }
  };

  /**
   * Stop server process with automatic resource cleanup
   */
  stop = async (): Promise<void> => {
    // Capture process reference to prevent race condition
    const processRef = this.process;
    if (!processRef) {
      return;
    }

    this.isShuttingDown = true;
    this.outputChannel.appendLine('Stopping server...');

    await withResources(async (rm) => {
      try {
        await new Promise<void>((resolve, reject) => {
          // Register timeout with automatic cleanup
          rm.register(
            setTimeout(() => {
              this.outputChannel.appendLine('Force killing server process');
              try {
                processRef.kill('SIGKILL');
              } catch (error) {
                this.outputChannel.appendLine(`Kill failed: ${error instanceof Error ? error.message : String(error)}`);
              }
              resolve();
            }, 5000),
            (t) => clearTimeout(t),
          );

          processRef.on('exit', () => {
            this.outputChannel.appendLine('Server stopped');
            resolve();
          });

          try {
            processRef.kill('SIGTERM');
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            reject(new Error(`Failed to send SIGTERM: ${errorMsg}`));
          }
        });
      } catch (error) {
        // Log but don't throw - stop should be best-effort
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`Stop error: ${errorMsg}`);
      } finally {
        // Process state cleanup (not managed by ResourceManager)
        this.process = null;
        this.serverPid = null;
        this.isShuttingDown = false;
      }
      // Timeout automatically cleaned up by ResourceManager!
    });
  };

  /**
   * Get status
   */
  getStatus = (workspaceRoot: string | null): {running: boolean; port: number | null; pid: number | null} => {
    if (!workspaceRoot) {
      return {running: false, port: null, pid: null};
    }

    const statusPath = this.getStatusPath(workspaceRoot);
    const status = this.readStatus(statusPath);

    if (status) {
      const portValue = status.port;
      const pidValue = status.server_pid;

      const port = typeof portValue === 'number' ? portValue : null;
      const pid = typeof pidValue === 'number' ? pidValue : null;

      const running = pid !== null ? this.isProcessAlive(pid) : this.process !== null;

      return {running, port, pid};
    }

    return {running: this.process !== null, port: null, pid: this.serverPid};
  };

  /**
   * Check if process is alive
   */
  isAlive = (): boolean => {
    return this.serverPid !== null && this.isProcessAlive(this.serverPid);
  };

  /**
   * Get server PID
   */
  getPid = (): number | null => {
    return this.serverPid;
  };
}
