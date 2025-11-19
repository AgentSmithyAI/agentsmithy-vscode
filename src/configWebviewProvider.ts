import * as vscode from 'vscode';
import {ApiService, ConfigResponse, UpdateConfigResponse} from './api/ApiService';
import {getErrorMessage} from './utils/typeGuards';

// Messages from webview to extension
const CONFIG_IN_MSG = {
  READY: 'ready',
  LOAD_CONFIG: 'loadConfig',
  SAVE_CONFIG: 'saveConfig',
} as const;

// Messages from extension to webview
const CONFIG_OUT_MSG = {
  CONFIG_LOADED: 'configLoaded',
  CONFIG_SAVED: 'configSaved',
  ERROR: 'error',
  LOADING: 'loading',
} as const;

type ConfigInMessage =
  | {type: typeof CONFIG_IN_MSG.READY}
  | {type: typeof CONFIG_IN_MSG.LOAD_CONFIG}
  | {type: typeof CONFIG_IN_MSG.SAVE_CONFIG; config: Record<string, unknown>};

type ConfigOutMessage =
  | {type: typeof CONFIG_OUT_MSG.CONFIG_LOADED; data: ConfigResponse}
  | {type: typeof CONFIG_OUT_MSG.CONFIG_SAVED; data: UpdateConfigResponse}
  | {type: typeof CONFIG_OUT_MSG.ERROR; message: string}
  | {type: typeof CONFIG_OUT_MSG.LOADING};

export class ConfigWebviewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly apiService: ApiService,
  ) {}

  /**
   * Show configuration panel
   */
  public async show(): Promise<void> {
    // If panel already exists, reveal it
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create new panel
    this.panel = vscode.window.createWebviewPanel(
      'agentsmithyConfig',
      'AgentSmithy Configuration',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
      },
    );

    // Set icon
    this.panel.iconPath = {
      light: vscode.Uri.parse('$(settings-gear)'),
      dark: vscode.Uri.parse('$(settings-gear)'),
    };

    // Set HTML content
    this.panel.webview.html = this.getHtmlContent(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message: ConfigInMessage) => {
        await this.handleMessage(message);
      },
      undefined,
      this.disposables,
    );

    // Handle panel disposal
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables,
    );
  }

  /**
   * Handle messages from webview
   */
  private async handleMessage(message: ConfigInMessage): Promise<void> {
    switch (message.type) {
      case CONFIG_IN_MSG.READY:
        // Load config when webview is ready
        await this.loadConfig();
        break;

      case CONFIG_IN_MSG.LOAD_CONFIG:
        await this.loadConfig();
        break;

      case CONFIG_IN_MSG.SAVE_CONFIG:
        await this.saveConfig(message.config);
        break;
    }
  }

  /**
   * Load configuration from server
   */
  private async loadConfig(): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      this.postMessage({type: CONFIG_OUT_MSG.LOADING});
      const config = await this.apiService.getConfig();

      // Ensure metadata is serializable (VSCode webview may not serialize undefined)
      const serializableConfig = {
        config: config.config,
        metadata: config.metadata || null,
      };

      this.postMessage({
        type: CONFIG_OUT_MSG.CONFIG_LOADED,
        data: serializableConfig,
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error, 'Unknown error');
      this.postMessage({
        type: CONFIG_OUT_MSG.ERROR,
        message: `Failed to load configuration: ${errorMsg}`,
      });
    }
  }

  /**
   * Save configuration to server
   */
  private async saveConfig(config: Record<string, unknown>): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      this.postMessage({type: CONFIG_OUT_MSG.LOADING});
      const result = await this.apiService.updateConfig(config);
      this.postMessage({
        type: CONFIG_OUT_MSG.CONFIG_SAVED,
        data: result,
      });
      void vscode.window.showInformationMessage('Configuration saved successfully!');
    } catch (error) {
      const errorMsg = getErrorMessage(error, 'Unknown error');
      this.postMessage({
        type: CONFIG_OUT_MSG.ERROR,
        message: `Failed to save configuration: ${errorMsg}`,
      });
      void vscode.window.showErrorMessage(`Failed to save configuration: ${errorMsg}`);
    }
  }

  /**
   * Post message to webview
   */
  private postMessage(message: ConfigOutMessage): void {
    if (this.panel) {
      void this.panel.webview.postMessage(message);
    }
  }

  /**
   * Get HTML content for webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'config-webview.js'));
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>AgentSmithy Configuration</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--vscode-settings-headerForeground);
    }

    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 20px;
      font-size: 13px;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }

    .error {
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      padding: 8px 12px;
      margin-bottom: 16px;
      font-size: 13px;
    }

    .success {
      background-color: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      color: var(--vscode-foreground);
      padding: 8px 12px;
      margin-bottom: 16px;
      font-size: 13px;
    }

    .section {
      margin-bottom: 24px;
      border-bottom: 1px solid var(--vscode-settings-headerBorder, var(--vscode-panel-border));
    }

    .section-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--vscode-settings-headerForeground);
    }

    .setting-item {
      display: flex;
      align-items: flex-start;
      padding: 9px 10px;
      margin: 0 -10px;
      margin-bottom: 8px;
    }

    .setting-item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .setting-item-label {
      flex: 0 0 40%;
      padding-right: 20px;
    }

    .setting-item-label-text {
      font-size: 13px;
      color: var(--vscode-settings-textInputForeground);
      display: block;
      margin-bottom: 4px;
    }

    .setting-item-description {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      display: block;
    }

    .setting-item-control {
      flex: 1;
      min-width: 0;
    }

    .setting-input,
    .setting-textarea,
    .setting-select {
      width: 100%;
      padding: 4px 8px;
      background-color: var(--vscode-settings-textInputBackground);
      color: var(--vscode-settings-textInputForeground);
      border: 1px solid var(--vscode-settings-textInputBorder, transparent);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      line-height: 20px;
    }

    .setting-input:focus,
    .setting-textarea:focus,
    .setting-select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .setting-textarea {
      resize: vertical;
      min-height: 60px;
      font-family: var(--vscode-editor-font-family);
    }

    .setting-checkbox-container {
      display: flex;
      align-items: center;
      height: 26px;
    }

    .setting-checkbox {
      margin: 0;
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    .button-toolbar {
      display: flex;
      gap: 8px;
      margin: 20px 0;
      padding-top: 12px;
      border-top: 1px solid var(--vscode-settings-headerBorder, var(--vscode-panel-border));
    }

    .btn {
      padding: 6px 14px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
      font-size: 13px;
      font-family: var(--vscode-font-family);
      transition: background-color 0.1s;
    }

    .btn:hover:not(:disabled) {
      background-color: var(--vscode-button-hoverBackground);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover:not(:disabled) {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    /* Collapsible Providers */
    .provider-item {
      border: 1px solid var(--vscode-settings-headerBorder, var(--vscode-panel-border));
      margin-bottom: 8px;
      background-color: var(--vscode-editor-background);
    }

    .provider-header {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      background-color: var(--vscode-sideBar-background);
    }

    .provider-header:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .provider-chevron {
      margin-right: 8px;
      font-size: 16px;
      transition: transform 0.2s;
      color: var(--vscode-foreground);
    }

    .provider-chevron.expanded {
      transform: rotate(90deg);
    }

    .provider-name {
      flex: 1;
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .provider-type-badge {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      background-color: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 2px;
      margin-right: 8px;
    }

    .provider-delete {
      color: var(--vscode-errorForeground);
      border: none;
      background: none;
      cursor: pointer;
      padding: 2px 6px;
      font-size: 16px;
      opacity: 0.7;
    }

    .provider-delete:hover {
      opacity: 1;
    }

    .provider-warning {
      border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
    }

    .provider-warning-badge {
      font-size: 14px;
      color: var(--vscode-editorWarning-foreground);
      margin-right: 8px;
    }

    .provider-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .provider-content.expanded {
      max-height: 2000px;
      padding: 12px;
    }

    .add-provider-btn {
      width: 100%;
      padding: 8px;
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px dashed var(--vscode-settings-headerBorder, var(--vscode-panel-border));
      cursor: pointer;
      font-size: 13px;
      margin-bottom: 12px;
    }

    .add-provider-btn:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>AgentSmithy Configuration</h1>
    <p class="subtitle">Configure your AgentSmithy server settings</p>

    <div id="errorContainer"></div>
    <div id="successContainer"></div>

    <div id="loadingContainer" class="loading">
      <p>Loading configuration...</p>
    </div>

    <div id="configContainer" class="hidden">
      <!-- Configuration form will be rendered here -->
    </div>

    <div class="button-toolbar">
      <button id="saveButton" class="btn" disabled>Save Configuration</button>
      <button id="reloadButton" class="btn btn-secondary">Reload</button>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  /**
   * Generate nonce for CSP
   */
  getNonce = (): string => {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  };

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
