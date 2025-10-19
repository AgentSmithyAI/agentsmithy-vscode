import * as vscode from 'vscode';
import { AgentSmithyClient } from './agentSmithyClient';
import { CONFIG_KEYS, ERROR_MESSAGES, STATUS_FILE_PATH, VIEWS } from './constants';
import { getErrorMessage } from './utils/typeGuards';

// Messages sent from the webview to the extension
type WebviewInMessage =
  | {type: 'sendMessage'; text?: string}
  | {type: 'openFile'; file?: string}
  | {type: 'stopProcessing'}
  | {type: 'ready'}
  | {type: 'loadMoreHistory'};

// Messages sent from the extension to the webview
// Narrowed union to satisfy lint rules and avoid unsafe/any payloads
// Keep fields as strings where rendered into DOM
// Note: args is unknown but handled safely in webview script
type WebviewOutMessage =
  | {type: 'addMessage'; message: {role: 'user' | 'assistant'; content: string}}
  | {type: 'startAssistantMessage'}
  | {type: 'appendToAssistant'; content: string}
  | {type: 'endAssistantMessage'}
  | {type: 'startReasoning'}
  | {type: 'appendToReasoning'; content: string}
  | {type: 'endReasoning'}
  | {type: 'showToolCall'; tool?: string; args?: unknown}
  | {type: 'showFileEdit'; file: string; diff?: string}
  | {type: 'showError'; error: string}
  | {type: 'showInfo'; message: string}
  | {type: 'endStream'}
  | {type: 'historySetLoadMoreVisible'; visible: boolean}
  | {type: 'historySetLoadMoreEnabled'; enabled: boolean}
  | {type: 'historyPrependEvents'; events: unknown[]}
  | {type: 'historyReplaceAll'; events: unknown[]}
  | {type: 'scrollToBottom'};

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEWS.CHAT;

  private _view?: vscode.WebviewView;
  private _client: AgentSmithyClient;
  private _currentDialogId?: string;
  private _historyCursor?: number; // history paging cursor (first_idx of last page)
  private _historyHasMore: boolean = false;
  private _historyLoading: boolean = false; // guard to prevent parallel loads

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._client = new AgentSmithyClient();
  }

  private _postMessage(msg: WebviewOutMessage) {
    // Centralized type-safe postMessage
    this._view?.webview.postMessage(msg);
  }

  private async _loadLatestHistoryPage(dialogId: string, options?: {replace?: boolean}) {
    if (!this._view || this._historyLoading) {
      return;
    }
    this._historyLoading = true;
    this._postMessage({type: 'historySetLoadMoreEnabled', enabled: false});
    try {
      const resp = await this._client.loadHistory(dialogId);
      // Debug placeholder retained intentionally (no side effects)
      this._historyCursor = resp.first_idx ?? undefined;
      this._historyHasMore = !!resp.has_more;
      this._postMessage({type: 'historySetLoadMoreVisible', visible: !!resp.has_more});
      if (Array.isArray(resp.events) && resp.events.length > 0) {
        if (options?.replace === true) {
          this._postMessage({type: 'historyReplaceAll', events: resp.events});
        } else {
          this._postMessage({type: 'historyPrependEvents', events: resp.events});
        }
      } else if (options?.replace === true) {
        // Clear even if no events
        this._postMessage({type: 'historyReplaceAll', events: []});
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: 'showError', error: msg});
    } finally {
      this._historyLoading = false;
      this._postMessage({type: 'historySetLoadMoreEnabled', enabled: true});
    }
  }

  // (removed) _loadEntireHistory: we only load the latest page per product requirement

  private async _loadPreviousHistoryPage(dialogId: string) {
    if (!this._view || this._historyLoading) {
      return;
    }
    const before = this._historyCursor;
    if (before === undefined) {
      return;
    }
    this._historyLoading = true;
    this._postMessage({type: 'historySetLoadMoreEnabled', enabled: false});
    try {
      const resp = await this._client.loadHistory(dialogId, undefined, before);
      this._historyCursor = resp.first_idx ?? undefined;
      this._historyHasMore = !!resp.has_more;
      this._postMessage({type: 'historySetLoadMoreVisible', visible: !!resp.has_more});
      if (Array.isArray(resp.events) && resp.events.length > 0) {
        this._postMessage({type: 'historyPrependEvents', events: resp.events});
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: 'showError', error: msg});
    } finally {
      this._historyLoading = false;
      this._postMessage({type: 'historySetLoadMoreEnabled', enabled: true});
    }
  }

  public sendMessage(content: string) {
    if (this._view) {
      this._postMessage({
        type: 'addMessage',
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
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri, vscode.Uri.joinPath(this._extensionUri, 'node_modules')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewInMessage) => {
      switch (message.type) {
        case 'sendMessage':
          await this._handleSendMessage(message.text ?? '');
          break;
        case 'openFile': {
          try {
            if (typeof message.file !== 'string' || message.file.length === 0) {
              throw new Error('Invalid file path');
            }
            const uri = vscode.Uri.file(message.file);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {preview: false});
          } catch (err: unknown) {
            const msg = getErrorMessage(err, `Failed to open file: ${String(message.file)}`);
            vscode.window.showErrorMessage(msg);
          }
          break;
        }
        case 'stopProcessing':
          // Stop the current request
          this._client.abort();
          break;
        case 'ready':
          // Webview is ready: resolve dialog id and load initial history if available
          (async () => {
            try {
              let dialogId = this._currentDialogId;
              if (!dialogId) {
                const current = await this._client.getCurrentDialog();
                if (current.id) {
                  dialogId = current.id;
                }
              }
              if (!dialogId) {
                try {
                  const list = await this._client.listDialogs();
                  if (list.current_dialog_id) {
                    dialogId = list.current_dialog_id;
                  } else if (Array.isArray(list.items) && list.items.length > 0) {
                    const sorted = [...list.items].sort(
                      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
                    );
                    dialogId = sorted[0].id;
                  }
                } catch {
                  /* noop */
                }
              }
              if (dialogId) {
                this._currentDialogId = dialogId;
                // Load only the latest history page and replace current content
                await this._loadLatestHistoryPage(dialogId, {replace: true});
              }
            } catch {
              /* noop */
            }
          })();
          break;
        case 'loadMoreHistory':
          if (this._currentDialogId && this._historyHasMore && !this._historyLoading) {
            this._loadPreviousHistoryPage(this._currentDialogId).catch((err: unknown) => {
              const msg = getErrorMessage(err, ERROR_MESSAGES.LOAD_HISTORY);
              this._postMessage({type: 'showError', error: msg});
            });
          }
          break;
      }
    });

    // Update client when configuration changes or when status.json might have changed
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_KEYS.SERVER_URL)) {
        this._client = new AgentSmithyClient();
      }
    });

    // Watch for changes to status.json
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${STATUS_FILE_PATH}`);
    watcher.onDidChange(() => {
      this._client = new AgentSmithyClient();
    });
    watcher.onDidCreate(() => {
      this._client = new AgentSmithyClient();
    });
  }

  private async _handleSendMessage(text: string) {
    if (!this._view) {
      return;
    }

    // Get current file context
    const context = this._client.getCurrentFileContext();

    // Prepare request
    const request = {
      messages: [
        {
          role: 'user' as const,
          content: text,
        },
      ],
      context,
      stream: true,
      dialog_id: this._currentDialogId,
    };

    // User message is already shown by the webview itself

    // No history refresh needed post-stream: SSE events are authoritative
    // and already include finalized reasoning/tool/file blocks.
    try {
      let _chatBuffer = '';
      let hasReceivedEvents = false;
      const openedFiles = new Set<string>();

      // Stream response
      for await (const event of this._client.streamChat(request)) {
        hasReceivedEvents = true;
        switch (event.type) {
          case 'chat_start':
            _chatBuffer = '';
            this._postMessage({type: 'startAssistantMessage'});
            break;
          case 'chat':
            if (event.content !== undefined) {
              _chatBuffer += event.content;
              this._postMessage({
                type: 'appendToAssistant',
                content: String(event.content),
              });
            }
            break;
          case 'chat_end':
            this._postMessage({type: 'endAssistantMessage'});
            break;

          case 'reasoning_start':
            this._postMessage({
              type: 'startReasoning',
            });
            break;

          case 'reasoning':
            if (event.content) {
              this._postMessage({
                type: 'appendToReasoning',
                content: String(event.content),
              });
            }
            break;

          case 'reasoning_end':
            this._postMessage({
              type: 'endReasoning',
            });
            break;

          case 'tool_call':
            this._postMessage({
              type: 'showToolCall',
              tool: event.name,
              args: event.args,
            });
            break;

          case 'file_edit':
            if (typeof event.file === 'string') {
              this._postMessage({
                type: 'showFileEdit',
                file: event.file,
                diff: typeof event.diff === 'string' ? event.diff : undefined,
              });
            }
            // Auto-open edited file immediately (focus editor)
            if (event.file && !openedFiles.has(event.file)) {
              openedFiles.add(event.file);
              try {
                const uri = vscode.Uri.file(String(event.file));
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, {preview: false});
              } catch {
                // noop
              }
            }
            break;

          case 'error':
            this._postMessage({
              type: 'showError',
              error: String(event.error ?? 'Unknown error'),
            });
            break;

          case 'done':
            if (event.dialog_id) {
              // Update current dialog id; no history refresh required
              this._currentDialogId = event.dialog_id;
            }
            break;
        }
      }

      // If no events were received at all, ensure UI is unlocked
      if (!hasReceivedEvents) {
        this._postMessage({
          type: 'showError',
          error: ERROR_MESSAGES.NO_RESPONSE,
        });
        this._postMessage({
          type: 'endAssistantMessage',
        });
      }
    } catch (error) {
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        this._postMessage({
          type: 'showInfo',
          message: ERROR_MESSAGES.REQUEST_CANCELLED,
        });
      } else {
        this._postMessage({
          type: 'showError',
          error: error instanceof Error ? String(error.message) : ERROR_MESSAGES.CONNECTION_ERROR,
        });
      }
      this._postMessage({
        type: 'endAssistantMessage',
      });
    } finally {
      // Ensure processing state is always cleared
      this._postMessage({
        type: 'endStream',
      });
      // No-op: do not reload history after SSE completion
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce: string = getNonce();

    // Get URIs for resources
    const markedPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js');
    const markedUri = webview.asWebviewUri(markedPath);
    
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));

    // Get workspace root
    const workspaceRoot = String(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');

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
    <div class="chat-container">
        <div class="messages" id="messages">
            <button id="loadMoreBtn" class="load-more" style="display:none;">Load previous</button>
            <div class="welcome-placeholder" id="welcomePlaceholder">
                Type a message to start...
            </div>
        </div>
        <div class="input-container">
            <textarea 
                id="messageInput" 
                placeholder="Type your message..."
                rows="1"
            ></textarea>
            <button id="sendButton" title="Send (Enter)" aria-label="Send">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
            </button>
        </div>
    </div>
    
    <script nonce="${nonce}">
        // Pass workspace root to webview
        window.WORKSPACE_ROOT = ${JSON.stringify(workspaceRoot)};
    </script>
    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}

const getNonce = (): string => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};
