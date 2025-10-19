import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CONFIG_KEYS, DEFAULT_SERVER_URL, STATUS_FILE_PATH } from '../constants';
import { safeJsonParse } from '../utils/typeGuards';

/**
 * Service for managing extension configuration
 */
export class ConfigService {
  private readonly _onDidChangeServerUrl = new vscode.EventEmitter<string>();
  readonly onDidChangeServerUrl = this._onDidChangeServerUrl.event;

  constructor() {
    // Watch for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_KEYS.SERVER_URL)) {
        this._onDidChangeServerUrl.fire(this.getServerUrl());
      }
    });

    // Watch for status.json changes
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${STATUS_FILE_PATH}`);
    watcher.onDidChange(() => this._onDidChangeServerUrl.fire(this.getServerUrl()));
    watcher.onDidCreate(() => this._onDidChangeServerUrl.fire(this.getServerUrl()));
  }

  /**
   * Get server URL from status.json or config
   */
  getServerUrl(): string {
    const statusUrl = this.getServerUrlFromStatusFile();
    if (statusUrl) {
      return statusUrl;
    }

    return this.getServerUrlFromConfig();
  }

  /**
   * Get workspace root path
   */
  getWorkspaceRoot = (): string | null => {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? null;
  };

  private getServerUrlFromStatusFile = (): string | null => {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return null;
    }

    const statusPath = path.join(workspaceRoot, STATUS_FILE_PATH);

    try {
      if (fs.existsSync(statusPath)) {
        const statusContent = fs.readFileSync(statusPath, 'utf8');
        const parsed = safeJsonParse<{port?: unknown}>(statusContent);
        if (parsed && typeof parsed.port !== 'undefined') {
          const port = parsed.port;
          if (typeof port === 'number' || (typeof port === 'string' && String(port).trim().length > 0)) {
            return `http://localhost:${String(port)}`;
          }
        }
      }
    } catch {
      // Fallback to config
    }

    return null;
  };

  private getServerUrlFromConfig = (): string => {
    const config = vscode.workspace.getConfiguration('agentsmithy');
    return config.get<string>(CONFIG_KEYS.SERVER_URL, DEFAULT_SERVER_URL);
  };
}

