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
            const config = vscode.workspace.getConfiguration('agentsmithy');
            const showReasoning = config.get<boolean>('showReasoning', false);
            
            let chatBuffer = '';
            
            // Stream response
            for await (const event of this._client.streamChat(request)) {
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
                        
                    case 'reasoning':
                        if (showReasoning && event.content) {
                            this._view.webview.postMessage({
                                type: 'appendToAssistant',
                                content: `\n*${event.content}*\n`,
                                isReasoning: true
                            });
                        }
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
        } catch (error) {
            this._view.webview.postMessage({
                type: 'showError',
                error: error instanceof Error ? error.message : 'Connection error'
            });
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
            <div class="message assistant-message">
                Welcome to AgentSmithy! I'm here to help you with coding tasks. How can I assist you today?
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
        
        let currentAssistantMessage = null;
        let currentAssistantText = '';
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
        }
        
        function setProcessing(processing) {
            isProcessing = processing;
            sendButton.disabled = processing;
            messageInput.disabled = processing;
            typingIndicator.classList.toggle('active', processing);
        }
        
        function addMessage(role, content) {
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

        function addToolCall(toolName) {
            const toolDiv = document.createElement('div');
            toolDiv.className = 'tool-call';
            toolDiv.textContent = '🔧 Using tool: ' + toolName;
            messagesContainer.appendChild(toolDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function addFileEdit(file, diff) {
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
            editDiv.addEventListener('click', (e) => {
                const target = e.target;
                if (target && target.classList && target.classList.contains('file-link')) {
                    e.preventDefault();
                    const f = decodeURIComponent(target.getAttribute('data-file'));
                    vscode.postMessage({ type: 'openFile', file: f });
                }
            });
            messagesContainer.appendChild(editDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function showError(error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.textContent = '❌ Error: ' + error;
            messagesContainer.appendChild(errorDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'addMessage':
                    addMessage(message.message.role, message.message.content);
                    break;
                    
                case 'startAssistantMessage':
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
                    addToolCall(message.tool);
                    break;
                    
                case 'showFileEdit':
                    addFileEdit(message.file, message.diff);
                    break;
                    
                case 'showError':
                    showError(message.error);
                    setProcessing(false);
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
</html>`;
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
