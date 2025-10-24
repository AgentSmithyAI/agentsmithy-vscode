import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../shared/messages';
import {DialogsUI} from './DialogsUI';
import {DialogViewManager} from './DialogViewManager';
import {MessageHandler} from './MessageHandler';
import {MessageRenderer} from './renderer';
import {ScrollManager} from './ScrollManager';
import {SessionActionsUI} from './SessionActionsUI';
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
  private dialogsUI: DialogsUI;
  private sessionActionsUI: SessionActionsUI;
  private dialogViewManager: DialogViewManager;
  private currentDialogId: string | null = null;

  private messagesContainer: HTMLElement;
  private dialogViewsContainer: HTMLElement;
  private messageInput: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private loadMoreBtn: HTMLElement | null;

  constructor(workspaceRoot: string) {
    this.vscode = acquireVsCodeApi();

    // Get DOM elements
    this.messagesContainer = document.getElementById('messages') as HTMLElement;
    this.dialogViewsContainer = document.getElementById('dialogViews') as HTMLElement;
    this.messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    this.sendButton = document.getElementById('sendButton') as HTMLButtonElement;
    this.loadMoreBtn = document.getElementById('loadMoreBtn');
    const welcomePlaceholder = document.getElementById('welcomePlaceholder');

    // Initialize dialog view manager
    this.dialogViewManager = new DialogViewManager(workspaceRoot, this.vscode, this.dialogViewsContainer);

    // Initialize specialized managers (for legacy/fallback support)
    this.renderer = new MessageRenderer(this.messagesContainer, this.loadMoreBtn, welcomePlaceholder, workspaceRoot);
    this.streamingState = new StreamingStateManager();
    this.uiController = new UIController(this.messageInput, this.sendButton);
    this.scrollManager = new ScrollManager(this.messagesContainer, this.vscode, this.renderer);
    this.dialogsUI = new DialogsUI(this.vscode);
    this.sessionActionsUI = new SessionActionsUI(this.vscode);
    // Connect renderer to scroll manager for smart auto-scroll
    this.renderer.setScrollManager(this.scrollManager);
    this.messageHandler = new MessageHandler(
      this.renderer,
      this.streamingState,
      this.scrollManager,
      this.uiController,
      this.messagesContainer,
      this.dialogViewManager,
      this.sessionActionsUI,
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
      // Check if any dialog is processing
      const activeView = this.dialogViewManager.getActiveView();
      const isProcessing = activeView
        ? activeView.getStreamingState().isCurrentlyProcessing()
        : this.streamingState.isCurrentlyProcessing();

      if (isProcessing) {
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.STOP_PROCESSING});
      } else {
        this.sendMessage();
      }
    });

    // Hide legacy Load more button
    if (this.loadMoreBtn) {
      this.loadMoreBtn.style.display = 'none';
    }

    // File link clicks and checkpoint restore button clicks
    window.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target?.matches?.('.file-link')) {
        e.preventDefault();
        const fileAttr = target.getAttribute('data-file') || '';
        const file = decodeURIComponent(fileAttr);
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_FILE, file});
      }

      // Handle restore checkpoint button (including clicks on SVG inside)
      const restoreBtn = target?.closest?.('.restore-checkpoint-btn') as HTMLElement | null;
      if (restoreBtn) {
        e.preventDefault();
        const checkpointId = restoreBtn.getAttribute('data-checkpoint');
        const dialogId = this.dialogViewManager.getActiveDialogId();
        if (checkpointId && dialogId) {
          this.vscode.postMessage({
            type: WEBVIEW_IN_MSG.RESTORE_CHECKPOINT,
            dialogId,
            checkpointId,
          });
        }
      }
    });

    // Message handler
    window.addEventListener('message', (event) => {
      const message = event.data as WebviewOutMessage;
      this.handleMessage(message);
    });
  }

  private sendMessage(): void {
    const text = this.uiController.getAndClearInput();

    const activeView = this.dialogViewManager.getActiveView();
    const isProcessing = activeView
      ? activeView.getStreamingState().isCurrentlyProcessing()
      : this.streamingState.isCurrentlyProcessing();

    if (!text || isProcessing) {
      return;
    }

    // Use active view if available
    if (activeView) {
      activeView.getStreamingState().setProcessing(true, this.currentDialogId || undefined);
    } else {
      // Fallback to legacy behavior
      this.streamingState.setProcessing(true);
    }

    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.SEND_MESSAGE,
      text,
    });

    this.uiController.setProcessing(true);
  }

  private handleMessage(message: WebviewOutMessage): void {
    switch (message.type) {
      case WEBVIEW_OUT_MSG.DIALOGS_UPDATE:
        this.dialogsUI.updateDialogs(message.dialogs, message.currentDialogId);
        break;

      case WEBVIEW_OUT_MSG.DIALOGS_LOADING:
        this.dialogsUI.showLoading();
        break;

      case WEBVIEW_OUT_MSG.DIALOGS_ERROR:
        this.dialogsUI.showError(message.error);
        break;

      case WEBVIEW_OUT_MSG.DIALOG_SWITCHED:
        this.handleDialogSwitch(message.dialogId, message.title);
        break;

      case WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX: {
        const activeView = this.dialogViewManager.getActiveView();
        if (activeView) {
          activeView.getScrollManager().requestFirstVisibleIdx();
        } else {
          this.scrollManager.requestFirstVisibleIdx();
        }
        break;
      }

      case WEBVIEW_OUT_MSG.SHOW_TOOL_CALL:
        // Check if it's set_dialog_title and reload dialogs list
        if (message.tool === 'set_dialog_title') {
          this.vscode.postMessage({type: WEBVIEW_IN_MSG.LOAD_DIALOGS});
        }
        this.messageHandler.handle(message);
        break;

      default:
        this.messageHandler.handle(message);
    }
  }

  private handleDialogSwitch(dialogId: string | null, title: string): void {
    this.currentDialogId = dialogId;
    this.dialogsUI.updateCurrentDialog(dialogId, title);

    if (dialogId) {
      // Switch to the dialog view
      const view = this.dialogViewManager.switchToDialog(dialogId);

      // Update UI controller based on the dialog's streaming state
      const isProcessing = view.getStreamingState().isCurrentlyProcessing();
      this.uiController.setProcessing(isProcessing);

      // Hide legacy messages container
      this.messagesContainer.style.display = 'none';
    } else {
      // Show legacy messages container
      this.messagesContainer.style.display = 'block';
    }

    this.messageInput.focus();
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
