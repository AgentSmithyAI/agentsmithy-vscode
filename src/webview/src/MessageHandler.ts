import {WEBVIEW_OUT_MSG} from '../../shared/messages';
import {MessageRenderer} from './renderer';
import {ScrollManager} from './ScrollManager';
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
  ) {}

  /**
   * Main message dispatcher
   */
  handle(message: WebviewOutMessage): void {
    switch (message.type) {
      case WEBVIEW_OUT_MSG.ADD_MESSAGE:
        this.handleAddMessage(message.message.role, message.message.content);
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
        this.renderer.addFileEdit(message.file, message.diff);
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
    }
  }

  private handleAddMessage(role: 'user' | 'assistant', content: string): void {
    this.renderer.addMessage(role, content);
    // User message means new tail content → prune older
    this.renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
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
      this.streamingState.endAssistantMessage((text) => this.renderer.renderMarkdown(text));
      // Don't auto-scroll on end - only during append
      // This prevents unwanted scrolling if user has manually scrolled up
    }
    // Finalized assistant message → prune older
    this.renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
  }

  private handleEndStream(): void {
    this.streamingState.setProcessing(false);
    this.uiController.setProcessing(false);
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
