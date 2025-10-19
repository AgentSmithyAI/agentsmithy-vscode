import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../shared/messages';
import {MessageHandler} from './MessageHandler';
import {MessageRenderer} from './renderer';
import {ScrollManager} from './ScrollManager';
import {StreamingStateManager} from './StreamingStateManager';
import {VSCodeAPI, WebviewOutMessage} from './types';
import {UIController} from './UIController';
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

/**
 * Main webview coordinator - delegates responsibilities to specialized managers
 */
class ChatWebview {
  private vscode: VSCodeAPI;
  private renderer: MessageRenderer;
  private scrollManager: ScrollManager;
  private streamingState: StreamingStateManager;
  private uiController: UIController;
  private messageHandler: MessageHandler;

  private messagesContainer: HTMLElement;
  private messageInput: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private loadMoreBtn: HTMLElement | null;

  constructor(workspaceRoot: string) {
    this.vscode = acquireVsCodeApi();

    // Get DOM elements
    this.messagesContainer = document.getElementById('messages') as HTMLElement;
    this.messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    this.sendButton = document.getElementById('sendButton') as HTMLButtonElement;
    this.loadMoreBtn = document.getElementById('loadMoreBtn');
    const welcomePlaceholder = document.getElementById('welcomePlaceholder');

    // Initialize specialized managers
    this.renderer = new MessageRenderer(this.messagesContainer, this.loadMoreBtn, welcomePlaceholder, workspaceRoot);
    this.streamingState = new StreamingStateManager();
    this.uiController = new UIController(this.messageInput, this.sendButton);
    this.scrollManager = new ScrollManager(this.messagesContainer, this.vscode, this.renderer);
    this.messageHandler = new MessageHandler(
      this.renderer,
      this.streamingState,
      this.scrollManager,
      this.uiController,
      this.messagesContainer,
    );

    this.setupEventListeners();
    this.initializeMarked();

    // Notify extension
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.READY});
  }

  private setupEventListeners(): void {
    // Send on Enter
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Send/Stop button
    this.sendButton.addEventListener('click', () => {
      if (this.streamingState.isCurrentlyProcessing()) {
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.STOP_PROCESSING});
      } else {
        this.sendMessage();
      }
    });

    // Hide legacy Load more button
    if (this.loadMoreBtn) {
      this.loadMoreBtn.style.display = 'none';
    }

    // File link clicks
    window.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target?.matches?.('.file-link')) {
        e.preventDefault();
        const fileAttr = target.getAttribute('data-file') || '';
        const file = decodeURIComponent(fileAttr);
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_FILE, file});
      }
    });

    // Message handler
    window.addEventListener('message', (event) => {
      this.handleMessage(event.data as WebviewOutMessage);
    });

    // Respond to provider's query for the first visible idx
    window.addEventListener('message', (event) => {
      const data = event.data as {type?: string} | undefined;
      if (data?.type === WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX) {
        this.scrollManager.requestFirstVisibleIdx();
      }
    });
  }

  private sendMessage(): void {
    const text = this.uiController.getAndClearInput();
    if (!text || this.streamingState.isCurrentlyProcessing()) {
      return;
    }

    this.renderer.addMessage('user', text);

    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.SEND_MESSAGE,
      text,
    });

    this.streamingState.setProcessing(true);
    this.uiController.setProcessing(true);
  }

  private handleMessage(message: WebviewOutMessage): void {
    this.messageHandler.handle(message);
  }

  private initializeMarked(): void {
    if (typeof marked === 'undefined') {
      return;
    }

    const renderer = new marked.Renderer();
    renderer.code = (code: string, infostring?: string): string => {
      const lang =
        String(infostring || '')
          .trim()
          .split(/\s+/)[0] || '';
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
