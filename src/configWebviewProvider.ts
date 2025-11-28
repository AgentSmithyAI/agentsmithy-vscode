import * as vscode from 'vscode';
import {ApiService, ConfigResponse, UpdateConfigResponse} from './api/ApiService';
import {getErrorMessage} from './utils/typeGuards';

// Messages from webview to extension
const CONFIG_IN_MSG = {
  READY: 'ready',
  LOAD_CONFIG: 'loadConfig',
  SAVE_CONFIG: 'saveConfig',
  SHOW_INPUT_BOX: 'showInputBox',
  SHOW_QUICK_PICK: 'showQuickPick',
  SHOW_CONFIRM: 'showConfirm',
} as const;

// Messages from extension to webview
const CONFIG_OUT_MSG = {
  CONFIG_LOADED: 'configLoaded',
  CONFIG_SAVED: 'configSaved',
  ERROR: 'error',
  LOADING: 'loading',
  VALIDATION_ERRORS: 'validationErrors',
  INPUT_RESULT: 'inputResult',
  QUICK_PICK_RESULT: 'quickPickResult',
  CONFIRM_RESULT: 'confirmResult',
} as const;

type ConfigInMessage =
  | {type: typeof CONFIG_IN_MSG.READY}
  | {type: typeof CONFIG_IN_MSG.LOAD_CONFIG}
  | {type: typeof CONFIG_IN_MSG.SAVE_CONFIG; config: Record<string, unknown>}
  | {type: typeof CONFIG_IN_MSG.SHOW_INPUT_BOX; requestId: string; prompt: string; placeholder?: string; value?: string}
  | {type: typeof CONFIG_IN_MSG.SHOW_QUICK_PICK; requestId: string; items: string[]; placeholder?: string}
  | {type: typeof CONFIG_IN_MSG.SHOW_CONFIRM; requestId: string; message: string};

type ConfigOutMessage =
  | {type: typeof CONFIG_OUT_MSG.CONFIG_LOADED; data: ConfigResponse}
  | {type: typeof CONFIG_OUT_MSG.CONFIG_SAVED; data: UpdateConfigResponse}
  | {type: typeof CONFIG_OUT_MSG.ERROR; message: string}
  | {type: typeof CONFIG_OUT_MSG.LOADING}
  | {type: typeof CONFIG_OUT_MSG.VALIDATION_ERRORS; errors: string[]};

export class ConfigWebviewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private pendingValidationErrors: string[] = [];
  private webviewReady = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly apiService: ApiService,
  ) {}

  /**
   * Show configuration panel
   */
  public async show(validationErrors?: string[]): Promise<void> {
    this.pendingValidationErrors = Array.isArray(validationErrors) ? validationErrors : [];

    // If panel already exists, reveal it
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      void this.refreshValidationErrors();
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

    // Set icon (reuse extension icon for consistency)
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'icon.png');

    // Set HTML content
    this.panel.webview.html = this.getHtmlContent(this.panel.webview);
    void this.refreshValidationErrors();

    // Handle messages from webview
    const messageDisposable = this.panel.webview.onDidReceiveMessage(async (message: ConfigInMessage) => {
      await this.handleMessage(message);
    });
    this.disposables.push(messageDisposable);

    // Handle panel disposal
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.webviewReady = false;
        this.pendingValidationErrors = [];
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
        this.webviewReady = true;
        // Load config when webview is ready
        await this.loadConfig();
        break;

      case CONFIG_IN_MSG.LOAD_CONFIG:
        await this.loadConfig();
        break;

      case CONFIG_IN_MSG.SAVE_CONFIG:
        await this.saveConfig(message.config);
        break;

      case CONFIG_IN_MSG.SHOW_INPUT_BOX:
        await this.handleShowInputBox(message.requestId, message.prompt, message.placeholder, message.value);
        break;

      case CONFIG_IN_MSG.SHOW_QUICK_PICK:
        await this.handleShowQuickPick(message.requestId, message.items, message.placeholder);
        break;

      case CONFIG_IN_MSG.SHOW_CONFIRM:
        await this.handleShowConfirm(message.requestId, message.message);
        break;
    }
  }

  /**
   * Show VS Code input box and send result back to webview
   */
  private async handleShowInputBox(
    requestId: string,
    prompt: string,
    placeholder?: string,
    value?: string,
  ): Promise<void> {
    const result = await vscode.window.showInputBox({
      prompt,
      placeHolder: placeholder,
      value,
    });

    this.postMessage({
      type: CONFIG_OUT_MSG.INPUT_RESULT,
      requestId,
      value: result ?? null,
    });
  }

  /**
   * Show VS Code quick pick and send result back to webview
   */
  private async handleShowQuickPick(requestId: string, items: string[], placeholder?: string): Promise<void> {
    const result = await vscode.window.showQuickPick(items, {
      placeHolder: placeholder,
    });

    this.postMessage({
      type: CONFIG_OUT_MSG.QUICK_PICK_RESULT,
      requestId,
      value: result ?? null,
    });
  }

  /**
   * Show VS Code confirmation dialog and send result back to webview
   */
  private async handleShowConfirm(requestId: string, message: string): Promise<void> {
    const result = await vscode.window.showWarningMessage(message, {modal: true}, 'Yes', 'No');

    this.postMessage({
      type: CONFIG_OUT_MSG.CONFIRM_RESULT,
      requestId,
      confirmed: result === 'Yes',
    });
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

      await this.refreshValidationErrors();
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

      // Clear pending validation errors on successful save since we expect the user fixed them
      this.pendingValidationErrors = [];
      this.postValidationErrors();

      this.postMessage({
        type: CONFIG_OUT_MSG.CONFIG_SAVED,
        data: result,
      });
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
  private postMessage(message: ConfigOutMessage | Record<string, unknown>): void {
    if (this.panel) {
      void this.panel.webview.postMessage(message);
    }
  }

  /**
   * Send validation errors (if any) to the webview to highlight fields
   */
  private postValidationErrors(): void {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    void this.panel.webview.postMessage({
      type: CONFIG_OUT_MSG.VALIDATION_ERRORS,
      errors: this.pendingValidationErrors,
    });
  }

  /**
   * Refresh validation errors by querying server health
   */
  private async refreshValidationErrors(): Promise<void> {
    try {
      const health = await this.apiService.getHealth();
      if (!health.config_valid) {
        this.pendingValidationErrors = Array.isArray(health.config_errors) ? health.config_errors : [];
      } else {
        this.pendingValidationErrors = [];
      }
    } catch {
      // Keep existing validation errors if health check fails
    }

    this.postValidationErrors();
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
      padding: 0;
      margin: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .scroll-container {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
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

    .footer-toolbar {
      padding: 16px 20px;
      background-color: var(--vscode-editor-background);
      border-top: 1px solid var(--vscode-settings-headerBorder, var(--vscode-panel-border));
      position: sticky;
      bottom: 0;
      z-index: 100;
      display: flex;
      gap: 8px;
      /* Ensure footer stays on top if content scrolls behind */
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
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

    .validation-summary {
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background-color: var(--vscode-inputValidation-errorBackground);
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 13px;
      color: var(--vscode-foreground);
    }

    .validation-summary.hidden {
      display: none;
    }

    .validation-summary-title {
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--vscode-errorForeground);
    }

    .validation-summary ul {
      margin: 0;
      padding-left: 18px;
    }

    .setting-item.error-highlight {
      border-left: 2px solid var(--vscode-inputValidation-errorBorder);
      background-color: var(--vscode-inputValidation-errorBackground);
    }

    .config-field-error {
      border-color: var(--vscode-inputValidation-errorBorder) !important;
      box-shadow: 0 0 0 1px var(--vscode-inputValidation-errorBorder) inset;
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
  <div class="scroll-container">
    <div class="container">
      <h1>AgentSmithy Configuration</h1>
      <p class="subtitle">Configure your AgentSmithy server settings</p>

      <div id="errorContainer"></div>
      <div id="successContainer"></div>
      <div id="validationSummary" class="validation-summary hidden"></div>

      <div id="loadingContainer" class="loading">
        <p>Loading configuration...</p>
      </div>

      <div id="configContainer" class="hidden">
        <!-- Configuration form will be rendered here -->
      </div>
    </div>
  </div>

  <div class="footer-toolbar">
    <div class="container" style="width: 100%; display: flex; gap: 8px; padding: 0;">
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
