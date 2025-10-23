import * as vscode from 'vscode';
import type {HistoryEvent} from './api/ApiService';
import {StreamService, type ChatContext} from './api/StreamService';
import {CSS_CLASSES, DOM_IDS, SSE_EVENT_TYPES as E, ERROR_MESSAGES, ERROR_NAMES, VIEWS} from './constants';
import {ConfigService} from './services/ConfigService';
import {DialogService} from './services/DialogService';
import {StreamEventHandlers} from './services/EventHandlers';
import {HistoryService} from './services/HistoryService';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from './shared/messages';
import {getErrorMessage} from './utils/typeGuards';

// Messages sent from the webview to the extension
type WebviewInMessage =
  | {type: typeof WEBVIEW_IN_MSG.SEND_MESSAGE; text?: string}
  | {type: typeof WEBVIEW_IN_MSG.OPEN_FILE; file?: string}
  | {type: typeof WEBVIEW_IN_MSG.STOP_PROCESSING}
  | {type: typeof WEBVIEW_IN_MSG.READY}
  | {type: typeof WEBVIEW_IN_MSG.LOAD_MORE_HISTORY}
  | {type: typeof WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX; idx?: number}
  | {type: typeof WEBVIEW_IN_MSG.CREATE_DIALOG}
  | {type: typeof WEBVIEW_IN_MSG.SWITCH_DIALOG; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.RENAME_DIALOG; dialogId: string; title: string}
  | {type: typeof WEBVIEW_IN_MSG.DELETE_DIALOG; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.DELETE_DIALOG_CONFIRM; dialogId: string; title: string}
  | {type: typeof WEBVIEW_IN_MSG.LOAD_DIALOGS};
// Messages sent from the extension to the webview
type WebviewOutMessage =
  | {type: typeof WEBVIEW_OUT_MSG.ADD_MESSAGE; message: {role: 'user' | 'assistant'; content: string}}
  | {type: typeof WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT; content: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_ASSISTANT_MESSAGE}
  | {type: typeof WEBVIEW_OUT_MSG.START_REASONING}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_REASONING; content: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_REASONING}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_TOOL_CALL; tool?: string; args?: unknown}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_FILE_EDIT; file: string; diff?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_ERROR; error: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_INFO; message: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_STREAM}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_VISIBLE; visible: boolean}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED; enabled: boolean}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS; events: HistoryEvent[]}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL; events: HistoryEvent[]}
  | {type: typeof WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM}
  | {type: typeof WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX}
  | {
      type: typeof WEBVIEW_OUT_MSG.DIALOGS_UPDATE;
      dialogs: Array<{id: string; title: string | null; updated_at: string}>;
      currentDialogId: string | null;
    }
  | {type: typeof WEBVIEW_OUT_MSG.DIALOGS_LOADING}
  | {type: typeof WEBVIEW_OUT_MSG.DIALOGS_ERROR; error: string}
  | {type: typeof WEBVIEW_OUT_MSG.DIALOG_SWITCHED; dialogId: string | null; title: string};
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEWS.CHAT;

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _stream: StreamService,
    private readonly _historyService: HistoryService,
    private readonly _dialogService: DialogService,
    private readonly _configService: ConfigService,
  ) {
    // Listen to history state changes
    this._historyService.onDidChangeState(() => {
      // Enable only when not loading AND there is more to load
      const enable = !this._historyService.isLoading && this._historyService.hasMore;
      this._postMessage({
        type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED,
        enabled: enable,
      });
    });
  }

  private _postMessage(msg: WebviewOutMessage): void {
    this._view?.webview.postMessage(msg);
  }

  private async _loadLatestHistoryPage(dialogId: string, replace = false): Promise<void> {
    if (!this._view) {
      return;
    }

    this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED, enabled: false});

    try {
      const result = await this._historyService.loadLatest(dialogId);
      if (result) {
        this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_VISIBLE, visible: result.hasMore});
        if (result.events.length > 0) {
          if (replace) {
            this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL, events: result.events});
          } else {
            this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS, events: result.events});
          }
        } else if (replace) {
          this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL, events: []});
        }
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    } finally {
      // Enable only when there is more to load to avoid inconsistent UI states when button is hidden
      this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED, enabled: this._historyService.hasMore});
    }
  }

  private async _loadPreviousHistoryPage(dialogId: string): Promise<void> {
    if (!this._view) {
      return;
    }

    this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED, enabled: false});

    try {
      const result = await this._historyService.loadPrevious(dialogId);
      if (result) {
        this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_VISIBLE, visible: result.hasMore});
        if (result.events.length > 0) {
          this._postMessage({type: WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS, events: result.events});
        }
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: WEBVIEW_OUT_MSG.SHOW_ERROR, error: msg});
    } finally {
      // Enable only if there is more to load according to HistoryService
      this._postMessage({
        type: WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED,
        enabled: this._historyService.hasMore,
      });
    }
  }

  public sendMessage(content: string): void {
    if (this._view) {
      this._postMessage({
        type: WEBVIEW_OUT_MSG.ADD_MESSAGE,
        message: {
          role: 'user',
          content: String(content),
        },
      });

      this._handleSendMessage(content);
    }
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

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewInMessage) => {
      switch (message.type) {
        case WEBVIEW_IN_MSG.SEND_MESSAGE:
          await this._handleSendMessage(message.text ?? '');
          break;
        case WEBVIEW_IN_MSG.OPEN_FILE:
          await this._handleOpenFile(message.file);
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
      }
    });
  }

  private _handleOpenFile = async (file?: string): Promise<void> => {
    try {
      if (typeof file !== 'string' || file.length === 0) {
        throw new Error(ERROR_MESSAGES.INVALID_FILE_PATH);
      }
      const uri = vscode.Uri.file(file);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {preview: false});
    } catch (err: unknown) {
      const msg = getErrorMessage(err, `Failed to open file: ${String(file)}`);
      vscode.window.showErrorMessage(msg);
    }
  };

  private _handleWebviewReady = async (): Promise<void> => {
    try {
      const dialogId = await this._historyService.resolveCurrentDialogId();
      if (dialogId) {
        await this._loadLatestHistoryPage(dialogId, true);

        // Update header with current dialog title
        await this._dialogService.loadDialogs();
        const currentDialog = this._dialogService.currentDialog;
        const title = this._dialogService.getDialogDisplayTitle(currentDialog);
        this._postMessage({
          type: WEBVIEW_OUT_MSG.DIALOG_SWITCHED,
          dialogId,
          title,
        });

        // Scroll to bottom after initial history load
        this._postMessage({type: WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM});
      }
    } catch {
      // noop
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

    const eventHandlers = new StreamEventHandlers((msg: unknown) => this._postMessage(msg as WebviewOutMessage));

    try {
      let hasReceivedEvents = false;

      for await (const event of this._stream.streamChat(request)) {
        hasReceivedEvents = true;
        await eventHandlers.handleEvent(event);

        if (event.type === E.DONE && event.dialog_id) {
          this._historyService.currentDialogId = event.dialog_id;
          // Refresh the latest page to capture finalized blocks
          try {
            await this._loadLatestHistoryPage(event.dialog_id, true);
          } catch {
            // non-blocking
          }
        }
      }

      if (!hasReceivedEvents) {
        eventHandlers.handleNoResponse();
      }
    } catch (error) {
      if (error instanceof Error && error.name === ERROR_NAMES.ABORT) {
        eventHandlers.handleAbort();
      } else if (error instanceof Error) {
        eventHandlers.handleConnectionError(error);
      }
      // endAssistantMessage is sent inside eventHandlers for errors; avoid duplicate messages here
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
      this._postMessage({type: WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM});
    }

    // Reload dialogs list to update active state
    await this._handleLoadDialogs();
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

  private _getHtmlForWebview = (webview: vscode.Webview): string => {
    const nonce: string = getNonce();

    const markedPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js');
    const markedUri = webview.asWebviewUri(markedPath);

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));

    const workspaceRoot = this._configService.getWorkspaceRoot() || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <title>AgentSmithy Chat</title>
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
                <div class="dialog-dropdown" id="dialogDropdown" style="display:none;">
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
        <div class="${CSS_CLASSES.MESSAGES}" id="${DOM_IDS.MESSAGES}">
            <button id="${DOM_IDS.LOAD_MORE_BTN}" class="${CSS_CLASSES.LOAD_MORE}" style="display:none;">Load previous</button>
            <div class="${CSS_CLASSES.WELCOME_PLACEHOLDER}" id="${DOM_IDS.WELCOME_PLACEHOLDER}">
                Type a message to start...
            </div>
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
