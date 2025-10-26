import {WEBVIEW_OUT_MSG} from '../../shared/messages';
import {DialogViewManager} from './DialogViewManager';
import {MessageRenderer} from './renderer';
import {ScrollManager} from './ScrollManager';
import {SessionActionsUI} from './SessionActionsUI';
import {StreamingStateManager} from './StreamingStateManager';
import {HistoryEvent, MAX_MESSAGES_IN_DOM, WebviewOutMessage} from './types';
import {UIController} from './UIController';

/**
 * Handles incoming messages from the extension
 */

export class MessageHandler {
  constructor(
    private renderer: MessageRenderer,
    private streamingState: StreamingStateManager,
    private scrollManager: ScrollManager,
    private uiController: UIController,
    private messagesContainer: HTMLElement,
    private dialogViewManager?: DialogViewManager,
    private sessionActionsUI?: SessionActionsUI,
  ) {}

  /**
   * Main message dispatcher
   */
  handle(message: WebviewOutMessage): void {
    // Route to the correct dialog view if dialogViewManager is available
    if (this.dialogViewManager && 'dialogId' in message && message.dialogId) {
      this.handleForDialog(message.dialogId, message);
      return;
    }

    // Fallback to legacy handling (for backward compatibility or active dialog)
    switch (message.type) {
      case WEBVIEW_OUT_MSG.ADD_MESSAGE:
        this.handleAddMessage(message.message.role, message.message.content, message.checkpoint);
        break;

      case WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE:
        this.handleStartAssistantMessage();
        break;

      case WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT:
        this.handleAppendToAssistant(message.content);
        break;

      case WEBVIEW_OUT_MSG.END_ASSISTANT_MESSAGE:
        this.handleEndAssistantMessage();
        break;

      case WEBVIEW_OUT_MSG.SHOW_TOOL_CALL:
        this.renderer.addToolCall(message.tool, message.args);
        break;

      case WEBVIEW_OUT_MSG.SHOW_FILE_EDIT:
        this.renderer.addFileEdit(message.file, message.diff, message.checkpoint);
        break;

      case WEBVIEW_OUT_MSG.SHOW_ERROR:
        this.renderer.showError(message.error);
        break;

      case WEBVIEW_OUT_MSG.SHOW_INFO:
        this.renderer.showInfo(message.message);
        break;

      case WEBVIEW_OUT_MSG.END_STREAM:
        this.handleEndStream();
        break;

      case WEBVIEW_OUT_MSG.START_REASONING:
        this.handleStartReasoning();
        break;

      case WEBVIEW_OUT_MSG.APPEND_TO_REASONING:
        this.handleAppendToReasoning(message.content);
        break;

      case WEBVIEW_OUT_MSG.END_REASONING:
        this.handleEndReasoning();
        break;

      case WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_VISIBLE:
        // We use infinite scroll, keep button hidden regardless
        break;

      case WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED:
        this.scrollManager.setCanLoadMore(message.enabled !== false);
        break;

      case WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS:
        this.handleHistoryPrepend(message.events);
        break;

      case WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM:
        this.handleScrollToBottom();
        break;

      case WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL:
        this.handleHistoryReplaceAll(message.events);
        break;

      case WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE:
        if (this.sessionActionsUI) {
          this.sessionActionsUI.updateSessionStatus(message.hasUnapproved);
        }
        break;

      case WEBVIEW_OUT_MSG.DIALOG_SWITCHED:
        if (this.sessionActionsUI) {
          this.sessionActionsUI.setCurrentDialogId(message.dialogId);
        }
        break;
    }
  }

  /**
   * Handle a message for a specific dialog
   */
  private handleForDialog(dialogId: string, message: WebviewOutMessage): void {
    if (!this.dialogViewManager) {
      return;
    }

    // Get or create the dialog view
    const view = this.dialogViewManager.getOrCreateView(dialogId);
    const renderer = view.getRenderer();
    const streamingState = view.getStreamingState();
    const scrollManager = view.getScrollManager();
    const isActive = view.getIsActive();

    // Process the message for this specific dialog
    switch (message.type) {
      case WEBVIEW_OUT_MSG.ADD_MESSAGE:
        renderer.addMessage(message.message.role, message.message.content, message.checkpoint);
        renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
        // Always scroll to bottom when user sends a message
        if (message.message.role === 'user' && isActive) {
          renderer.scrollToBottom();
        }
        break;

      case WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE: {
        const messageElement = renderer.addMessage('assistant', '');
        if (messageElement) {
          streamingState.startAssistantMessage(messageElement);
          streamingState.setProcessing(true, dialogId);
        }
        // Update UI controller only if this is the active dialog
        if (isActive) {
          this.uiController.setProcessing(true);
        }
        break;
      }

      case WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT: {
        let messageElement = streamingState.getCurrentAssistantMessage();
        if (!messageElement) {
          messageElement = renderer.addMessage('assistant', '');
          if (messageElement) {
            streamingState.startAssistantMessage(messageElement);
          }
        }
        if (message.content && messageElement) {
          streamingState.appendToAssistant(message.content);
          // Only scroll if this is the active dialog
          if (isActive) {
            scrollManager.scrollIntoViewIfAtBottom(messageElement);
          }
        }
        break;
      }

      case WEBVIEW_OUT_MSG.END_ASSISTANT_MESSAGE: {
        const messageElement = streamingState.getCurrentAssistantMessage();
        if (messageElement && streamingState.getCurrentAssistantText()) {
          const wasAtBottom = scrollManager.isAtBottom();
          streamingState.endAssistantMessage((text) => renderer.renderMarkdown(text));
          // After markdown rendering, content size may change - ensure we stay scrolled to bottom
          if (wasAtBottom && isActive) {
            scrollManager.scrollToBottom();
          }
        }
        renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
        break;
      }

      case WEBVIEW_OUT_MSG.SHOW_TOOL_CALL:
        renderer.addToolCall(message.tool, message.args);
        break;

      case WEBVIEW_OUT_MSG.SHOW_FILE_EDIT:
        renderer.addFileEdit(message.file, message.diff);
        break;

      case WEBVIEW_OUT_MSG.SHOW_ERROR:
        renderer.showError(message.error);
        break;

      case WEBVIEW_OUT_MSG.SHOW_INFO:
        renderer.showInfo(message.message);
        break;

      case WEBVIEW_OUT_MSG.END_STREAM:
        streamingState.setProcessing(false);
        // Update UI controller only if this is the active dialog
        if (isActive) {
          this.uiController.setProcessing(false);
          // Final scroll to bottom after stream ends to ensure user sees the complete response
          if (scrollManager.isAtBottom()) {
            scrollManager.scrollToBottom();
          }
        }
        break;

      case WEBVIEW_OUT_MSG.START_REASONING: {
        const reasoningBlock = renderer.createReasoningBlock();
        streamingState.startReasoning(reasoningBlock);
        break;
      }

      case WEBVIEW_OUT_MSG.APPEND_TO_REASONING: {
        let reasoningBlock = streamingState.getCurrentReasoningBlock();
        if (!reasoningBlock) {
          reasoningBlock = renderer.createReasoningBlock();
          streamingState.startReasoning(reasoningBlock);
        }
        if (reasoningBlock?.content && message.content) {
          streamingState.appendToReasoning(message.content, (text) => renderer.renderMarkdown(text));
          // Only scroll if this is the active dialog
          if (isActive) {
            scrollManager.scrollIntoViewIfAtBottom(reasoningBlock.block);
          }
        }
        break;
      }

      case WEBVIEW_OUT_MSG.END_REASONING:
        streamingState.endReasoning();
        break;

      case WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL: {
        const histMessage = message as WebviewOutMessage & {events: HistoryEvent[]};
        streamingState.resetAll();
        renderer.clearMessages();

        if (Array.isArray(histMessage.events)) {
          renderer.setPrepending(false);
          renderer.setSuppressAutoScroll(true);

          try {
            for (const evt of histMessage.events) {
              try {
                renderer.renderHistoryEvent(evt);
              } catch {
                // Suppress render errors
              }
            }
          } finally {
            renderer.setSuppressAutoScroll(false);
          }
        }
        break;
      }

      case WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS: {
        const histMessage = message as WebviewOutMessage & {events: HistoryEvent[]};
        if (!Array.isArray(histMessage.events)) {
          break;
        }

        const messagesContainer = view.container.querySelector('.messages') as HTMLElement;
        if (!messagesContainer) {
          break;
        }

        streamingState.resetAll();

        const prevTop = messagesContainer.scrollTop;
        const prevHeight = messagesContainer.scrollHeight;

        renderer.setPrepending(true);
        renderer.setSuppressAutoScroll(true);

        try {
          for (let i = histMessage.events.length - 1; i >= 0; i--) {
            const evt = histMessage.events[i];
            try {
              renderer.renderHistoryEvent(evt);
            } catch {
              // Suppress render errors
            }
          }
        } finally {
          renderer.setPrepending(false);
          renderer.setSuppressAutoScroll(false);
        }

        const newHeight = messagesContainer.scrollHeight;
        messagesContainer.scrollTop = prevTop + (newHeight - prevHeight);

        scrollManager.finishHistoryLoad();
        break;
      }

      case WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM:
        renderer.scrollToBottom();
        break;

      case WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED: {
        const enabledMessage = message as WebviewOutMessage & {enabled: boolean};
        scrollManager.setCanLoadMore(enabledMessage.enabled !== false);
        break;
      }
    }
  }

  private handleAddMessage(role: 'user' | 'assistant', content: string, checkpoint?: string): void {
    this.renderer.addMessage(role, content, checkpoint);
    // User message means new tail content → prune older
    this.renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
    // Always scroll to bottom when user sends a message
    if (role === 'user') {
      this.renderer.scrollToBottom();
    }
  }

  private handleStartAssistantMessage(): void {
    const messageElement = this.renderer.addMessage('assistant', '');
    if (messageElement) {
      this.streamingState.startAssistantMessage(messageElement);
    }
  }

  private handleAppendToAssistant(content: string): void {
    let messageElement = this.streamingState.getCurrentAssistantMessage();
    if (!messageElement) {
      messageElement = this.renderer.addMessage('assistant', '');
      if (messageElement) {
        this.streamingState.startAssistantMessage(messageElement);
      }
    }
    if (content && messageElement) {
      this.streamingState.appendToAssistant(content);
      this.scrollManager.scrollIntoViewIfAtBottom(messageElement);
    }
  }

  private handleEndAssistantMessage(): void {
    const messageElement = this.streamingState.getCurrentAssistantMessage();
    if (messageElement && this.streamingState.getCurrentAssistantText()) {
      const wasAtBottom = this.scrollManager.isAtBottom();
      this.streamingState.endAssistantMessage((text) => this.renderer.renderMarkdown(text));
      // After markdown rendering, content size may change - ensure we stay scrolled to bottom
      if (wasAtBottom) {
        this.scrollManager.scrollToBottom();
      }
    }
    // Finalized assistant message → prune older
    this.renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
  }

  private handleEndStream(): void {
    this.streamingState.setProcessing(false);
    this.uiController.setProcessing(false);
    // Final scroll to bottom after stream ends to ensure user sees the complete response
    if (this.scrollManager.isAtBottom()) {
      this.scrollManager.scrollToBottom();
    }
  }

  private handleStartReasoning(): void {
    const reasoningBlock = this.renderer.createReasoningBlock();
    this.streamingState.startReasoning(reasoningBlock);
  }

  private handleAppendToReasoning(content: string): void {
    let reasoningBlock = this.streamingState.getCurrentReasoningBlock();
    if (!reasoningBlock) {
      reasoningBlock = this.renderer.createReasoningBlock();
      this.streamingState.startReasoning(reasoningBlock);
    }
    if (reasoningBlock?.content && content) {
      this.streamingState.appendToReasoning(content, (text) => this.renderer.renderMarkdown(text));
      this.scrollManager.scrollIntoViewIfAtBottom(reasoningBlock.block);
    }
  }

  private handleEndReasoning(): void {
    this.streamingState.endReasoning();
  }

  private handleHistoryPrepend(events: HistoryEvent[]): void {
    if (!Array.isArray(events)) {
      return;
    }

    this.streamingState.resetAll();

    const prevTop = this.messagesContainer.scrollTop;
    const prevHeight = this.messagesContainer.scrollHeight;

    this.renderer.setPrepending(true);
    this.renderer.setSuppressAutoScroll(true);

    try {
      // Prepend must iterate in reverse so DOM order remains ascending by idx at the top
      for (let i = events.length - 1; i >= 0; i--) {
        const evt = events[i];
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

    this.scrollManager.finishHistoryLoad();
  }

  private handleScrollToBottom(): void {
    this.renderer.scrollToBottom();
    // Prune when we explicitly move to bottom
    this.renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
  }

  private handleHistoryReplaceAll(events: HistoryEvent[]): void {
    this.streamingState.resetAll();
    this.renderer.clearMessages();

    if (Array.isArray(events)) {
      this.renderer.setPrepending(false);
      this.renderer.setSuppressAutoScroll(true);

      try {
        for (const evt of events) {
          try {
            this.renderer.renderHistoryEvent(evt);
          } catch {
            // Suppress render errors
          }
        }
      } finally {
        this.renderer.setSuppressAutoScroll(false);
      }
    }
  }
}
