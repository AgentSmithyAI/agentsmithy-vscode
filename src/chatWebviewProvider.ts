import * as vscode from 'vscode';
import {AgentSmithyClient} from './agentSmithyClient';
import {ERROR_MESSAGES, VIEWS} from './constants';
import {ConfigService} from './services/ConfigService';
import {StreamEventHandlers} from './services/EventHandlers';
import {HistoryService} from './services/HistoryService';
import {getErrorMessage} from './utils/typeGuards';

// Messages sent from the webview to the extension
type WebviewInMessage =
  | {type: 'sendMessage'; text?: string}
  | {type: 'openFile'; file?: string}
  | {type: 'stopProcessing'}
  | {type: 'ready'}
  | {type: 'loadMoreHistory'};

// Messages sent from the extension to the webview
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

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _client: AgentSmithyClient,
    private readonly _historyService: HistoryService,
    private readonly _configService: ConfigService,
  ) {
    // Listen to history state changes
    this._historyService.onDidChangeState(() => {
      this._postMessage({type: 'historySetLoadMoreEnabled', enabled: !this._historyService.isLoading});
    });
  }

  private _postMessage(msg: WebviewOutMessage): void {
    this._view?.webview.postMessage(msg);
  }

  private async _loadLatestHistoryPage(dialogId: string, replace = false): Promise<void> {
    if (!this._view) {
      return;
    }

    this._postMessage({type: 'historySetLoadMoreEnabled', enabled: false});

    try {
      const result = await this._historyService.loadLatest(dialogId);
      if (result) {
        this._postMessage({type: 'historySetLoadMoreVisible', visible: result.hasMore});
        if (result.events.length > 0) {
          if (replace) {
            this._postMessage({type: 'historyReplaceAll', events: result.events});
          } else {
            this._postMessage({type: 'historyPrependEvents', events: result.events});
          }
        } else if (replace) {
          this._postMessage({type: 'historyReplaceAll', events: []});
        }
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: 'showError', error: msg});
    } finally {
      this._postMessage({type: 'historySetLoadMoreEnabled', enabled: true});
    }
  }

  private async _loadPreviousHistoryPage(dialogId: string): Promise<void> {
    if (!this._view) {
      return;
    }

    this._postMessage({type: 'historySetLoadMoreEnabled', enabled: false});

    try {
      const result = await this._historyService.loadPrevious(dialogId);
      if (result) {
        this._postMessage({type: 'historySetLoadMoreVisible', visible: result.hasMore});
        if (result.events.length > 0) {
          this._postMessage({type: 'historyPrependEvents', events: result.events});
        }
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      this._postMessage({type: 'showError', error: msg});
    } finally {
      this._postMessage({type: 'historySetLoadMoreEnabled', enabled: true});
    }
  }

  public sendMessage(content: string): void {
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
        case 'sendMessage':
          await this._handleSendMessage(message.text ?? '');
          break;
        case 'openFile':
          await this._handleOpenFile(message.file);
          break;
        case 'stopProcessing':
          this._client.abort();
          break;
        case 'ready':
          await this._handleWebviewReady();
          break;
        case 'loadMoreHistory':
          await this._handleLoadMoreHistory();
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
        this._postMessage({type: 'showError', error: msg});
      });
    }
  };

  private _handleSendMessage = async (text: string): Promise<void> => {
    if (!this._view) {
      return;
    }

    const context = this._client.getCurrentFileContext();
    const request = {
      messages: [{role: 'user' as const, content: text}],
      context,
      stream: true,
      dialog_id: this._historyService.currentDialogId,
    };

    const eventHandlers = new StreamEventHandlers((msg: unknown) => this._postMessage(msg as WebviewOutMessage));

    try {
      let hasReceivedEvents = false;

      for await (const event of this._client.streamChat(request)) {
        hasReceivedEvents = true;
        await eventHandlers.handleEvent(event);

        if (event.type === 'done' && event.dialog_id) {
          this._historyService.currentDialogId = event.dialog_id;
        }
      }

      if (!hasReceivedEvents) {
        eventHandlers.handleNoResponse();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        eventHandlers.handleAbort();
      } else if (error instanceof Error) {
        eventHandlers.handleConnectionError(error);
      }
      this._postMessage({type: 'endAssistantMessage'});
    } finally {
      eventHandlers.finalize();
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
        window.WORKSPACE_ROOT = ${JSON.stringify(workspaceRoot)};
    </script>
    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
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
