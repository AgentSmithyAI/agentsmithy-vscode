import * as vscode from 'vscode';
import { AgentSmithyClient } from './agentSmithyClient';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agentsmithy.chatView';
    
    private _view?: vscode.WebviewView;
    private _client: AgentSmithyClient;
    private _currentDialogId?: string;
    
    constructor(private readonly _extensionUri: vscode.Uri) {
        this._client = new AgentSmithyClient();
    }
    
    public sendMessage(content: string) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'addMessage',
                message: {
                    role: 'user',
                    content: content
                }
            });
            
            this._handleSendMessage(content);
        }
    }
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'node_modules')
            ]
        };
        
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'sendMessage':
                    await this._handleSendMessage(message.text);
                    break;
                case 'openFile': {
                    try {
                        const uri = vscode.Uri.file(message.file);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(doc, { preview: false });
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to open file: ${message.file}`);
                    }
                    break;
                }
                case 'ready':
                    // Webview is ready, send initial state if needed
                    break;
            }
        });
        
        // Update client when configuration changes or when status.json might have changed
        vscode.workspace.onDidChangeConfiguration(e => {
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
            messages: [{
                role: 'user' as const,
                content: text
            }],
            context,
            stream: true,
            dialog_id: this._currentDialogId
        };
        
        // User message is already shown by the webview itself
        
        try {
            let chatBuffer = '';
            let hasReceivedEvents = false;
            
            // Stream response
            for await (const event of this._client.streamChat(request)) {
                hasReceivedEvents = true;
                switch (event.type) {
                    case 'chat_start':
                        chatBuffer = '';
                        this._view.webview.postMessage({ type: 'startAssistantMessage' });
                        break;
                    case 'chat':
                        if (event.content !== undefined) {
                            chatBuffer += event.content;
                            this._view.webview.postMessage({
                                type: 'appendToAssistant',
                                content: event.content
                            });
                        }
                        break;
                    case 'chat_end':
                        this._view.webview.postMessage({ type: 'endAssistantMessage' });
                        break;
                        
                    case 'reasoning_start':
                        this._view.webview.postMessage({
                            type: 'startReasoning'
                        });
                        break;
                        
                    case 'reasoning':
                        if (event.content) {
                            this._view.webview.postMessage({
                                type: 'appendToReasoning',
                                content: event.content
                            });
                        }
                        break;
                        
                    case 'reasoning_end':
                        this._view.webview.postMessage({
                            type: 'endReasoning'
                        });
                        break;
                        
                    case 'tool_call':
                        this._view.webview.postMessage({
                            type: 'showToolCall',
                            tool: event.name,
                            args: event.args
                        });
                        break;
                        
                    case 'file_edit':
                        this._view.webview.postMessage({
                            type: 'showFileEdit',
                            file: event.file,
                            diff: event.diff
                        });
                        break;
                        
                    case 'error':
                        this._view.webview.postMessage({
                            type: 'showError',
                            error: event.error
                        });
                        break;
                        
                    case 'done':
                        this._view.webview.postMessage({
                            type: 'endAssistantMessage'
                        });
                        if (event.dialog_id) {
                            this._currentDialogId = event.dialog_id;
                        }
                        break;
                }
            }
            
            // If no events were received at all, ensure UI is unlocked
            if (!hasReceivedEvents) {
                this._view.webview.postMessage({
                    type: 'showError',
                    error: 'No response from server'
                });
                this._view.webview.postMessage({
                    type: 'endAssistantMessage'
                });
            }
            } catch (error) {
                this._view.webview.postMessage({
                    type: 'showError',
                    error: error instanceof Error ? error.message : 'Connection error'
                });
                this._view.webview.postMessage({
                    type: 'endAssistantMessage'
                });
            } finally {
                // Ensure processing state is always cleared
                this._view.webview.postMessage({
                    type: 'endAssistantMessage'
                });
            }
    }
    
    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();
        
        // Get path to marked library
        const markedPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js');
        const markedUri = webview.asWebviewUri(markedPath);
        
        // Get workspace root
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <title>AgentSmithy Chat</title>
    <link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'))}">
    <script src="${markedUri}"></script>
</head>
<body>
    <div class="chat-container">
        <div class="messages" id="messages">
            <div class="welcome-placeholder" id="welcomePlaceholder">
                Type a message to start...
            </div>
        </div>
        <div class="typing-indicator" id="typingIndicator">AgentSmithy is typing...</div>
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
        const typingIndicator = document.getElementById('typingIndicator');
        const welcomePlaceholder = document.getElementById('welcomePlaceholder');
        
        let currentAssistantMessage = null;
        let currentAssistantText = '';
        let currentReasoningBlock = null;
        let currentReasoningText = '';
        let isProcessing = false;
        
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
        
        sendButton.addEventListener('click', sendMessage);
        
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
                    console.warn('Response timeout - unlocking UI');
                    setProcessing(false);
                }
            }, 30000); // 30 seconds timeout
        }
        
        function setProcessing(processing) {
            isProcessing = processing;
            sendButton.disabled = processing;
            messageInput.disabled = processing;
            typingIndicator.classList.toggle('active', processing);
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
                    messageDiv.textContent = content;
                }
            }
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            return messageDiv;
        }
        
        function escapeHtml(str) {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // Use marked library for markdown rendering
        function renderMarkdown(text) {
            if (window.marked) {
                // Parse markdown and return HTML
                return window.marked.parse(text);
            }
            
            // Fallback if marked is not loaded
            return escapeHtml(text).replace(/\\n/g, '<br>');
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
            }).join('\\n');
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
                       a.target_notebook || a.paths?.[0] || null;
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
                    
                case 'web_search':
                    return 'Web search: ' + (a.search_term || 'unknown');
                    
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
            } else {
                // No file path, just show text
                toolDiv.textContent = '• ' + formattedInfo.text;
            }
            
            messagesContainer.appendChild(toolDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function addFileEdit(file, diff) {
            // Hide welcome placeholder
            if (welcomePlaceholder) {
                welcomePlaceholder.style.display = 'none';
            }
            
            const editDiv = document.createElement('div');
            editDiv.className = 'file-edit';
            const fileName = file.split('/').pop() || file;
            editDiv.innerHTML = '<div class="file-header"><strong>📝 Edited: ' + fileName + '</strong>' +
                '<a class="file-link" data-file="' + encodeURIComponent(file) + '">Open</a></div>';
            if (diff) {
                const formatted = formatDiff(diff);
                editDiv.innerHTML += '<details class="diff-block"><summary>Show diff</summary>' +
                    '<div class="diff"><pre>' + formatted + '</pre></div>' +
                    '</details>';
            }
            messagesContainer.appendChild(editDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
            messagesContainer.appendChild(reasoningDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            return { block: reasoningDiv, content: content, header: header };
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'addMessage':
                    addMessage(message.message.role, message.message.content);
                    break;
                    
                case 'startAssistantMessage':
                    // Don't clear reasoning block here - it should be handled by endReasoning
                    currentAssistantText = '';
                    currentAssistantMessage = addMessage('assistant', '');
                    break;
                    
                case 'appendToAssistant':
                    if (!currentAssistantMessage) {
                        currentAssistantText = '';
                        currentAssistantMessage = addMessage('assistant', '');
                    }
                    if (message.content) {
                        currentAssistantText += message.content;
                        // Render progressively but safely. For performance we keep simple text until end,
                        // but still escape backticks to avoid breaking HTML when using innerHTML later.
                        currentAssistantMessage.textContent = currentAssistantText;
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }
                    break;
                    
                case 'endAssistantMessage':
                    // Ensure final text is displayed with markdown
                    if (currentAssistantMessage && currentAssistantText) {
                        currentAssistantMessage.innerHTML = renderMarkdown(currentAssistantText);
                    }
                    currentAssistantMessage = null;
                    currentAssistantText = '';
                    setProcessing(false);
                    break;
                    
                case 'showToolCall':
                    addToolCall(message.tool, message.args);
                    break;
                    
                case 'showFileEdit':
                    addFileEdit(message.file, message.diff);
                    break;
                    
                case 'showError':
                    showError(message.error);
                    setProcessing(false);
                    break;
                    
                case 'startReasoning':
                    currentReasoningText = '';
                    currentReasoningBlock = createReasoningBlock();
                    break;
                    
                case 'appendToReasoning':
                    if (currentReasoningBlock && currentReasoningBlock.content && message.content) {
                        currentReasoningText += message.content;
                        // Use textContent to avoid HTML injection
                        currentReasoningBlock.content.textContent = currentReasoningText;
                        // Ensure the content is visible
                        if (currentReasoningBlock.content.style.display === 'none') {
                            currentReasoningBlock.content.style.display = 'block';
                        }
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
            }
        });

        // Open file request from webview
        window.addEventListener('click', (e) => {
            const target = e.target;
            if (target && target.matches && target.matches('.file-link')) {
                e.preventDefault();
                const f = decodeURIComponent(target.getAttribute('data-file'));
                vscode.postMessage({ type: 'openFile', file: f });
            }
        });

        // Initialize marked if available
        if (window.marked) {
            window.marked.setOptions({
                breaks: true, // Enable line breaks
                gfm: true, // GitHub Flavored Markdown
                pedantic: false,
                smartLists: true,
                smartypants: false,
                // Custom renderer to ensure code blocks are properly escaped
                renderer: {
                    code(code, infostring, escaped) {
                        const lang = (infostring || '').match(/\\S*/)[0];
                        const escapedCode = escapeHtml(code);
                        if (lang) {
                            return '<pre><code class="language-' + escapeHtml(lang) + '">' + escapedCode + '</code></pre>';
                        }
                        return '<pre><code>' + escapedCode + '</code></pre>';
                    },
                    codespan(code) {
                        return '<code>' + escapeHtml(code) + '</code>';
                    }
                }
            });
        }
        
        // Notify extension that webview is ready
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`.replace(/\${workspaceRoot(?:\.replace\(.*?\))?}/g, workspaceRoot);
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
