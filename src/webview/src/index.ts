import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../shared/messages';
import {DialogsUI} from './DialogsUI';
import {DialogViewManager} from './DialogViewManager';
import {MessageHandler} from './MessageHandler';
import {MessageRenderer} from './renderer';
import {ScrollManager} from './scroll/ScrollManager';
import {SessionActionsUI} from './SessionActionsUI';
import {StreamingStateManager} from './StreamingStateManager';
import {VSCodeAPI, WebviewOutMessage} from './types';
import {UIController} from './UIController';
import {escapeHtml} from './utils';
import {DOM_IDS, CSS_CLASSES, WEBVIEW_DEFAULTS} from '../../constants';

declare const acquireVsCodeApi: () => VSCodeAPI;

/**
 * Main webview coordinator - delegates responsibilities to specialized managers
 */
export class ChatWebview {
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
  private serverStatusOverlay: HTMLElement | null = null;

  // Focus persistence state
  private shouldRestoreInputFocus = false;
  // Snapshot of caret/selection to restore after focus returns
  private lastSelection: {start: number; end: number; direction?: 'forward' | 'backward' | 'none'} | null = null;
  // Set when user explicitly clicked "New dialog"; consumed on next DIALOG_SWITCHED
  private pendingFocusAfterCreate = false;

  private messagesContainer: HTMLElement;
  private dialogViewsContainer: HTMLElement;
  private messageInput: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;

  constructor(workspaceRoot: string) {
    this.vscode = acquireVsCodeApi();

    // Get DOM elements
    this.messagesContainer = document.getElementById(DOM_IDS.MESSAGES) as HTMLElement;
    this.dialogViewsContainer = document.getElementById(DOM_IDS.DIALOG_VIEWS) as HTMLElement;
    this.messageInput = document.getElementById(DOM_IDS.MESSAGE_INPUT) as HTMLTextAreaElement;
    this.sendButton = document.getElementById(DOM_IDS.SEND_BUTTON) as HTMLButtonElement;

    const welcomePlaceholder = document.getElementById(DOM_IDS.WELCOME_PLACEHOLDER);

    // Initialize dialog view manager
    this.dialogViewManager = new DialogViewManager(workspaceRoot, this.vscode, this.dialogViewsContainer);

    // Initialize specialized managers (for legacy/fallback support)
    this.renderer = new MessageRenderer(this.messagesContainer, welcomePlaceholder, workspaceRoot);
    this.streamingState = new StreamingStateManager();
    this.uiController = new UIController(this.messageInput, this.sendButton);
    this.scrollManager = new ScrollManager(this.messagesContainer, this.vscode, this.renderer);
    this.dialogsUI = new DialogsUI(this.vscode);
    // Hook into UI events to avoid heuristics
    this.dialogsUI.onCreateNewDialog = () => {
      this.pendingFocusAfterCreate = true;
    };
    this.sessionActionsUI = new SessionActionsUI(this.vscode, workspaceRoot);
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
    this.setupModelSelector();

    // Notify extension
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.READY});
  }

  private setupModelSelector(): void {
    // Settings button - opens AgentSmithy configuration panel
    const settingsBtn = document.getElementById(DOM_IDS.SETTINGS_BTN);
    // If needed, settingsBtn id should be kept centralized in constants.ts
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_SETTINGS});
      });
    }

    // Diff view toggle button
    const diffToggleBtn = document.getElementById(DOM_IDS.DIFF_VIEW_TOGGLE_BTN);
    if (diffToggleBtn) {
      diffToggleBtn.addEventListener('click', () => {
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.TOGGLE_DIFF_VIEW});
      });
    }

    // Model selector dropdown
    const modelSelectorBtn = document.getElementById(DOM_IDS.MODEL_SELECTOR_BTN);
    const modelDropdown = document.getElementById(DOM_IDS.MODEL_DROPDOWN);
    const modelSelectorText = document.getElementById(DOM_IDS.MODEL_SELECTOR_TEXT);
    // These IDs are also declared in constants.ts DOM_IDS

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
      const modelItem = target.closest('.' + CSS_CLASSES.MODEL_ITEM) as HTMLElement;
      if (modelItem) {
        const modelName = modelItem.getAttribute('data-model');
        const displayName = modelItem.querySelector('.' + CSS_CLASSES.MODEL_NAME)?.textContent;
        if (modelName && displayName) {
          // Update displayed model name in selector button
          modelSelectorText.textContent = displayName;

          // Update active state
          modelDropdown.querySelectorAll('.' + CSS_CLASSES.MODEL_ITEM).forEach((item) => {
            item.classList.remove('active');
          });
          modelItem.classList.add('active');

          // Close dropdown
          isModelDropdownOpen = false;
          modelDropdown.style.display = 'none';

          // Send workload selection to backend
          this.vscode.postMessage({
            type: WEBVIEW_IN_MSG.SELECT_WORKLOAD,
            workload: modelName,
          });
        }
      }
    });

    // Unified click handler for document - handles dropdown closing, file links, and checkpoint restores
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Close model dropdown when clicking outside
      if (isModelDropdownOpen && !modelDropdown.contains(target) && !modelSelectorBtn.contains(target)) {
        isModelDropdownOpen = false;
        modelDropdown.style.display = 'none';
      }

      // Handle file link clicks
      if (target?.matches?.('.' + CSS_CLASSES.FILE_LINK)) {
        e.preventDefault();
        const fileAttr = target.getAttribute('data-file') || '';
        const file = decodeURIComponent(fileAttr);
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_FILE, file});
      }

      // Handle restore checkpoint button (including clicks on SVG inside)
      const restoreBtn = target?.closest?.('.' + CSS_CLASSES.RESTORE_CHECKPOINT_BTN) as HTMLElement | null;
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

  private updateWorkloads(workloads: Array<{name: string; displayName: string}>, selected: string): void {
    const modelDropdown = document.getElementById(DOM_IDS.MODEL_DROPDOWN);
    const modelSelectorText = document.getElementById(DOM_IDS.MODEL_SELECTOR_TEXT);

    if (!modelDropdown || !modelSelectorText) {
      return;
    }

    // Clear existing items
    modelDropdown.innerHTML = '';

    // Render workload items
    for (const workload of workloads) {
      const item = document.createElement('div');
      item.className = CSS_CLASSES.MODEL_ITEM;
      item.setAttribute('data-model', workload.name);
      if (workload.name === selected) {
        item.classList.add('active');
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = CSS_CLASSES.MODEL_NAME;
      nameSpan.textContent = workload.displayName;
      item.appendChild(nameSpan);

      modelDropdown.appendChild(item);
    }

    // Update selector button text
    const selectedWorkload = workloads.find((w) => w.name === selected);
    if (selectedWorkload) {
      modelSelectorText.textContent = selectedWorkload.displayName;
    } else if (workloads.length > 0) {
      modelSelectorText.textContent = workloads[0].displayName;
    }
  }

  private setupEventListeners(): void {
    // Send on Enter
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // Prevent VS Code/webview default key handling from stealing focus
        e.stopPropagation();
        // In VS Code webviews we sometimes need to block other document-level listeners
        // (e.g. global keybindings or 3rd-party injected handlers) from seeing this Enter.
        // Guard the call and log in dev if something goes wrong instead of swallowing silently.
        try {
          e.stopImmediatePropagation();
        } catch {
          // Safe to ignore: failure to stop immediate propagation only affects other listeners.
        }
        this.sendMessage();
      }
    });

    // Track selection while typing/navigating so we can restore caret position
    const captureSelection = () => {
      this.lastSelection = {
        start: this.messageInput.selectionStart ?? this.messageInput.value.length,
        end: this.messageInput.selectionEnd ?? this.messageInput.value.length,
        direction: this.messageInput.selectionDirection ?? undefined,
      };
    };
    this.messageInput.addEventListener('keyup', captureSelection);
    this.messageInput.addEventListener('mouseup', captureSelection);
    this.messageInput.addEventListener('select', captureSelection);
    this.messageInput.addEventListener('input', captureSelection);

    // NOTE: Paste behavior
    // We intentionally DO NOT override the default browser paste behavior.
    // The browser natively places the caret at the END OF THE PASTED FRAGMENT,
    // which is the correct UX for inserting text in the middle of existing content.
    // Previously there was code here that moved the caret to the end of the ENTIRE
    // textarea content after paste, which broke middle-insertion workflows.
    // See docs/focus-behavior.md for details.

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

    // Use active view if available (processing only; rendering is driven by SSE events)
    if (activeView) {
      activeView.getStreamingState().setProcessing(true, this.currentDialogId || undefined);
    } else {
      // Fallback to legacy (processing only; message rendering comes via SSE)
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
      case WEBVIEW_OUT_MSG.SERVER_STATUS:
        this.handleServerStatus(message.status, message.message);
        break;

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

      case WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE:
        // Forward to SessionActionsUI for buttons and changes panel
        this.sessionActionsUI.updateSessionStatus(message.hasUnapproved, message.changedFiles);
        break;

      case WEBVIEW_OUT_MSG.WORKLOADS_UPDATE:
        this.updateWorkloads(message.workloads, message.selected);
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

  private handleServerStatus(status: 'launching' | 'ready' | 'error' | 'no-workspace', message?: string): void {
    const container = document.querySelector('.chat-container') as HTMLElement;

    // Always remove existing overlay first to prevent leaks and ensure clean state
    if (this.serverStatusOverlay) {
      this.serverStatusOverlay.remove();
      this.serverStatusOverlay = null;
    }

    // Disable/enable input based on server status
    const isReady = status === 'ready';
    this.messageInput.disabled = !isReady;
    this.sendButton.disabled = !isReady;

    // Only create overlay for launching, error, and no-workspace states
    if (status === 'launching' || status === 'error' || status === 'no-workspace') {
      const overlay = document.createElement('div');
      overlay.id = 'serverStatusOverlay';
      overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--vscode-editor-background);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        z-index: 9999;
      `;

      if (status === 'launching') {
        const safeMessage = escapeHtml(message || 'Launching server...');
        overlay.innerHTML = `
          <div class="codicon codicon-loading codicon-modifier-spin server-status-icon"></div>
          <div class="server-status-message launching">${safeMessage}</div>
        `;
      } else if (status === 'no-workspace') {
        const safeMessage = escapeHtml(message || 'Open a folder or workspace to get started');
        overlay.innerHTML = `
          <div class="codicon codicon-folder-opened server-status-icon"></div>
          <div class="server-status-message no-workspace">${safeMessage}</div>
        `;
      } else {
        // error
        const safeMessage = escapeHtml(message || 'Failed to start server');
        overlay.innerHTML = `
          <div class="codicon codicon-error server-status-icon"></div>
          <div class="server-status-message error">${safeMessage}</div>
          <div class="server-status-actions">
            <button class="server-status-btn primary" data-action="open-settings">Open Settings</button>
          </div>
        `;
      }

      container?.appendChild(overlay);
      this.serverStatusOverlay = overlay;

      if (status === 'error') {
        const settingsBtn = overlay.querySelector('[data-action="open-settings"]');
        settingsBtn?.addEventListener('click', () => {
          this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_SETTINGS});
        });
      }
    }
    // For 'ready' status, overlay is already removed above
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

    // Focus rules on dialog switch:
    // - If user explicitly initiated "New dialog" via the button, focus the input once.
    // - If dialogId is null (no dialogs exist), also focus input.
    // - Otherwise do not steal focus on mere switching.
    const shouldFocusNow = this.pendingFocusAfterCreate || !dialogId;
    if (shouldFocusNow) {
      this.pendingFocusAfterCreate = false;
      requestAnimationFrame(() => {
        if (!document.body.contains(this.messageInput) || this.messageInput.disabled) return;
        this.messageInput.focus();
        try {
          const pos = this.messageInput.value.length;
          this.messageInput.setSelectionRange(pos, pos);
        } catch {}
      });
    }
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
          direction: this.messageInput.selectionDirection ?? undefined,
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
          direction: this.messageInput.selectionDirection,
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
          const direction = this.lastSelection?.direction;
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
}

// Initialize when DOM is ready
declare global {
  interface Window {
    WORKSPACE_ROOT?: string;
    __AGENTSMITHY_TEST__?: boolean;
  }
}

const globalWindow = window as Window & {__AGENTSMITHY_TEST__?: boolean};
if (!globalWindow.__AGENTSMITHY_TEST__) {
  const workspaceRoot = globalWindow.WORKSPACE_ROOT || '';
  new ChatWebview(workspaceRoot);
}
