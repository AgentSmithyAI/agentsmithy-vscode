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

  // Focus persistence state
  private shouldRestoreInputFocus = false;
  // Snapshot of caret/selection to restore after focus returns
  private lastSelection: {start: number; end: number; direction?: 'forward' | 'backward' | 'none'} | null = null;

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
    this.setupFocusPersistence();
    this.initializeMarked();
    this.setupModelSelector();

    // Notify extension
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.READY});
  }

  private setupModelSelector(): void {
    // Settings button - opens VSCode settings
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_SETTINGS});
      });
    }

    // Model selector dropdown
    const modelSelectorBtn = document.getElementById('modelSelectorBtn');
    const modelDropdown = document.getElementById('modelDropdown');
    const modelSelectorText = document.getElementById('modelSelectorText');

    if (!modelSelectorBtn || !modelDropdown || !modelSelectorText) {
      return;
    }

    let isModelDropdownOpen = false;

    // Toggle dropdown on button click
    modelSelectorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isModelDropdownOpen = !isModelDropdownOpen;
      modelDropdown.style.display = isModelDropdownOpen ? 'block' : 'none';
    });

    // Handle model selection
    modelDropdown.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const modelItem = target.closest('.model-item') as HTMLElement;
      if (modelItem) {
        const modelName = modelItem.getAttribute('data-model');
        const displayName = modelItem.querySelector('.model-name')?.textContent;
        if (modelName && displayName) {
          // Update displayed model name in selector button
          modelSelectorText.textContent = displayName;

          // Update active state
          modelDropdown.querySelectorAll('.model-item').forEach((item) => {
            item.classList.remove('active');
          });
          modelItem.classList.add('active');

          // Close dropdown
          isModelDropdownOpen = false;
          modelDropdown.style.display = 'none';

          // TODO: Send model selection to extension when backend support is ready
        }
      }
    });

    // Set default active model (gpt5)
    const defaultModel = modelDropdown.querySelector('.model-item[data-model="gpt5"]');
    if (defaultModel) {
      defaultModel.classList.add('active');
    }

    // Unified click handler for document - handles dropdown closing, file links, and checkpoint restores
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Close model dropdown when clicking outside
      if (isModelDropdownOpen && !modelDropdown.contains(target) && !modelSelectorBtn.contains(target)) {
        isModelDropdownOpen = false;
        modelDropdown.style.display = 'none';
      }

      // Handle file link clicks
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
  }

  private setupEventListeners(): void {
    // Send on Enter
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // Prevent VS Code/webview default key handling from stealing focus
        e.stopPropagation();
        try {
          // In some environments needed to block other listeners
          (e as any).stopImmediatePropagation?.();
        } catch {}
        this.sendMessage();
      }
    });

    // Track selection while typing/navigating so we can restore caret position
    const captureSelection = () => {
      this.lastSelection = {
        start: this.messageInput.selectionStart ?? this.messageInput.value.length,
        end: this.messageInput.selectionEnd ?? this.messageInput.value.length,
        direction: (this.messageInput as any).selectionDirection,
      };
    };
    this.messageInput.addEventListener('keyup', captureSelection);
    this.messageInput.addEventListener('mouseup', captureSelection);
    this.messageInput.addEventListener('select', captureSelection);
    this.messageInput.addEventListener('input', captureSelection);

    // Send/Stop button
    // Prevent the button from grabbing focus on mouse down; keep caret in input
    this.sendButton.addEventListener('mousedown', (e) => e.preventDefault());
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

    // Robustly keep input focused after sending (both Enter and button)
    // Defer to allow any DOM updates from setProcessing to settle
    requestAnimationFrame(() => {
      // If input was removed/disabled, skip
      if (!document.body.contains(this.messageInput) || this.messageInput.disabled) return;
      this.messageInput.focus();
      // Input is cleared on send; caret should be at beginning
      try {
        this.messageInput.setSelectionRange(0, 0);
      } catch {}
    });
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
    this.sessionActionsUI.setCurrentDialogId(dialogId);

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

    // Don't forcibly focus the input on dialog switch; let the user control focus.
  }

  private setupFocusPersistence(): void {
    // Focus persistence rules
    // - Restore focus if the input was the last focused element when the webview lost focus/visibility.
    // - Preserve caret/selection range; do NOT jump to end.
    // - Never steal focus if user interacted elsewhere meanwhile.

    let lastFocusedWasInput = false;

    // Track the last focused element reliably (focusin bubbles and fires before window blur in most cases)
    document.addEventListener('focusin', (e) => {
      lastFocusedWasInput = e.target === this.messageInput;
      if (lastFocusedWasInput) {
        // Keep caret snapshot up to date
        const valLen = this.messageInput.value.length;
        const start = Math.max(0, Math.min(valLen, this.messageInput.selectionStart ?? valLen));
        const end = Math.max(0, Math.min(valLen, this.messageInput.selectionEnd ?? valLen));
        this.lastSelection = {
          start,
          end,
          direction: (this.messageInput as any).selectionDirection,
        };
      }
    });

    const snapshotIfNeeded = () => {
      this.shouldRestoreInputFocus = !!lastFocusedWasInput;
      if (lastFocusedWasInput) {
        const valLen = this.messageInput.value.length;
        const start = Math.max(0, Math.min(valLen, this.messageInput.selectionStart ?? valLen));
        const end = Math.max(0, Math.min(valLen, this.messageInput.selectionEnd ?? valLen));
        this.lastSelection = {
          start,
          end,
          direction: (this.messageInput as any).selectionDirection,
        };
      }
    };

    // When VS Code window (and thus this webview) loses focus or becomes hidden
    window.addEventListener('blur', snapshotIfNeeded);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        snapshotIfNeeded();
      }
    });

    // When window returns to focus or webview becomes visible again, restore focus if needed
    const restoreIfNeeded = () => {
      if (!this.shouldRestoreInputFocus) return;
      // Defer twice to ensure the webview iframe is active and layout is ready
      requestAnimationFrame(() => {
        setTimeout(() => {
          // If user focused something else in the meantime inside the webview, do not steal
          if (!this.shouldRestoreInputFocus) return;
          if (!document.body.contains(this.messageInput) || this.messageInput.disabled) {
            this.shouldRestoreInputFocus = false;
            return;
          }
          this.messageInput.focus();
          const valLen = this.messageInput.value.length;
          const start = Math.max(0, Math.min(valLen, this.lastSelection?.start ?? valLen));
          const end = Math.max(0, Math.min(valLen, this.lastSelection?.end ?? valLen));
          const direction = this.lastSelection?.direction as any;
          try {
            this.messageInput.setSelectionRange(start, end, direction);
          } catch {
            this.messageInput.setSelectionRange(start, end);
          }
          this.shouldRestoreInputFocus = false;
        }, 50);
      });
    };

    window.addEventListener('focus', restoreIfNeeded);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        restoreIfNeeded();
      }
    });

    // Also handle explicit requests from the extension host to focus input.
    window.addEventListener('message', (event) => {
      const message = event.data as WebviewOutMessage;
      if (message?.type === WEBVIEW_OUT_MSG.FOCUS_INPUT) {
        // Respect shouldRestoreInputFocus flag to avoid stealing focus when not desired.
        if (!this.shouldRestoreInputFocus) return;
        requestAnimationFrame(() => restoreIfNeeded());
      }
    });
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
