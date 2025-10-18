import * as vscode from 'vscode';
import {AgentSmithyClient} from './agentSmithyClient';

// Messages sent from the webview to the extension
type WebviewInMessage =
  | { type: 'sendMessage'; text?: string }
  | { type: 'openFile'; file?: string }
  | { type: 'stopProcessing' }
  | { type: 'ready' }
  | { type: 'loadMoreHistory' };

// Messages sent from the extension to the webview
// Narrowed union to satisfy lint rules and avoid unsafe/any payloads
// Keep fields as strings where rendered into DOM
// Note: args is unknown but handled safely in webview script
type WebviewOutMessage =
  | { type: 'addMessage'; message: { role: 'user' | 'assistant'; content: string } }
  | { type: 'startAssistantMessage' }
  | { type: 'appendToAssistant'; content: string }
  | { type: 'endAssistantMessage' }
  | { type: 'startReasoning' }
  | { type: 'appendToReasoning'; content: string }
  | { type: 'endReasoning' }
  | { type: 'showToolCall'; tool?: string; args?: unknown }
  | { type: 'showFileEdit'; file: string; diff?: string }
  | { type: 'showError'; error: string }
  | { type: 'showInfo'; message: string }
  | { type: 'endStream' }
  | { type: 'historySetLoadMoreVisible'; visible: boolean }
  | { type: 'historySetLoadMoreEnabled'; enabled: boolean }
  | { type: 'historyPrependEvents'; events: unknown[] }
  | { type: 'historyReplaceAll'; events: unknown[] }
  | { type: 'scrollToBottom' };

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentsmithy.chatView';
  private static readonly LOAD_HISTORY_ERR = 'Failed to load history';

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
      const msg = e && typeof e === 'object' && 'message' in (e as Record<string, unknown>) ? String((e as Record<string, unknown>).message) : ChatWebviewProvider.LOAD_HISTORY_ERR;
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
      const msg = e && typeof e === 'object' && 'message' in (e as Record<string, unknown>) ? String((e as Record<string, unknown>).message) : ChatWebviewProvider.LOAD_HISTORY_ERR;
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
            const msg = err && typeof err === 'object' && 'message' in (err as Record<string, unknown>) ? String((err as Record<string, unknown>).message) : `Failed to open file: ${String(message.file)}`;
            vscode.window.showErrorMessage(String(msg));
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
                if (current && current.id) {
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
              const msg = err && typeof err === 'object' && 'message' in (err as Record<string, unknown>) ? String((err as Record<string, unknown>).message) : ChatWebviewProvider.LOAD_HISTORY_ERR;
              this._postMessage({type: 'showError', error: String(msg)});
            });
          }
          break;
      }
    });

    // Update client when configuration changes or when status.json might have changed
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentsmithy.serverUrl')) {
        this._client = new AgentSmithyClient();
      }
    });

    // Watch for changes to status.json
    const watcher = vscode.workspace.createFileSystemWatcher('**/.agentsmithy/status.json');
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
              // Update current dialog id, but do not reload history here.
              // History is only for older messages; streaming covers new ones.
              this._currentDialogId = event.dialog_id;
            }
            break;
        }
      }

      // If no events were received at all, ensure UI is unlocked
      if (!hasReceivedEvents) {
        this._postMessage({
          type: 'showError',
          error: 'No response from server',
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
          message: 'Request cancelled',
        });
      } else {
        this._postMessage({
          type: 'showError',
          error: error instanceof Error ? String(error.message) : 'Connection error',
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
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce: string = getNonce();

    // Get path to marked library
    const markedPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js');
    const markedUri = webview.asWebviewUri(markedPath);

    // Get workspace root
    const workspaceRoot = String(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');

    /* eslint-disable no-useless-escape */
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <title>AgentSmithy Chat</title>
    <link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css')).toString()}">
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
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const welcomePlaceholder = document.getElementById('welcomePlaceholder');
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        
        let currentAssistantMessage = null;
        let currentAssistantText = '';
        let currentReasoningBlock = null;
        let currentReasoningText = '';
        let isProcessing = false;
        let isPrepending = false;
        let suppressAutoScroll = false; // avoid per-item scroll during batch renders
        
        function insertNode(node) {
            const anchor = (loadMoreBtn && loadMoreBtn.parentNode === messagesContainer)
                ? loadMoreBtn.nextSibling
                : messagesContainer.firstChild;
            if (isPrepending) {
                messagesContainer.insertBefore(node, anchor);
            } else {
                messagesContainer.appendChild(node);
                if (!suppressAutoScroll) {
                    node.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
            }
        }
        
        // Auto-resize textarea
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = messageInput.scrollHeight + 'px';
        });
        
        // Send message on Enter (Shift+Enter for new line)
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        sendButton.addEventListener('click', () => {
            if (isProcessing) {
                // Stop processing
                vscode.postMessage({ type: 'stopProcessing' });
            } else {
                // Send message
                sendMessage();
            }
        });
        
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'loadMoreHistory' });
            });
        }
        
        function sendMessage() {
            const text = messageInput.value.trim();
            if (!text || isProcessing) return;
            
            messageInput.value = '';
            messageInput.style.height = 'auto';
            
            // Add user message immediately in UI
            addMessage('user', text);
            
            vscode.postMessage({
                type: 'sendMessage',
                text: text
            });
            
            setProcessing(true);
            
            // Safety timeout to ensure UI doesn't stay locked forever
            setTimeout(() => {
                if (isProcessing) {
                    setProcessing(false);
                }
            }, 30000); // 30 seconds timeout
        }
        
        function setProcessing(processing) {
            // Prevent redundant updates
            if (isProcessing === processing) {
                return;
            }
            
            isProcessing = processing;
            messageInput.disabled = processing;
            
            // Change button appearance based on processing state
            if (processing) {
                sendButton.innerHTML = '<svg class="stop-icon" viewBox="0 0 32 32" aria-hidden="true"><rect x="10" y="10" width="12" height="12" fill="currentColor" rx="2"/><circle cx="16" cy="16" r="15" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="47.1 47.1" class="spinner-ring" opacity="0.4"/></svg>';
                sendButton.classList.add('processing');
                sendButton.title = 'Stop';
                sendButton.setAttribute('aria-label', 'Stop');
            } else {
                sendButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
                sendButton.classList.remove('processing');
                sendButton.title = 'Send (Enter)';
                sendButton.setAttribute('aria-label', 'Send');
            }
        }
        
        function addMessage(role, content) {
            // Hide welcome placeholder when first message is added
            if (welcomePlaceholder) {
                welcomePlaceholder.style.display = 'none';
            }
            
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (role === 'user' ? 'user-message' : 'assistant-message');
            if (content) {
                if (role === 'assistant') {
                    messageDiv.innerHTML = renderMarkdown(content);
                } else {
                    // For user messages, escape HTML and linkify URLs
                    const escapedContent = escapeHtml(content);
                    messageDiv.innerHTML = linkifyUrls(escapedContent);
                }
            }
            insertNode(messageDiv);
            return messageDiv;
        }
        
        function escapeHtml(str) {
            const s = (str === undefined || str === null) ? '' : String(str);
            return s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
        
        function linkifyUrls(text) {
            // Regular expression to match URLs
            const urlRegex = /(https?:\\/\\/[^\\s<>"{}|\\\\^\\[\\]\`]+)/g;
            // Convert newlines to <br> and then linkify URLs
            return text.replace(/\\n/g, '<br>').replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        }

        // Use marked library for markdown rendering
        function renderMarkdown(text) {
            const t = (text === undefined || text === null) ? '' : String(text);
            if (window.marked) {
                // Ensure single newlines are preserved as breaks
                return window.marked.parse(t, { breaks: true, gfm: true });
            }
            
            // Fallback if marked is not loaded
            return escapeHtml(t).replace(/\\n/g, '<br>');
        }

        function formatDiff(diff) {
            const esc = escapeHtml;
            const lines = String(diff || '').split('\\n');
            return lines.map(line => {
                let cls = '';
                if (line.startsWith('@@')) cls = 'hunk';
                else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff')) cls = 'meta';
                else if (line.startsWith('+')) cls = 'added';
                else if (line.startsWith('-')) cls = 'removed';
                return '<span class="diff-line ' + cls + '">' + esc(line) + '</span>';
            }).join('');
        }

        function stripProjectPrefix(path) {
            // Get workspace root from vscode context passed to webview
            const workspaceRoot = '${workspaceRoot}';
            if (!path || !workspaceRoot) {
                return path;
            }
            
            // Normalize paths for comparison
            const normalizedPath = path.replace(/\\\\/g, '/');
            const normalizedRoot = workspaceRoot.replace(/\\\\/g, '/');
            
            // Check if path starts with workspace root
            if (normalizedPath.startsWith(normalizedRoot)) {
                // Remove workspace root and any leading slash
                let relative = normalizedPath.substring(normalizedRoot.length);
                if (relative.startsWith('/')) {
                    relative = relative.substring(1);
                }
                return relative || '.';
            }
            
            return path;
        }

        function formatToolCallWithPath(toolName, args) {
            const name = toolName ? toolName.toLowerCase() : '';
            const a = args || {};
            
            // Helper to extract file path from various argument names
            const extractPath = () => {
                return a.path || a.file || a.target_file || a.file_path || 
                       a.target_notebook || (a.paths && a.paths[0]) || null;
            };
            
            const path = extractPath();
            const displayPath = path ? stripProjectPrefix(path) : null;
            
            // Return structured info for different tool types
            switch(name) {
                case 'read_file':
                    return {
                        prefix: 'Reading: ',
                        path: path,
                        displayPath: displayPath || 'unknown',
                        text: 'Reading: ' + (displayPath || 'unknown')
                    };
                    
                case 'write_file':
                case 'write_to_file':
                case 'write':
                    return {
                        prefix: 'Writing: ',
                        path: path,
                        displayPath: displayPath || 'unknown',
                        text: 'Writing: ' + (displayPath || 'unknown')
                    };
                    
                case 'delete_file':
                    return {
                        prefix: 'Deleting: ',
                        path: path,
                        displayPath: displayPath || 'unknown',
                        text: 'Deleting: ' + (displayPath || 'unknown')
                    };
                    
                case 'create_file':
                    return {
                        prefix: 'Creating: ',
                        path: path,
                        displayPath: displayPath || 'unknown',
                        text: 'Creating: ' + (displayPath || 'unknown')
                    };
                    
                case 'replace_in_file':
                case 'edit':
                case 'str_replace':
                case 'search_replace':
                    return {
                        prefix: 'Editing: ',
                        path: path,
                        displayPath: displayPath || 'unknown',
                        text: 'Editing: ' + (displayPath || 'unknown')
                    };
                    
                case 'multiedit':
                    return {
                        prefix: 'Multi-edit: ',
                        path: path,
                        displayPath: displayPath || 'unknown',
                        text: 'Multi-edit: ' + (displayPath || 'unknown')
                    };
                    
                case 'edit_notebook':
                    return {
                        prefix: 'Editing notebook: ',
                        path: path,
                        displayPath: displayPath || 'unknown',
                        text: 'Editing notebook: ' + (displayPath || 'unknown')
                    };
                    
                case 'read_lints':
                    if (a.paths && a.paths.length > 0) {
                        const firstPath = a.paths[0];
                        return {
                            prefix: 'Reading linter errors for ',
                            path: firstPath,
                            displayPath: stripProjectPrefix(firstPath),
                            suffix: a.paths.length > 1 ? ' and ' + (a.paths.length - 1) + ' more' : '',
                            text: 'Reading linter errors for ' + a.paths.map(p => stripProjectPrefix(p)).join(', ')
                        };
                    }
                    return { text: 'Reading linter errors' };
                    
                default:
                    // For non-file operations, return the original formatted text
                    const formatted = formatToolCall(toolName, args);
                    return { text: formatted };
            }
        }

        function formatToolCall(toolName, args) {
            const name = toolName ? toolName.toLowerCase() : '';
            const a = args || {};
            
            // Helper function to format file paths
            const formatPath = (path) => stripProjectPrefix(path);
            
            // Tool-specific formatting handlers
            switch(name) {
                case 'read_file':
                    return 'Reading: ' + formatPath(a.path || a.file || a.target_file || 'unknown');
                    
                case 'write_file':
                case 'write_to_file':
                case 'write':
                    return 'Writing: ' + formatPath(a.path || a.file_path || a.target_file || 'unknown');
                    
                case 'delete_file':
                    return 'Deleting: ' + formatPath(a.path || a.target_file || 'unknown');
                    
                case 'create_file':
                    return 'Creating: ' + formatPath(a.path || a.file_path || 'unknown');
                    
                case 'list_files':
                case 'list_dir':
                    // Don't strip prefix for directories
                    return 'List: ' + (a.path || a.directory || a.target_directory || 'unknown');
                    
                case 'run_command':
                case 'run_terminal_cmd':
                    return 'Running: ' + (a.command || 'unknown');
                    
                case 'replace_in_file':
                case 'edit':
                case 'str_replace':
                case 'search_replace':
                    return 'Editing: ' + formatPath(a.path || a.file_path || 'unknown');
                    
                case 'search':
                case 'grep_search':
                case 'grep':
                case 'codebase_search':
                    return 'Search: ' + (a.query || a.pattern || a.regex || 'unknown');
                    
                case 'search_files':
                case 'glob_file_search':
                    {
                        const query = a.regex || a.pattern || a.query || a.glob_pattern || 'unknown';
                        const path = a.path || a.directory || a.target_directory;
                        const filePattern = a.file_pattern;
                        let result = 'Search: ' + query;
                        if (filePattern) {
                            result += ' (glob: ' + filePattern + ')';
                        }
                        if (path) {
                            result += ' in ' + path;
                        }
                        return result;
                    }
                    
                case 'multiedit':
                    return 'Multi-edit: ' + formatPath(a.file_path || 'unknown');
                    
                case 'edit_notebook':
                    return 'Editing notebook: ' + formatPath(a.target_notebook || 'unknown');
                    
                case 'todo_write':
                    return 'Updating todo list';
                    
                case 'web_search': {
                    // Align with Emacs search handler keys: prefer query/pattern if present
                    const q = a.query || a.search_term || a.q || a.keywords || a.term || a.text;
                    return 'Web search: ' + (q || 'unknown');
                }
                    
                case 'web_fetch':
                case 'fetch_url':
                    return 'Fetching: ' + (a.url || a.uri || 'unknown');
                    
                case 'update_memory':
                    return 'Updating memory: ' + (a.action || 'unknown');
                    
                case 'read_lints':
                    return 'Reading linter errors' + (a.paths && a.paths.length > 0 ? ' for ' + a.paths.map(p => formatPath(p)).join(', ') : '');
                    
                default:
                    // Fallback formatting
                    if (a && typeof a === 'object') {
                        const keys = Object.keys(a);
                        if (keys.length > 0) {
                            const firstKey = keys[0];
                            return toolName + ': ' + a[firstKey];
                        }
                    }
                    return toolName;
            }
        }

        function addToolCall(toolName, args) {
            // Hide welcome placeholder
            if (welcomePlaceholder) {
                welcomePlaceholder.style.display = 'none';
            }
            
            const toolDiv = document.createElement('div');
            toolDiv.className = 'tool-call';
            
            // Format the tool call and extract file path if present
            const formattedInfo = formatToolCallWithPath(toolName, args);
            
            if (formattedInfo.path && formattedInfo.path !== 'unknown') {
                // Create clickable file link
                toolDiv.innerHTML = '• ' + formattedInfo.prefix + 
                    '<a class="file-link" data-file="' + encodeURIComponent(formattedInfo.path) + '">' + 
                    escapeHtml(formattedInfo.displayPath) + '</a>' + 
                    (formattedInfo.suffix || '');
            } else if (formattedInfo.url && formattedInfo.url !== 'unknown') {
                // Create clickable URL
                toolDiv.innerHTML = '• ' + formattedInfo.prefix + 
                    '<a href="' + escapeHtml(formattedInfo.url) + '" target="_blank" rel="noopener noreferrer">' + 
                    escapeHtml(formattedInfo.url) + '</a>';
            } else {
                // No file path or URL, just show text - but linkify any URLs in the text
                const escapedText = escapeHtml(formattedInfo.text);
                toolDiv.innerHTML = '• ' + linkifyUrls(escapedText);
            }
            
            insertNode(toolDiv);
        }
        
        function addFileEdit(file, diff) {
            // Hide welcome placeholder
            if (welcomePlaceholder) {
                welcomePlaceholder.style.display = 'none';
            }
            
            const editDiv = document.createElement('div');
            editDiv.className = 'file-edit';
            // Header without "Edited:" label; show clickable relative path
            const header = document.createElement('div');
            header.className = 'file-header';
            const pathLink = document.createElement('a');
            pathLink.className = 'file-link';
            pathLink.setAttribute('data-file', encodeURIComponent(file));
            pathLink.textContent = stripProjectPrefix(file) || file;
            header.appendChild(pathLink);
            // Add explicit Open action too
            const openLink = document.createElement('a');
            openLink.className = 'file-link';
            openLink.setAttribute('data-file', encodeURIComponent(file));
            openLink.textContent = 'Open';
            openLink.style.marginLeft = '8px';
            header.appendChild(openLink);
            editDiv.appendChild(header);
            if (diff) {
                const formatted = formatDiff(diff);
                editDiv.innerHTML += '<details class="diff-block"><summary>Show diff</summary>' +
                    '<div class="diff"><pre>' + formatted + '</pre></div>' +
                    '</details>';
            }
            insertNode(editDiv);
        }
 
        function renderHistoryEvent(evt) {
            switch (evt.type) {
                case 'user':
                    addMessage('user', evt && typeof evt.content !== 'undefined' ? evt.content : '');
                    break;
                case 'chat':
                    addMessage('assistant', evt && typeof evt.content !== 'undefined' ? evt.content : '');
                    break;
                case 'reasoning':
                    // Insert a collapsed reasoning block with rendered markdown
                    const rb = createReasoningBlock();
                    rb.content.innerHTML = renderMarkdown(evt && typeof evt.content !== 'undefined' ? evt.content : '');
                    // Immediately collapse
                    rb.content.style.display = 'none';
                    const toggle = rb.header.querySelector('.reasoning-toggle');
                    if (toggle) toggle.textContent = '▶';
                    break;
                case 'tool_call':
                    addToolCall(evt ? evt.name : undefined, evt ? evt.args : undefined);
                    break;
                case 'file_edit':
                    addFileEdit(evt ? evt.file : undefined, evt ? evt.diff : undefined);
                    break;
            }
        }

        function safeRenderHistoryEvent(evt) {
            try {
                renderHistoryEvent(evt);
            } catch (e) {
                // noop: suppress render errors from history to avoid console noise in production
            }
        }
        
        function showError(error) {
            // Hide welcome placeholder
            if (welcomePlaceholder) {
                welcomePlaceholder.style.display = 'none';
            }
            
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.textContent = '❌ Error: ' + error;
            messagesContainer.appendChild(errorDiv);
            errorDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        
        function showInfo(message) {
            // Hide welcome placeholder
            if (welcomePlaceholder) {
                welcomePlaceholder.style.display = 'none';
            }
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'info';
            infoDiv.textContent = 'ℹ️ ' + message;
            messagesContainer.appendChild(infoDiv);
            infoDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        
        function createReasoningBlock() {
            // Hide welcome placeholder
            if (welcomePlaceholder) {
                welcomePlaceholder.style.display = 'none';
            }
            
            const reasoningDiv = document.createElement('div');
            reasoningDiv.className = 'reasoning-block';
            
            const header = document.createElement('div');
            header.className = 'reasoning-header';
            header.innerHTML = '<span class="reasoning-toggle">▼</span> Thinking...';
            header.style.cursor = 'pointer';
            
            const content = document.createElement('div');
            content.className = 'reasoning-content';
            content.style.display = 'block'; // Start expanded during streaming
            content.textContent = ' '; // Initialize with space to prevent collapse
            
            header.addEventListener('click', () => {
                const isExpanded = content.style.display !== 'none';
                content.style.display = isExpanded ? 'none' : 'block';
                const toggle = header.querySelector('.reasoning-toggle');
                if (toggle) {
                    toggle.textContent = isExpanded ? '▶' : '▼';
                }
            });
            
            reasoningDiv.appendChild(header);
            reasoningDiv.appendChild(content);
            insertNode(reasoningDiv);
            reasoningDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
            
            return { block: reasoningDiv, content: content, header: header };
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data || {};
            
            switch (message.type) {
                case 'addMessage':
                    addMessage(message.message.role, message.message.content);
                    break;
                    
                case 'startAssistantMessage':
                    // Don't clear reasoning block here - it should be handled by endReasoning
                    currentAssistantText = '';
                    currentAssistantMessage = addMessage('assistant', '');
                    if (currentAssistantMessage) {
                        currentAssistantMessage.classList.add('streaming');
                    }
                    break;
                    
                case 'appendToAssistant':
                    if (!currentAssistantMessage) {
                        currentAssistantText = '';
                        currentAssistantMessage = addMessage('assistant', '');
                        if (currentAssistantMessage) {
                            currentAssistantMessage.classList.add('streaming');
                        }
                    }
                    if (message.content) {
                        currentAssistantText += message.content;
                        // Render progressively but safely. For performance we keep simple text until end,
                        // but still escape backticks to avoid breaking HTML when using innerHTML later.
                        currentAssistantMessage.textContent = currentAssistantText;
                        currentAssistantMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }
                    break;
                    
                case 'endAssistantMessage':
                    // Ensure final text is displayed with markdown
                    if (currentAssistantMessage && currentAssistantText) {
                        currentAssistantMessage.classList.remove('streaming');
                        currentAssistantMessage.innerHTML = renderMarkdown(currentAssistantText);
                        // Ensure we see the tail of the message
                        currentAssistantMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }
                    currentAssistantMessage = null;
                    currentAssistantText = '';
                    break;
                    
                case 'showToolCall':
                    addToolCall(message.tool, message.args);
                    break;
                    
                case 'showFileEdit':
                    addFileEdit(message.file, message.diff);
                    break;
                    
                case 'showError':
                    showError(message.error);
                    break;
                    
                case 'showInfo':
                    showInfo(message.message);
                    break;
                    
                case 'endStream':
                    setProcessing(false);
                    break;
                    
                case 'startReasoning':
                    currentReasoningText = '';
                    currentReasoningBlock = createReasoningBlock();
                    break;
                    
                case 'appendToReasoning':
                    // Lazily create the reasoning block if it wasn't started explicitly
                    if (!currentReasoningBlock) {
                        currentReasoningText = '';
                        currentReasoningBlock = createReasoningBlock();
                    }
                    if (currentReasoningBlock && currentReasoningBlock.content && message.content) {
                        currentReasoningText += message.content;
                        // Render reasoning with Markdown formatting
                        currentReasoningBlock.content.innerHTML = renderMarkdown(currentReasoningText);
                        // Ensure the content is visible
                        if (currentReasoningBlock.content.style.display === 'none') {
                            currentReasoningBlock.content.style.display = 'block';
                        }
                        currentReasoningBlock.block.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }
                    break;
                    
                case 'endReasoning':
                    if (currentReasoningBlock && currentReasoningBlock.content && currentReasoningBlock.header) {
                        // Auto-collapse immediately
                        currentReasoningBlock.content.style.display = 'none';
                        const toggle = currentReasoningBlock.header.querySelector('.reasoning-toggle');
                        if (toggle) {
                            toggle.textContent = '▶';
                        }
                    }
                    currentReasoningBlock = null;
                    currentReasoningText = '';
                    break;

                case 'historySetLoadMoreVisible':
                    if (loadMoreBtn) {
                        loadMoreBtn.style.display = message.visible ? 'block' : 'none';
                    }
                    break;

                case 'historySetLoadMoreEnabled':
                    if (loadMoreBtn) {
                        loadMoreBtn.disabled = message.enabled === false ? true : false;
                    }
                    break;

                case 'historyPrependEvents':
                    if (Array.isArray(message.events)) {
                        // When injecting history, ensure we are not in a streaming state
                        currentAssistantMessage = null;
                        currentAssistantText = '';
                        currentReasoningBlock = null;
                        currentReasoningText = '';

                        // Remember scroll position before insertion
                        const prevTop = messagesContainer.scrollTop;
                        const prevHeight = messagesContainer.scrollHeight;

                        // Enable prepend mode so insertNode places nodes at top
                        isPrepending = true;
                        suppressAutoScroll = true;
                        try {
                            // Render exactly in server-provided order to preserve interleaving of blocks
                            for (const evt of message.events) {
                                safeRenderHistoryEvent(evt);
                            }
                        } finally {
                            isPrepending = false;
                            suppressAutoScroll = false;
                        }

                        // Restore scroll so content doesn't jump
                        const newHeight = messagesContainer.scrollHeight;
                        messagesContainer.scrollTop = prevTop + (newHeight - prevHeight);
                    }
                    break;

                case 'scrollToBottom':
                    // Ensure we are at the bottom (used after initial history load)
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    break;

                case 'historyReplaceAll':
                    // Replace all message contents with provided events
                    // Reset any streaming buffers so nothing overwrites history-rendered DOM
                    currentAssistantMessage = null;
                    currentAssistantText = '';
                    currentReasoningBlock = null;
                    currentReasoningText = '';

                    // Clear container except the loadMore button
                    const toRemove = [];
                    for (const child of Array.from(messagesContainer.children)) {
                        if (child !== loadMoreBtn) {
                            toRemove.push(child);
                        }
                    }
                    toRemove.forEach(n => n.remove());

                    // Render fresh
                    if (Array.isArray(message.events)) {
                        // Render in server-provided order to preserve interleaving
                        isPrepending = false; // render in natural order
                        suppressAutoScroll = true; // don't scroll per item
                        try {
                            for (const evt of message.events) {
                                safeRenderHistoryEvent(evt);
                            }
                        } finally {
                            suppressAutoScroll = false;
                        }
                        // Ensure we end up at the bottom after initial render
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }
                    break;
            }
        });

        // Open file request from webview
        window.addEventListener('click', (e) => {
            const target = e.target;
            if (target && target.matches && target.matches('.file-link')) {
                e.preventDefault();
                const fileAttr = target.getAttribute('data-file') || '';
                const f = decodeURIComponent(fileAttr);
                vscode.postMessage({ type: 'openFile', file: f });
            }
        });

        // Initialize marked if available
        if (window.marked) {
            // Use a proper Renderer instance to avoid TypeError: this.renderer.paragraph is not a function
            const renderer = new window.marked.Renderer();
            renderer.code = function(code, infostring) {
                const first = String(infostring || '').trim().split(/\s+/)[0] || '';
                const lang = first;
                const escapedCode = escapeHtml(code);
                if (lang) {
                    return '<pre><code class="language-' + escapeHtml(lang) + '">' + escapedCode + '</code></pre>';
                }
                return '<pre><code>' + escapedCode + '</code></pre>';
            };
            renderer.codespan = function(code) {
                return '<code>' + escapeHtml(code) + '</code>';
            };

            window.marked.setOptions({
                breaks: true, // Enable line breaks
                gfm: true, // GitHub Flavored Markdown
                pedantic: false,
                smartLists: true,
                smartypants: false,
                renderer
            });
        }
        
        // Notify extension that webview is ready
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`.replace(/\\${workspaceRoot(?:\\.replace\\(.*?\\))?}/g, workspaceRoot);
    /* eslint-enable no-useless-escape */
  }
}

const getNonce = () => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};
