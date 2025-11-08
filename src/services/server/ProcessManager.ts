/* eslint-disable no-undef */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {ChildProcess, spawn} from 'child_process';

export class ProcessManager {
  private process: ChildProcess | null = null;
  private readonly outputChannel: vscode.OutputChannel;
  private isShuttingDown = false;
  private serverPid: number | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

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
   * Parse and validate status.json
   */
  private parseStatusFile = (statusPath: string): {valid: boolean; pid?: number} => {
    if (!fs.existsSync(statusPath)) {
      return {valid: false};
    }

    try {
      const content = fs.readFileSync(statusPath, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const status = JSON.parse(content);

      if (typeof status.port !== 'number') {
        return {valid: false};
      }

      const statusPid = status.server_pid as number | undefined;
      return {valid: true, pid: statusPid};
    } catch {
      return {valid: false};
    }
  };

  /**
   * Check if PID in status is valid (alive and different from old PID)
   */
  private isPidValid = (statusPid: number | undefined, oldPid: number | null): boolean => {
    if (statusPid === undefined) {
      // No PID in status, not ready yet
      return false;
    }

    // If we already captured this PID, it's valid
    if (this.serverPid === statusPid) {
      return true;
    }

    // Check if it's a new alive process (not the old one)
    if (statusPid !== oldPid && this.isProcessAlive(statusPid)) {
      this.outputChannel.appendLine(`Found new server PID ${statusPid}`);
      this.serverPid = statusPid;
      return true;
    }

    if (statusPid === oldPid) {
      this.outputChannel.appendLine(`Status still has old PID ${statusPid}, waiting...`);
    } else if (!this.isProcessAlive(statusPid)) {
      this.outputChannel.appendLine(`PID ${statusPid} is dead, waiting...`);
    }

    return false;
  };

  /**
   * Wait for status.json to appear with valid PID
   */
  waitForStatusFile = async (workspaceRoot: string, maxAttempts = 30): Promise<boolean> => {
    const statusPath = path.join(workspaceRoot, '.agentsmithy', 'status.json');

    // Remember old PID to detect when it changes
    let oldPid: number | null = null;
    try {
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, 'utf8');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const status = JSON.parse(content);

        oldPid = (status.server_pid as number | undefined) ?? null;
      }
    } catch {
      // Ignore
    }

    for (let i = 0; i < maxAttempts; i++) {
      const parsed = this.parseStatusFile(statusPath);

      if (parsed.valid && this.isPidValid(parsed.pid, oldPid)) {
        return true;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
    return false;
  };

  /**
   * Check if server is already running by checking status.json
   */
  private checkExistingServer = (workspaceRoot: string): boolean => {
    const statusPath = path.join(workspaceRoot, '.agentsmithy', 'status.json');

    try {
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, 'utf8');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const status = JSON.parse(content);

        const existingPid = status.server_pid as number | undefined;

        if (existingPid !== undefined && this.isProcessAlive(existingPid)) {
          this.outputChannel.appendLine(`Found existing server process (PID ${existingPid})`);
          this.serverPid = existingPid;
          return true;
        }
      }
    } catch {
      // Ignore errors
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

    this.process = spawn(serverPath, ['--workdir', workspaceRoot, '--ide', 'vscode'], {
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
   * Stop server process
   */
  stop = async (): Promise<void> => {
    if (!this.process) {
      return;
    }

    this.isShuttingDown = true;
    this.outputChannel.appendLine('Stopping server...');

    await new Promise<void>((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        if (this.process) {
          this.outputChannel.appendLine('Force killing server process');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process.on('exit', () => {
        clearTimeout(timeout);
        this.outputChannel.appendLine('Server stopped');
        this.process = null;
        this.serverPid = null;
        this.isShuttingDown = false;
        resolve();
      });

      this.process.kill('SIGTERM');
    });
  };

  /**
   * Get status
   */
  getStatus = (workspaceRoot: string | null): {running: boolean; port: number | null; pid: number | null} => {
    if (!workspaceRoot) {
      return {running: false, port: null, pid: null};
    }

    const statusPath = path.join(workspaceRoot, '.agentsmithy', 'status.json');

    try {
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, 'utf8');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const status = JSON.parse(content);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const portValue = status.port;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const pidValue = status.server_pid;

        const port = typeof portValue === 'number' ? portValue : null;
        const pid = typeof pidValue === 'number' ? pidValue : null;

        const running = pid !== null ? this.isProcessAlive(pid) : this.process !== null;

        return {running, port, pid};
      }
    } catch {
      // Ignore errors
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
