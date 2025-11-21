import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {CONFIG_KEYS, DEFAULT_SERVER_URL, STATUS_FILE_PATH} from '../constants';
import {safeJsonParse} from '../utils/typeGuards';

/**
 * Service for managing extension configuration
 */
export class ConfigService {
  /**
   * Get server URL from status.json or default fallback
   */
  getServerUrl(): string {
    const statusUrl = this.getServerUrlFromStatusFile();
    if (statusUrl) {
      return statusUrl;
    }

    return DEFAULT_SERVER_URL;
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
      const statusContent = fs.readFileSync(statusPath, 'utf8');
      const parsed = safeJsonParse<{port?: unknown}>(statusContent);
      if (typeof parsed?.port !== 'undefined') {
        const port = parsed.port;
        if (typeof port === 'number' || (typeof port === 'string' && String(port).trim().length > 0)) {
          return `http://localhost:${String(port)}`;
        }
      }
    } catch {
      // Ignore ENOENT and parse errors, fallback to default URL
    }

    return null;
  };

  /**
   * Get auto-start server configuration
   */
  getAutoStartServer = (): boolean => {
    const config = vscode.workspace.getConfiguration('agentsmithy');
    return config.get<boolean>(CONFIG_KEYS.AUTO_START_SERVER, true);
  };
}
