import * as vscode from 'vscode';
import * as path from 'path';
import type {HistoryEvent, ChangedFile} from './api/ApiService';
import {ApiService} from './api/ApiService';
import {StreamService, type ChatContext} from './api/StreamService';
import {CSS_CLASSES, DOM_IDS, SSE_EVENT_TYPES as E, ERROR_MESSAGES, ERROR_NAMES, VIEWS} from './constants';
import {ConfigService} from './services/ConfigService';
import {DialogService} from './services/DialogService';
import {StreamEventHandlers} from './services/EventHandlers';
import {HistoryService} from './services/HistoryService';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from './shared/messages';
import {getErrorMessage} from './utils/typeGuards';

// Constants
const DIFF_SCHEME = 'agentsmithy-diff' as const;
const DIFF_SIDE_LEFT = 'left' as const;
const DIFF_SIDE_RIGHT = 'right' as const;

// Messages sent from the webview to the extension
type WebviewInMessage =
  | {type: typeof WEBVIEW_IN_MSG.SEND_MESSAGE; text?: string}
  | {type: typeof WEBVIEW_IN_MSG.OPEN_FILE; file?: string}
  | {type: typeof WEBVIEW_IN_MSG.OPEN_FILE_DIFF; file?: string}
  | {type: typeof WEBVIEW_IN_MSG.STOP_PROCESSING}
  | {type: typeof WEBVIEW_IN_MSG.READY}
  | {type: typeof WEBVIEW_IN_MSG.LOAD_MORE_HISTORY}
  | {type: typeof WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX; idx?: number}
  | {type: typeof WEBVIEW_IN_MSG.CREATE_DIALOG}
  | {type: typeof WEBVIEW_IN_MSG.SWITCH_DIALOG; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.RENAME_DIALOG; dialogId: string; title: string}
  | {type: typeof WEBVIEW_IN_MSG.DELETE_DIALOG; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.DELETE_DIALOG_CONFIRM; dialogId: string; title: string}
  | {type: typeof WEBVIEW_IN_MSG.LOAD_DIALOGS}
  | {type: typeof WEBVIEW_IN_MSG.RESTORE_CHECKPOINT; dialogId: string; checkpointId: string}
  | {type: typeof WEBVIEW_IN_MSG.APPROVE_SESSION; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.RESET_TO_APPROVED; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.OPEN_SETTINGS}
  | {type: typeof WEBVIEW_IN_MSG.TOGGLE_DIFF_VIEW};
// Messages sent from the extension to the webview
type WebviewOutMessage =
  | {
      type: typeof WEBVIEW_OUT_MSG.ADD_MESSAGE;
      message: {role: 'user' | 'assistant'; content: string};
      checkpoint?: string;
      dialogId?: string;
    }
  | {type: typeof WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT; content: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_ASSISTANT_MESSAGE; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.START_REASONING; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_REASONING; content: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_REASONING; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_TOOL_CALL; tool?: string; args?: unknown; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_FILE_EDIT; file: string; diff?: string; checkpoint?: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_ERROR; error: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_INFO; message: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_STREAM; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_SET_CAN_LOAD; canLoad: boolean; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS; events: HistoryEvent[]; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL; events: HistoryEvent[]; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX}
  | {
      type: typeof WEBVIEW_OUT_MSG.DIALOGS_UPDATE;
      dialogs: Array<{id: string; title: string | null; updated_at: string}>;
      currentDialogId: string | null;
    }
  | {type: typeof WEBVIEW_OUT_MSG.DIALOGS_LOADING}
  | {type: typeof WEBVIEW_OUT_MSG.DIALOGS_ERROR; error: string}
  | {type: typeof WEBVIEW_OUT_MSG.DIALOG_SWITCHED; dialogId: string | null; title: string}
  | {type: typeof WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE; hasUnapproved: boolean; changedFiles?: ChangedFile[]}
  | {type: typeof WEBVIEW_OUT_MSG.SESSION_OPERATION_CANCELLED}
  | {type: typeof WEBVIEW_OUT_MSG.FOCUS_INPUT};
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEWS.CHAT;

  private _view?: vscode.WebviewView;
  private readonly _outputChannel: vscode.OutputChannel;
  private _isInitializing = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _stream: StreamService,
    private readonly _historyService: HistoryService,
    private readonly _dialogService: DialogService,
    private readonly _configService: ConfigService,
    private readonly _apiService: ApiService,
  ) {
    this._outputChannel = vscode.window.createOutputChannel('AgentSmithy Webview');

    // Listen to history state changes
    this._historyService.onDidChangeState(() => {
      // Enable only when not loading AND there is more to load
      const canLoad = !this._historyService.isLoading && this._historyService.hasMore;
      this._postMessage({
        type: WEBVIEW_OUT_MSG.HISTORY_SET_CAN_LOAD,
        canLoad,
      });
    });
  }

  private _postMessage(msg: WebviewOutMessage): void {
    this._view?.webview.postMessage(msg);
  }

  private _loadLatestHistoryPage = async (dialogId: string, replace = false): Promise<void> => {
    if (!this._view) {
      return;
    }

    this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_SET_CAN_LOAD, canLoad: false, dialogId});

    try {
      const result = await this._historyService.loadLatest(dialogId);
      if (result) {
        if (result.events.length > 0) {
          if (replace) {
            this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL, events: result.events, dialogId});
          } else {
            this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS, events: result.events, dialogId});
          }
        } else if (replace) {
          this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL, events: [], dialogId});
        }
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg, dialogId});
    } finally {
      // Enable only when there is more to load
      this._postMessage({
        type: WEBVIEW_OUT_MSG.HISTORY_SET_CAN_LOAD,
        canLoad: this._historyService.hasMore,
        dialogId,
      });
    }
  };

  private _loadPreviousHistoryPage = async (dialogId: string): Promise<void> => {
    if (!this._view) {
      return;
    }

    this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_SET_CAN_LOAD, canLoad: false, dialogId});

    try {
      const result = await this._historyService.loadPrevious(dialogId);
      if (result) {
        if (result.events.length > 0) {
          this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS, events: result.events, dialogId});
        }
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg, dialogId});
    } finally {
      // Enable only if there is more to load according to HistoryService
      this._postMessage({
        type: WEBVIEW_OUT_MSG.HISTORY_SET_CAN_LOAD,
        canLoad: this._historyService.hasMore,
        dialogId,
      });
    }
  };

  public sendMessage(content: string): void {
    if (this._view) {
      // Don't show user message immediately - wait for SSE event with checkpoint
      void this._handleSendMessage(content);
    }
  }

  /**
   * Refresh webview data after server starts
   */
  public async refreshAfterServerStart(): Promise<void> {
    if (!this._view) {
      this._outputChannel.appendLine('[refreshAfterServerStart] No view, skipping');
      return;
    }

    this._outputChannel.appendLine('[refreshAfterServerStart] Starting refresh...');

    // Reset cached dialog ID to force reload from API
    this._historyService.currentDialogId = undefined;

    // Wait a bit for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Trigger data reload
    this._outputChannel.appendLine('[refreshAfterServerStart] Reloading data...');
    await this._handleWebviewReady();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri, vscode.Uri.joinPath(this._extensionUri, 'node_modules')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Focus management policy:
    // Do not force focus from the extension on visibility changes.
    // The webview script owns focus persistence and will restore the input
    // itself if it was focused before. No visibility listener is needed here.

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewInMessage) => {
      switch (message.type) {
        case WEBVIEW_IN_MSG.SEND_MESSAGE:
          await this._handleSendMessage(message.text ?? '');
          break;
        case WEBVIEW_IN_MSG.OPEN_FILE:
          await this._handleOpenFile(message.file);
          break;
        case WEBVIEW_IN_MSG.OPEN_FILE_DIFF:
          await this._handleOpenFileDiff(message.file);
          break;
        case WEBVIEW_IN_MSG.STOP_PROCESSING:
          this._stream.abort();
          break;
        case WEBVIEW_IN_MSG.READY:
          await this._handleWebviewReady();
          break;
        case WEBVIEW_IN_MSG.LOAD_MORE_HISTORY:
          await this._handleLoadMoreHistory();
          break;
        case WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX:
          this._historyService.setVisibleFirstIdx(message.idx);
          break;
        case WEBVIEW_IN_MSG.CREATE_DIALOG:
          await this._handleCreateDialog();
          break;
        case WEBVIEW_IN_MSG.SWITCH_DIALOG:
          await this._handleSwitchDialog(message.dialogId);
          break;
        case WEBVIEW_IN_MSG.RENAME_DIALOG:
          await this._handleRenameDialog(message.dialogId, message.title);
          break;
        case WEBVIEW_IN_MSG.DELETE_DIALOG:
          await this._handleDeleteDialog(message.dialogId);
          break;
        case WEBVIEW_IN_MSG.DELETE_DIALOG_CONFIRM:
          await this._handleDeleteDialogConfirm(message.dialogId, message.title);
          break;
        case WEBVIEW_IN_MSG.LOAD_DIALOGS:
          await this._handleLoadDialogs();
          break;
        case WEBVIEW_IN_MSG.RESTORE_CHECKPOINT:
          await this._handleRestoreCheckpoint(message.dialogId, message.checkpointId);
          break;
        case WEBVIEW_IN_MSG.APPROVE_SESSION:
          await this._handleApproveSession(message.dialogId);
          break;
        case WEBVIEW_IN_MSG.RESET_TO_APPROVED:
          await this._handleResetToApproved(message.dialogId);
          break;
        case WEBVIEW_IN_MSG.OPEN_SETTINGS:
          await vscode.commands.executeCommand('workbench.action.openSettings', 'agentsmithy');
          break;
        case WEBVIEW_IN_MSG.TOGGLE_DIFF_VIEW:
          await this._handleToggleDiffView();
          break;
      }
    });
  }

  _handleToggleDiffView = async (): Promise<void> => {
    try {
      const config = vscode.workspace.getConfiguration('diffEditor');
      const current = config.get<boolean>('renderSideBySide', true);
      await config.update('renderSideBySide', !current, vscode.ConfigurationTarget.Global);
    } catch {
      // swallow
    }
  };

  private _handleOpenFile = async (file?: string): Promise<void> => {
    try {
      if (typeof file !== 'string' || file.length === 0) {
        throw new Error(ERROR_MESSAGES.INVALID_FILE_PATH);
      }

      // Security: only allow opening files within the current workspace (if any)
      // Note: This is defense-in-depth and not critical for local VS Code since the user
      // already has full filesystem access. However, it provides some protection in edge cases:
      // 1. Remote scenarios (SSH, Codespaces) where filesystem access is more sensitive
      // 2. Malicious git repos with crafted filenames like "../../sensitive-file"
      // 3. Backend bugs that could generate invalid paths
      // File paths come from backend tool call results, which are typically safe.
      const workspaceRoot = this._configService.getWorkspaceRoot();
      if (typeof workspaceRoot === 'string' && workspaceRoot.length > 0) {
        const resolvedFile = path.resolve(file);
        const resolvedRoot = path.resolve(workspaceRoot);
        if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
          throw new Error('Opening files outside the workspace is not allowed');
        }
      }

      const uri = vscode.Uri.file(file);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {preview: false});
    } catch (err: unknown) {
      const context = typeof file === 'string' ? `Failed to open file: ${file}` : 'Failed to open file';
      const msg = getErrorMessage(err, context);
      void vscode.window.showErrorMessage(msg);
    }
  };

  // In-memory content provider for virtual documents used in diffs
  private _diffContentProvider?: vscode.TextDocumentContentProvider & {onDidChange?: vscode.Event<vscode.Uri>};
  private _diffContentEmitter?: vscode.EventEmitter<vscode.Uri>;
  private _diffContentMap: Map<string, string> = new Map();
  // Cache of last session changed files to resolve diffs from API (no Git dependency)
  private _lastChangedFiles: ChangedFile[] = [];

  private _ensureDiffProvider(): void {
    if (this._diffContentProvider) {
      return;
    }
    this._diffContentEmitter = new vscode.EventEmitter<vscode.Uri>();
    this._diffContentProvider = {
      onDidChange: this._diffContentEmitter.event,
      provideTextDocumentContent: (uri) => {
        // Compose stable key from authority and path
        // authority: always "left" or "right" (DIFF_SIDE_LEFT/DIFF_SIDE_RIGHT)
        // path: always starts with "/" per URI standard (e.g., "/src/file.ts")
        // Result: "left/src/file.ts" matches key used in _diffContentMap.set(leftKey, ...)
        // No collision risk since authority is controlled and path always has leading "/"
        const key = `${uri.authority}${uri.path}`;
        return this._diffContentMap.get(key) ?? '';
      },
    };
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this._diffContentProvider);
  }

  private _resolveAbsPath(p: string): string {
    const workspaceRoot = this._configService.getWorkspaceRoot();
    if (p.startsWith('/') || /^\w:\\/.test(p)) {
      return p;
    }
    return workspaceRoot ? `${workspaceRoot}/${p}` : p;
  }

  private _handleOpenFileDiff = async (file?: string): Promise<void> => {
    try {
      const target = this._validateDiffRequest(file);
      const cf = this._findChangedFileMeta(target);
      this._ensureDiffProvider();
      const {leftContent, rightContent} = await this._resolveDiffContents(cf, target);
      const title = this._formatDiffTitle(cf.status, target);
      await this._openVsCodeDiff(target, leftContent, rightContent, title);
    } catch (err: unknown) {
      const context = typeof file === 'string' ? `Failed to compare: ${file}` : 'Failed to compare';
      const msg = getErrorMessage(err, context);
      void vscode.window.showErrorMessage(msg);
    }
  };

  private _validateDiffRequest(file?: string): string {
    if (typeof file !== 'string' || file.length === 0) {
      throw new Error(ERROR_MESSAGES.INVALID_FILE_PATH);
    }
    // Security: Defense-in-depth workspace boundary check
    // Not critical since file paths come from backend's session.changed_files (git-controlled),
    // but provides protection against malicious repos with crafted filenames and Remote scenarios.
    const workspaceRoot = this._configService.getWorkspaceRoot();
    if (typeof workspaceRoot === 'string' && workspaceRoot.length > 0) {
      const resolvedFile = path.resolve(file);
      const resolvedRoot = path.resolve(workspaceRoot);
      if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
        throw new Error('Opening files outside the workspace is not allowed');
      }
    }
    return file;
  }

  private _findChangedFileMeta(target: string): ChangedFile {
    const cf = this._lastChangedFiles.find((x) => this._resolveAbsPath(x.path) === target || x.path === target);
    if (!cf) {
      throw new Error('Unknown changed file');
    }
    if (cf.is_binary || cf.is_too_large) {
      throw new Error('Cannot compare: file is binary or too large');
    }
    return cf;
  }

  _readFileContent = async (file: string): Promise<string> => {
    try {
      const uri = vscode.Uri.file(file);
      const doc = await vscode.workspace.openTextDocument(uri);
      return doc.getText();
    } catch {
      return '';
    }
  };

  private _resolveDiffContents = async (
    cf: ChangedFile,
    file: string,
  ): Promise<{leftContent: string; rightContent: string}> => {
    switch (cf.status) {
      case 'modified': {
        const leftContent = typeof cf.base_content === 'string' ? cf.base_content : '';
        const rightContent = await this._readFileContent(file);
        return {leftContent, rightContent};
      }
      case 'added': {
        const leftContent = '';
        const rightContent = await this._readFileContent(file);
        return {leftContent, rightContent};
      }
      case 'deleted': {
        const rightContent = '';
        const leftContent = typeof cf.base_content === 'string' ? cf.base_content : '';
        return {leftContent, rightContent};
      }
      default: {
        throw new Error('Unsupported status');
      }
    }
  };

  private _formatDiffTitle = (status: ChangedFile['status'], file: string): string => {
    const basename = path.posix.basename(file.replace(/\\/g, '/'));
    switch (status) {
      case 'modified':
        return `diff ${basename}`;
      case 'added':
        return `new ${basename}`;
      case 'deleted':
        return `delete ${basename}`;
      default:
        return `diff ${basename}`;
    }
  };

  private _openVsCodeDiff = async (
    file: string,
    leftContent: string,
    rightContent: string,
    title: string,
  ): Promise<void> => {
    // Use stable URIs so we can refresh content in-place via onDidChange
    const leftKey = `left/${file}`;
    const rightKey = `right/${file}`;
    this._diffContentMap.set(leftKey, leftContent);
    this._diffContentMap.set(rightKey, rightContent);

    const leftUri = vscode.Uri.parse(`agentsmithy-diff://${leftKey}`);
    const rightUri = vscode.Uri.parse(`agentsmithy-diff://${rightKey}`);

    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

    // Fire change to ensure editors pick up initial content (in case already open)
    this._diffContentEmitter?.fire(leftUri);
    this._diffContentEmitter?.fire(rightUri);
  };
  private _handleWebviewReady = async (): Promise<void> => {
    if (this._isInitializing) {
      this._outputChannel.appendLine('[_handleWebviewReady] Already initializing, skipping');
      return;
    }

    this._outputChannel.appendLine('[_handleWebviewReady] Starting...');
    this._isInitializing = true;

    try {
      this._outputChannel.appendLine('[_handleWebviewReady] Resolving current dialog...');
      const dialogId = await this._historyService.resolveCurrentDialogId();
      this._outputChannel.appendLine(`[_handleWebviewReady] Dialog ID resolved: ${dialogId ?? 'none'}`);

      if (dialogId) {
        this._outputChannel.appendLine('[_handleWebviewReady] Loading history...');
        await this._loadLatestHistoryPage(dialogId, true);
        this._outputChannel.appendLine('[_handleWebviewReady] History loaded');

        // Update header with current dialog title
        this._outputChannel.appendLine('[_handleWebviewReady] Loading dialogs...');
        await this._dialogService.loadDialogs();
        this._outputChannel.appendLine(`[_handleWebviewReady] Loaded ${this._dialogService.dialogs.length} dialogs`);

        const currentDialog = this._dialogService.currentDialog;
        const title = this._dialogService.getDialogDisplayTitle(currentDialog);
        this._postMessage({
          type: WEBVIEW_OUT_MSG.DIALOG_SWITCHED,
          dialogId,
          title,
        });

        // Scroll to bottom after initial history load
        this._postMessage({type: WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM, dialogId});

        // Update session status
        this._outputChannel.appendLine('[_handleWebviewReady] Updating session status...');
        await this._updateSessionStatus(dialogId);
        this._outputChannel.appendLine('[_handleWebviewReady] Complete!');
      } else {
        this._outputChannel.appendLine('[_handleWebviewReady] No dialog ID, skipping');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._outputChannel.appendLine(`[_handleWebviewReady] ERROR: ${errorMessage}`);
      // Don't show error if it's initial attempt before server is ready
      // The refresh after server start will succeed
    } finally {
      this._isInitializing = false;
    }
  };

  private _handleLoadMoreHistory = async (): Promise<void> => {
    const dialogId = this._historyService.currentDialogId;
    if (dialogId && this._historyService.hasMore && !this._historyService.isLoading) {
      this._loadPreviousHistoryPage(dialogId).catch((err: unknown) => {
        const msg = getErrorMessage(err, ERROR_MESSAGES.LOAD_HISTORY);
        this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
      });
    }
  };

  private _shouldUpdateSession = (type: string): boolean => {
    return (
      type === E.USER ||
      type === E.TOOL_CALL ||
      type === E.FILE_EDIT ||
      type === E.CHAT_END ||
      type === E.REASONING_END ||
      type === E.DONE
    );
  };

  private _safeUpdateSession = async (dialogId?: string): Promise<void> => {
    if (!dialogId) {
      return;
    }
    try {
      await this._updateSessionStatus(dialogId);
    } catch {
      // non-blocking
    }
  };

  private _safeReloadLatest = async (dialogId?: string): Promise<void> => {
    if (!dialogId) {
      return;
    }
    try {
      await this._loadLatestHistoryPage(dialogId, true);
    } catch {
      // non-blocking
    }
  };

  private _handleSendMessage = async (text: string): Promise<void> => {
    if (!this._view) {
      return;
    }

    const context = this._getCurrentFileContext();
    const request = {
      messages: [{role: 'user' as const, content: text}],
      context,
      stream: true,
      dialog_id: this._historyService.currentDialogId,
    };

    const eventHandlers = new StreamEventHandlers(
      (msg: unknown) => this._postMessage(msg as WebviewOutMessage),
      this._historyService.currentDialogId,
    );

    await this._runStream(request, eventHandlers);
  };

  private _handleStreamEvent = async (
    event: import('./api/StreamService').SSEEvent,
    eventHandlers: StreamEventHandlers,
    state: {currentDialogId?: string; hasError: boolean},
  ): Promise<void> => {
    await eventHandlers.handleEvent(event);

    if (event.dialog_id) {
      state.currentDialogId = event.dialog_id;
    }

    if (event.type === E.ERROR) {
      state.hasError = true;
    }

    if (this._shouldUpdateSession(event.type) && state.currentDialogId) {
      await this._safeUpdateSession(state.currentDialogId);
    }
  };

  private _handleStreamDone = async (dialogId: string, hasError: boolean): Promise<void> => {
    this._historyService.currentDialogId = dialogId;
    // Don't reload history if there was an error - it would overwrite the error message
    if (!hasError) {
      await this._safeReloadLatest(dialogId);
    }
  };

  private _runStream = async (
    request: import('./api/StreamService').ChatRequest,
    eventHandlers: StreamEventHandlers,
  ): Promise<void> => {
    try {
      let hasReceivedEvents = false;
      const state = {
        currentDialogId: this._historyService.currentDialogId,
        hasError: false,
      };

      for await (const event of this._stream.streamChat(request)) {
        hasReceivedEvents = true;
        await this._handleStreamEvent(event, eventHandlers, state);

        if (event.type === E.DONE && event.dialog_id) {
          await this._handleStreamDone(event.dialog_id, state.hasError);
        }
      }

      if (!hasReceivedEvents) {
        eventHandlers.handleNoResponse();
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === ERROR_NAMES.ABORT) {
        eventHandlers.handleAbort();
      } else if (error instanceof Error) {
        eventHandlers.handleConnectionError(error);
      }
    } finally {
      eventHandlers.finalize();
    }
  };

  /**
   * Switch to a dialog - common logic used across multiple operations
   */
  private _switchToDialog = async (dialogId: string, scrollToBottom = true): Promise<void> => {
    await this._dialogService.switchDialog(dialogId);
    this._historyService.currentDialogId = dialogId;

    // Load history for the dialog
    await this._loadLatestHistoryPage(dialogId, true);

    // Update UI
    const dialog = this._dialogService.currentDialog;
    const title = this._dialogService.getDialogDisplayTitle(dialog);
    this._postMessage({
      type: WEBVIEW_OUT_MSG.DIALOG_SWITCHED,
      dialogId,
      title,
    });

    // Scroll to bottom if requested
    if (scrollToBottom) {
      this._postMessage({type: WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM, dialogId});
    }

    // Reload dialogs list to update active state
    await this._handleLoadDialogs();

    // Update session status for new dialog
    await this._updateSessionStatus(dialogId);
  };

  private _handleCreateDialog = async (): Promise<void> => {
    try {
      const dialog = await this._dialogService.createDialog();
      await this._switchToDialog(dialog.id);
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to create dialog');
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    }
  };

  private _handleSwitchDialog = async (dialogId: string): Promise<void> => {
    try {
      await this._switchToDialog(dialogId);
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to switch dialog');
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    }
  };

  private _handleRenameDialog = async (dialogId: string, title: string): Promise<void> => {
    try {
      await this._dialogService.updateDialog(dialogId, {title});

      // Update current dialog title if it's the one being renamed
      if (dialogId === this._dialogService.currentDialogId) {
        const dialog = this._dialogService.currentDialog;
        const displayTitle = this._dialogService.getDialogDisplayTitle(dialog);
        this._postMessage({
          type: WEBVIEW_OUT_MSG.DIALOG_SWITCHED,
          dialogId,
          title: displayTitle,
        });
      }

      // Reload dialogs list
      await this._handleLoadDialogs();
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to rename dialog');
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    }
  };

  private _handleDeleteDialogConfirm = async (dialogId: string, title: string): Promise<void> => {
    const result = await vscode.window.showWarningMessage(`Delete conversation "${title}"?`, {modal: true}, 'Delete');

    if (result === 'Delete') {
      await this._handleDeleteDialog(dialogId);
    }
  };

  private _handleDeleteDialog = async (dialogId: string): Promise<void> => {
    try {
      const wasCurrentDialog = dialogId === this._historyService.currentDialogId;

      await this._dialogService.deleteDialog(dialogId);

      // Reload dialogs list first to get updated list
      await this._handleLoadDialogs();

      // If deleted dialog was current, switch to the most recent one
      if (wasCurrentDialog) {
        const dialogs = this._dialogService.dialogs;

        if (dialogs.length > 0) {
          // Switch to the first (most recent) dialog
          await this._switchToDialog(dialogs[0].id);
        } else {
          // No dialogs left, clear everything
          this._historyService.currentDialogId = undefined;
          this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL, events: []});

          this._postMessage({
            type: WEBVIEW_OUT_MSG.DIALOG_SWITCHED,
            dialogId: null,
            title: 'New dialog',
          });
        }
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to delete dialog');
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    }
  };

  private _handleLoadDialogs = async (): Promise<void> => {
    // Show loading state
    this._postMessage({type: WEBVIEW_OUT_MSG.DIALOGS_LOADING});

    try {
      await this._dialogService.loadDialogs();

      this._postMessage({
        type: WEBVIEW_OUT_MSG.DIALOGS_UPDATE,
        dialogs: this._dialogService.dialogs.map((d) => ({
          id: d.id,
          title: d.title,
          updated_at: d.updated_at,
        })),
        currentDialogId: this._dialogService.currentDialogId,
      });
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to load dialogs');
      this._postMessage({type: WEBVIEW_OUT_MSG.DIALOGS_ERROR, error: msg});
    }
  };

  private _updateSessionStatus = async (dialogId: string): Promise<void> => {
    try {
      const status = await this._apiService.getSessionStatus(dialogId);
      // Cache changed files so we can open diffs without Git
      this._lastChangedFiles = status.changed_files;
      this._postMessage({
        type: WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE,
        hasUnapproved: status.has_unapproved,
        changedFiles: status.changed_files,
      });

      // Refresh any open diff editors to reflect latest base/current state
      await this._refreshOpenDiffEditorsFromStatus();
    } catch {
      // Silent fail - session status is not critical
    }
  };

  private _collectVisibleDiffFiles = (files: Set<string>): void => {
    for (const ed of vscode.window.visibleTextEditors) {
      const uri = ed.document.uri;
      if (uri.scheme !== DIFF_SCHEME) {
        continue;
      }
      if (uri.authority === DIFF_SIDE_LEFT || uri.authority === DIFF_SIDE_RIGHT) {
        const filePath = uri.path.replace(/^\/+/, '/');
        files.add(filePath);
      }
    }
  };

  private _collectTabGroupDiffFiles = (files: Set<string>): void => {
    try {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (input instanceof vscode.TabInputTextDiff) {
            this._addDiffFileIfMatches(files, input.original);
            this._addDiffFileIfMatches(files, input.modified);
          }
        }
      }
    } catch {
      // Tab API might not exist in older VS Code - ignore
    }
  };

  private _addDiffFileIfMatches = (files: Set<string>, uri: vscode.Uri): void => {
    if (uri.scheme === DIFF_SCHEME && (uri.authority === DIFF_SIDE_LEFT || uri.authority === DIFF_SIDE_RIGHT)) {
      files.add(uri.path.replace(/^\/+/, '/'));
    }
  };

  _detectOpenDiffFiles = (): string[] => {
    // Find files that currently have our custom diff open (either side visible)
    const files = new Set<string>();
    this._collectVisibleDiffFiles(files);
    this._collectTabGroupDiffFiles(files);
    return Array.from(files);
  };
  _uriForSide = (file: string, side: 'left' | 'right'): vscode.Uri =>
    vscode.Uri.parse(`${DIFF_SCHEME}://${side}/${file}`);

  private async _refreshOpenDiffEditorsFromStatus(): Promise<void> {
    this._ensureDiffProvider();
    const files = this._detectOpenDiffFiles();
    for (const file of files) {
      const cf = this._lastChangedFiles.find((x) => this._resolveAbsPath(x.path) === file || x.path === file);

      if (cf && !cf.is_binary && !cf.is_too_large) {
        // Update contents for files that still exist in the new session
        const {leftContent, rightContent} = await this._resolveDiffContents(cf, file);
        const leftKey = `left/${file}`;
        const rightKey = `right/${file}`;
        this._diffContentMap.set(leftKey, leftContent);
        this._diffContentMap.set(rightKey, rightContent);
        this._diffContentEmitter?.fire(this._uriForSide(file, 'left'));
        this._diffContentEmitter?.fire(this._uriForSide(file, 'right'));
      } else {
        // File is no longer part of the new session changes – close its diff tab to avoid stale view
        await this._closeDiffTabsForFile(file);
      }
    }
  }

  private async _closeDiffTabsForFile(file: string): Promise<void> {
    try {
      const leftUri = this._uriForSide(file, 'left');
      const rightUri = this._uriForSide(file, 'right');
      const groups = vscode.window.tabGroups.all;
      for (const group of groups) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (input instanceof vscode.TabInputTextDiff) {
            const original = input.original;
            const modified = input.modified;
            // Match either side to our URIs
            const matches =
              (original.scheme === DIFF_SCHEME && original.toString() === leftUri.toString()) ||
              (modified.scheme === DIFF_SCHEME && modified.toString() === rightUri.toString());
            if (matches) {
              await vscode.window.tabGroups.close(tab, true);
            }
          }
        }
      }
    } catch {
      // Best-effort: ignore if Tab API not available
    }
  }

  private _handleRestoreCheckpoint = async (dialogId: string, checkpointId: string): Promise<void> => {
    try {
      // Show confirmation dialog
      const result = await vscode.window.showWarningMessage(
        `Restore to this state?\n\nThis will restore all files to their state at this checkpoint.`,
        {modal: true},
        'Restore',
      );

      if (result !== 'Restore') {
        return;
      }

      // Perform restore
      await this._apiService.restoreCheckpoint(dialogId, checkpointId);

      // Show success message
      this._postMessage({
        type: WEBVIEW_OUT_MSG.SHOW_INFO,
        message: 'Restored to checkpoint',
      });

      // Reload history to show the new state
      await this._loadLatestHistoryPage(dialogId, true);

      // Update session status
      await this._updateSessionStatus(dialogId);
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to restore checkpoint');
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    }
  };

  private _handleApproveSession = async (dialogId: string): Promise<void> => {
    try {
      // Perform approve
      const result = await this._apiService.approveSession(dialogId);

      // Show success message
      this._postMessage({
        type: WEBVIEW_OUT_MSG.SHOW_INFO,
        message: `Approved ${result.commits_approved} commits`,
      });

      // Reload history
      await this._loadLatestHistoryPage(dialogId, true);

      // Update session status
      await this._updateSessionStatus(dialogId);
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to approve session');
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    }
  };

  private _handleResetToApproved = async (dialogId: string): Promise<void> => {
    try {
      // Show confirmation dialog
      const result = await vscode.window.showWarningMessage(
        'Reset to approved state?\n\nThis will discard all unapproved changes in the current session.',
        {modal: true},
        'Reset',
      );

      if (result !== 'Reset') {
        // User cancelled - notify webview to clear processing state
        this._postMessage({type: WEBVIEW_OUT_MSG.SESSION_OPERATION_CANCELLED});
        return;
      }

      // Perform reset
      await this._apiService.resetToApproved(dialogId);

      // Show success message
      this._postMessage({
        type: WEBVIEW_OUT_MSG.SHOW_INFO,
        message: 'Reset to approved state',
      });

      // Reload history
      await this._loadLatestHistoryPage(dialogId, true);

      // Update session status
      await this._updateSessionStatus(dialogId);
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Failed to reset to approved');
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    }
  };

  private _getHtmlForWebview = (webview: vscode.Webview): string => {
    const nonce: string = getNonce();

    const markedPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js');
    const markedUri = webview.asWebviewUri(markedPath);

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
    );

    const workspaceRoot = this._configService.getWorkspaceRoot() || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <title>AgentSmithy Chat</title>
    <link rel="stylesheet" href="${codiconCssUri.toString()}">
    <link rel="stylesheet" href="${styleUri.toString()}">
    <script nonce="${nonce}" src="${markedUri.toString()}"></script>
</head>
<body>
    <div class="${CSS_CLASSES.CHAT_CONTAINER}">
        <div class="chat-header" id="chatHeader">
            <div class="dialog-selector">
                <button class="dialog-title-btn" id="dialogTitleBtn" aria-label="Select dialog">
                    <span class="dialog-title-text" id="dialogTitleText">New dialog</span>
                    <svg class="dropdown-icon" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M8 11L3 6h10z"/>
                    </svg>
                </button>
                <div class="dialog-dropdown hidden" id="dialogDropdown">
                    <div class="dialogs-list" id="dialogsList">
                        <div class="dialog-item loading">Loading...</div>
                    </div>
                </div>
            </div>
            <button class="new-dialog-btn" id="newDialogBtn" title="New conversation" aria-label="New conversation">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 3.5v4.5h4.5v1H8v4.5H7V9H2.5V8H7V3.5h1z"/>
                </svg>
            </button>
        </div>
        <div id="dialogViews" class="dialog-views-container"></div>
        <div class="${CSS_CLASSES.MESSAGES}" id="${DOM_IDS.MESSAGES}">
            <div class="${CSS_CLASSES.WELCOME_PLACEHOLDER}" id="${DOM_IDS.WELCOME_PLACEHOLDER}">
                Type a message to start...
            </div>
        </div>
        <div class="session-changes hidden" id="sessionChanges"></div>
        <div class="session-actions" id="sessionActions">
            <button class="session-action-btn settings-btn" id="settingsBtn" title="Open Settings" aria-label="Open Settings">
                <span class="codicon codicon-gear" aria-hidden="true"></span>
            </button>

            <div class="model-selector">
                <button class="model-selector-btn" id="modelSelectorBtn" aria-label="Select model">
                    <span class="model-selector-text" id="modelSelectorText">GPT-5</span>
                    <svg class="dropdown-icon" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M8 5L13 10 3 10z"/>
                    </svg>
                </button>
                <div class="model-dropdown hidden" id="modelDropdown">
                    <div class="model-item" data-model="gpt5">
                        <span class="model-name">GPT-5</span>
                    </div>
                    <div class="model-item" data-model="gpt5-mini">
                        <span class="model-name">GPT-5 Mini</span>
                    </div>
                </div>
            </div>
            <div class="flex-spacer"></div>
            <button class="session-action-btn session-approve-btn" id="sessionApproveBtn" title="Approve all changes" aria-label="Approve all changes" disabled>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                </svg>
            </button>
            <button class="session-action-btn session-reset-btn" id="sessionResetBtn" title="Discard all unapproved changes" aria-label="Discard all unapproved changes" disabled>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
                </svg>
            </button>
        </div>
        <div class="${CSS_CLASSES.INPUT_CONTAINER}">
            <textarea 
                id="${DOM_IDS.MESSAGE_INPUT}" 
                placeholder="Type your message..."
                rows="1"
            ></textarea>
            <button id="${DOM_IDS.SEND_BUTTON}" title="Send (Enter)" aria-label="Send">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
            </button>
        </div>
    </div>
    
    <script nonce="${nonce}">
        window.WORKSPACE_ROOT = ${JSON.stringify(workspaceRoot)};
    </script>
    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  };
  private _getCurrentFileContext = (): ChatContext | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const document = editor.document;
    const selection = editor.selection;

    return {
      current_file: {
        path: document.fileName,
        language: document.languageId,
        content: document.getText(),
        selection: !selection.isEmpty ? document.getText(selection) : undefined,
      },
    };
  };
}

const getNonce = (): string => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};
