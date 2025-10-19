import {MessageRenderer} from './renderer';
import {ReasoningBlock, VSCodeAPI, WebviewOutMessage} from './types';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../shared/messages';
import {escapeHtml} from './utils';

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

  // Cached topmost visible idx (if any)
  private cachedFirstVisibleIdx: number | undefined;

  private currentAssistantMessage: HTMLElement | null = null;
  private currentAssistantText = '';
  private currentReasoningBlock: ReasoningBlock | null = null;
  private currentReasoningText = '';
  private isProcessing = false;

  // Infinite scroll + pruning state
  private isLoadingHistory = false;
  private canLoadMoreHistory = true;
  private readonly PRUNE_MAX_IDX = 20;
  // Scroll guard state to avoid repeated top-trigger loads caused by DOM reflows
  private lastScrollTop = 0;
  private topTriggerArmed = true;

  constructor(workspaceRoot: string) {
    this.vscode = acquireVsCodeApi();

    this.messagesContainer = document.getElementById('messages') as HTMLElement;
    this.messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    this.sendButton = document.getElementById('sendButton') as HTMLButtonElement;
    this.loadMoreBtn = document.getElementById('loadMoreBtn');
    this.welcomePlaceholder = document.getElementById('welcomePlaceholder');

    this.renderer = new MessageRenderer(
      this.messagesContainer,
      this.loadMoreBtn,
      this.welcomePlaceholder,
      workspaceRoot,
    );

    this.setupEventListeners();
    this.initializeMarked();

    // Notify extension
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.READY});
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
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.STOP_PROCESSING});
      } else {
        this.sendMessage();
      }
    });

    // Hide legacy Load more button and disable interaction
    if (this.loadMoreBtn) {
      this.loadMoreBtn.style.display = 'none';
    }

    // Infinite scroll up: load previous when scrolled near top
    this.messagesContainer.addEventListener('scroll', () => {
      const st = this.messagesContainer.scrollTop;
      const goingUp = st < this.lastScrollTop;

      // Arm the top trigger only after the user scrolls away sufficiently
      if (st > 300) {
        this.topTriggerArmed = true;
      }

      // Trigger when within 100px from top, only if user is scrolling up and the trigger is armed
      if (goingUp && st <= 100 && this.topTriggerArmed) {
        this.topTriggerArmed = false; // disarm until user scrolls away again
        this.maybeLoadMoreHistory();
      }

      // Prune when user is near bottom to keep recent view light
      const nearBottom =
        this.messagesContainer.scrollHeight - this.messagesContainer.scrollTop - this.messagesContainer.clientHeight <
        200;
      if (nearBottom) {
        // Before pruning, cache current first visible idx so provider can keep cursor forward-only
        this.cachedFirstVisibleIdx = this.getFirstVisibleIdx();
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX, idx: this.cachedFirstVisibleIdx});
        this.renderer.pruneByIdx(this.PRUNE_MAX_IDX);
      }

      this.lastScrollTop = st;
    });

    // File link clicks
    window.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target && target.matches && target.matches('.file-link')) {
        e.preventDefault();
        const fileAttr = target.getAttribute('data-file') || '';
        const f = decodeURIComponent(fileAttr);
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_FILE, file: f});
      }
    });

    // Message handler
    window.addEventListener('message', (event) => {
      this.handleMessage(event.data as WebviewOutMessage);
    });

    // Respond to provider's query for the first visible idx
    window.addEventListener('message', (event) => {
      const data = event.data as {type?: string} | undefined;
      if (data && data.type === WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX) {
        const idx = this.getFirstVisibleIdx();
        // Send back to extension
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX, idx});
      }
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
      type: WEBVIEW_IN_MSG.SEND_MESSAGE,
      text: text,
    });

    this.setProcessing(true);
  }

  private getFirstVisibleIdx(): number | undefined {
    // Find first user/assistant message with data-idx
    for (const child of Array.from(this.messagesContainer.children)) {
      if (child instanceof HTMLElement && child.dataset && child.dataset.idx) {
        const v = Number(child.dataset.idx);
        if (!Number.isNaN(v)) return v;
      }
    }
    return undefined;
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
      this.sendButton.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
      this.sendButton.classList.remove('processing');
      this.sendButton.title = 'Send (Enter)';
      this.sendButton.setAttribute('aria-label', 'Send');
    }
  }

  private handleMessage(message: WebviewOutMessage): void {
    switch (message.type) {
      case 'addMessage':
        this.renderer.addMessage(message.message.role, message.message.content);
        // User message means new tail content → prune older
        this.renderer.pruneByIdx(this.PRUNE_MAX_IDX);
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
        // Finalized assistant message → prune older
        this.renderer.pruneByIdx(this.PRUNE_MAX_IDX);
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
        // We use infinite scroll, keep button hidden regardless
        if (this.loadMoreBtn) {
          this.loadMoreBtn.style.display = 'none';
        }
        break;

      case 'historySetLoadMoreEnabled':
        this.canLoadMoreHistory = message.enabled !== false;
        if (!this.canLoadMoreHistory) {
          this.isLoadingHistory = false; // stop pending guards
        }
        // Re-arm top trigger when external state toggles loading capability back on
        if (this.canLoadMoreHistory) {
          // Only re-arm if the user scrolled away; otherwise wait until they do
          if (this.messagesContainer.scrollTop > 300) {
            this.topTriggerArmed = true;
          }
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
            // Prepend must iterate in reverse so DOM order remains ascending by idx at the top
            for (let i = message.events.length - 1; i >= 0; i--) {
              const evt = message.events[i];
              try {
                this.renderer.renderHistoryEvent(evt as any);
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

          // Finished a prepend load
          this.isLoadingHistory = false;
          // Do not immediately trigger another load due to being near the top after reflow
          // Require the user to scroll away (>300) before re-arming
          this.topTriggerArmed = false;
        }
        break;

      case 'scrollToBottom':
        this.renderer.scrollToBottom();
        // Prune when we explicitly move to bottom
        this.renderer.pruneByIdx(this.PRUNE_MAX_IDX);
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
      const first =
        String(infostring || '')
          .trim()
          .split(/\s+/)[0] || '';
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
  private maybeLoadMoreHistory(): void {
    if (this.isLoadingHistory || !this.canLoadMoreHistory) return;
    this.isLoadingHistory = true;
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.LOAD_MORE_HISTORY});
  }
}

// Initialize when DOM is ready
const workspaceRoot = (window as unknown as {WORKSPACE_ROOT: string}).WORKSPACE_ROOT || '';
new ChatWebview(workspaceRoot);
