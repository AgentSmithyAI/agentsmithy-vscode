import { MessageRenderer } from './renderer';
import { ReasoningBlock, VSCodeAPI, WebviewOutMessage } from './types';
import { escapeHtml } from './utils';

declare const acquireVsCodeApi: () => VSCodeAPI;
declare const marked: {
  Renderer: new () => {
    code: (code: string, infostring?: string) => string;
    codespan: (code: string) => string;
  };
  setOptions: (options: {
    breaks: boolean;
    gfm: boolean;
    pedantic: boolean;
    smartLists: boolean;
    smartypants: boolean;
    renderer: unknown;
  }) => void;
};

class ChatWebview {
  private vscode: VSCodeAPI;
  private renderer: MessageRenderer;
  private messagesContainer: HTMLElement;
  private messageInput: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private loadMoreBtn: HTMLElement | null;
  private welcomePlaceholder: HTMLElement | null;

  private currentAssistantMessage: HTMLElement | null = null;
  private currentAssistantText = '';
  private currentReasoningBlock: ReasoningBlock | null = null;
  private currentReasoningText = '';
  private isProcessing = false;

  constructor(workspaceRoot: string) {
    this.vscode = acquireVsCodeApi();

    this.messagesContainer = document.getElementById('messages') as HTMLElement;
    this.messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    this.sendButton = document.getElementById('sendButton') as HTMLButtonElement;
    this.loadMoreBtn = document.getElementById('loadMoreBtn');
    this.welcomePlaceholder = document.getElementById('welcomePlaceholder');

    this.renderer = new MessageRenderer(this.messagesContainer, this.loadMoreBtn, this.welcomePlaceholder, workspaceRoot);

    this.setupEventListeners();
    this.initializeMarked();

    // Notify extension
    this.vscode.postMessage({type: 'ready'});
  }

  private setupEventListeners(): void {
    // Auto-resize textarea
    this.messageInput.addEventListener('input', () => {
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
    });

    // Send on Enter
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Send/Stop button
    this.sendButton.addEventListener('click', () => {
      if (this.isProcessing) {
        this.vscode.postMessage({type: 'stopProcessing'});
      } else {
        this.sendMessage();
      }
    });

    // Load more button
    if (this.loadMoreBtn) {
      this.loadMoreBtn.addEventListener('click', () => {
        this.vscode.postMessage({type: 'loadMoreHistory'});
      });
    }

    // File link clicks
    window.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target && target.matches && target.matches('.file-link')) {
        e.preventDefault();
        const fileAttr = target.getAttribute('data-file') || '';
        const f = decodeURIComponent(fileAttr);
        this.vscode.postMessage({type: 'openFile', file: f});
      }
    });

    // Message handler
    window.addEventListener('message', (event) => {
      this.handleMessage(event.data as WebviewOutMessage);
    });
  }

  private sendMessage(): void {
    const text = this.messageInput.value.trim();
    if (!text || this.isProcessing) {
      return;
    }

    this.messageInput.value = '';
    this.messageInput.style.height = 'auto';

    this.renderer.addMessage('user', text);

    this.vscode.postMessage({
      type: 'sendMessage',
      text: text,
    });

    this.setProcessing(true);

    setTimeout(() => {
      if (this.isProcessing) {
        this.setProcessing(false);
      }
    }, 30000);
  }

  private setProcessing(processing: boolean): void {
    if (this.isProcessing === processing) {
      return;
    }

    this.isProcessing = processing;
    this.messageInput.disabled = processing;

    if (processing) {
      this.sendButton.innerHTML =
        '<svg class="stop-icon" viewBox="0 0 32 32" aria-hidden="true"><rect x="10" y="10" width="12" height="12" fill="currentColor" rx="2"/><circle cx="16" cy="16" r="15" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="47.1 47.1" class="spinner-ring" opacity="0.4"/></svg>';
      this.sendButton.classList.add('processing');
      this.sendButton.title = 'Stop';
      this.sendButton.setAttribute('aria-label', 'Stop');
    } else {
      this.sendButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
      this.sendButton.classList.remove('processing');
      this.sendButton.title = 'Send (Enter)';
      this.sendButton.setAttribute('aria-label', 'Send');
    }
  }

  private handleMessage(message: WebviewOutMessage): void {
    switch (message.type) {
      case 'addMessage':
        this.renderer.addMessage(message.message.role, message.message.content);
        break;

      case 'startAssistantMessage':
        this.currentAssistantText = '';
        this.currentAssistantMessage = this.renderer.addMessage('assistant', '');
        if (this.currentAssistantMessage) {
          this.currentAssistantMessage.classList.add('streaming');
        }
        break;

      case 'appendToAssistant':
        if (!this.currentAssistantMessage) {
          this.currentAssistantText = '';
          this.currentAssistantMessage = this.renderer.addMessage('assistant', '');
          if (this.currentAssistantMessage) {
            this.currentAssistantMessage.classList.add('streaming');
          }
        }
        if (message.content) {
          this.currentAssistantText += message.content;
          this.currentAssistantMessage.textContent = this.currentAssistantText;
          this.currentAssistantMessage.scrollIntoView({behavior: 'smooth', block: 'end'});
        }
        break;

      case 'endAssistantMessage':
        if (this.currentAssistantMessage && this.currentAssistantText) {
          this.currentAssistantMessage.classList.remove('streaming');
          this.currentAssistantMessage.innerHTML = this.renderer.renderMarkdown(this.currentAssistantText);
          this.currentAssistantMessage.scrollIntoView({behavior: 'smooth', block: 'end'});
        }
        this.currentAssistantMessage = null;
        this.currentAssistantText = '';
        break;

      case 'showToolCall':
        this.renderer.addToolCall(message.tool, message.args);
        break;

      case 'showFileEdit':
        this.renderer.addFileEdit(message.file, message.diff);
        break;

      case 'showError':
        this.renderer.showError(message.error);
        break;

      case 'showInfo':
        this.renderer.showInfo(message.message);
        break;

      case 'endStream':
        this.setProcessing(false);
        break;

      case 'startReasoning':
        this.currentReasoningText = '';
        this.currentReasoningBlock = this.renderer.createReasoningBlock();
        break;

      case 'appendToReasoning':
        if (!this.currentReasoningBlock) {
          this.currentReasoningText = '';
          this.currentReasoningBlock = this.renderer.createReasoningBlock();
        }
        if (this.currentReasoningBlock && this.currentReasoningBlock.content && message.content) {
          this.currentReasoningText += message.content;
          this.currentReasoningBlock.content.innerHTML = this.renderer.renderMarkdown(this.currentReasoningText);
          if (this.currentReasoningBlock.content.style.display === 'none') {
            this.currentReasoningBlock.content.style.display = 'block';
          }
          this.currentReasoningBlock.block.scrollIntoView({behavior: 'smooth', block: 'end'});
        }
        break;

      case 'endReasoning':
        if (this.currentReasoningBlock && this.currentReasoningBlock.content && this.currentReasoningBlock.header) {
          this.currentReasoningBlock.content.style.display = 'none';
          const toggle = this.currentReasoningBlock.header.querySelector('.reasoning-toggle');
          if (toggle) {
            toggle.textContent = '▶';
          }
        }
        this.currentReasoningBlock = null;
        this.currentReasoningText = '';
        break;

      case 'historySetLoadMoreVisible':
        if (this.loadMoreBtn) {
          this.loadMoreBtn.style.display = message.visible ? 'block' : 'none';
        }
        break;

      case 'historySetLoadMoreEnabled':
        if (this.loadMoreBtn) {
          (this.loadMoreBtn as HTMLButtonElement).disabled = message.enabled === false;
        }
        break;

      case 'historyPrependEvents':
        if (Array.isArray(message.events)) {
          this.currentAssistantMessage = null;
          this.currentAssistantText = '';
          this.currentReasoningBlock = null;
          this.currentReasoningText = '';

          const prevTop = this.messagesContainer.scrollTop;
          const prevHeight = this.messagesContainer.scrollHeight;

          this.renderer.setPrepending(true);
          this.renderer.setSuppressAutoScroll(true);
          try {
            for (const evt of message.events) {
              try {
                this.renderer.renderHistoryEvent(evt);
              } catch {
                // Suppress render errors
              }
            }
          } finally {
            this.renderer.setPrepending(false);
            this.renderer.setSuppressAutoScroll(false);
          }

          const newHeight = this.messagesContainer.scrollHeight;
          this.messagesContainer.scrollTop = prevTop + (newHeight - prevHeight);
        }
        break;

      case 'scrollToBottom':
        this.renderer.scrollToBottom();
        break;

      case 'historyReplaceAll': {
        this.currentAssistantMessage = null;
        this.currentAssistantText = '';
        this.currentReasoningBlock = null;
        this.currentReasoningText = '';

        this.renderer.clearMessages();

        if (Array.isArray(message.events)) {
          this.renderer.setPrepending(false);
          this.renderer.setSuppressAutoScroll(true);
          try {
            for (const evt of message.events) {
              try {
                this.renderer.renderHistoryEvent(evt);
              } catch {
                // Suppress render errors
              }
            }
          } finally {
            this.renderer.setSuppressAutoScroll(false);
          }
          this.renderer.scrollToBottom();
        }
        break;
      }
    }
  }

  private initializeMarked(): void {
    if (typeof marked === 'undefined') {
      return;
    }

    const renderer = new marked.Renderer();
    renderer.code = (code: string, infostring?: string): string => {
      const first = String(infostring || '').trim().split(/\s+/)[0] || '';
      const lang = first;
      const escapedCode = escapeHtml(code);
      if (lang) {
        return '<pre><code class="language-' + escapeHtml(lang) + '">' + escapedCode + '</code></pre>';
      }
      return '<pre><code>' + escapedCode + '</code></pre>';
    };
    renderer.codespan = (code: string): string => {
      return '<code>' + escapeHtml(code) + '</code>';
    };

    marked.setOptions({
      breaks: true,
      gfm: true,
      pedantic: false,
      smartLists: true,
      smartypants: false,
      renderer,
    });
  }
}

// Initialize when DOM is ready
const workspaceRoot = (window as unknown as {WORKSPACE_ROOT: string}).WORKSPACE_ROOT || '';
new ChatWebview(workspaceRoot);

