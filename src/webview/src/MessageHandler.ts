import {MessageRenderer} from './renderer';
import {ScrollManager} from './ScrollManager';
import {StreamingStateManager} from './StreamingStateManager';
import {HistoryEvent, WebviewOutMessage} from './types';
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
      case 'addMessage':
        this.handleAddMessage(message.message.role, message.message.content);
        break;

      case 'startAssistantMessage':
        this.handleStartAssistantMessage();
        break;

      case 'appendToAssistant':
        this.handleAppendToAssistant(message.content);
        break;

      case 'endAssistantMessage':
        this.handleEndAssistantMessage();
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
        this.handleEndStream();
        break;

      case 'startReasoning':
        this.handleStartReasoning();
        break;

      case 'appendToReasoning':
        this.handleAppendToReasoning(message.content);
        break;

      case 'endReasoning':
        this.handleEndReasoning();
        break;

      case 'historySetLoadMoreVisible':
        // We use infinite scroll, keep button hidden regardless
        break;

      case 'historySetLoadMoreEnabled':
        this.scrollManager.setCanLoadMore(message.enabled !== false);
        break;

      case 'historyPrependEvents':
        this.handleHistoryPrepend(message.events);
        break;

      case 'scrollToBottom':
        this.handleScrollToBottom();
        break;

      case 'historyReplaceAll':
        this.handleHistoryReplaceAll(message.events);
        break;
    }
  }

  private handleAddMessage(role: 'user' | 'assistant', content: string): void {
    this.renderer.addMessage(role, content);
    // User message means new tail content → prune older
    this.renderer.pruneByIdx(20);
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
      messageElement.scrollIntoView({behavior: 'smooth', block: 'end'});
    }
  }

  private handleEndAssistantMessage(): void {
    const messageElement = this.streamingState.getCurrentAssistantMessage();
    if (messageElement && this.streamingState.getCurrentAssistantText()) {
      this.streamingState.endAssistantMessage((text) => this.renderer.renderMarkdown(text));
      messageElement.scrollIntoView({behavior: 'smooth', block: 'end'});
    }
    // Finalized assistant message → prune older
    this.renderer.pruneByIdx(20);
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
      reasoningBlock.block.scrollIntoView({behavior: 'smooth', block: 'end'});
    }
  }

  private handleEndReasoning(): void {
    this.streamingState.endReasoning();
  }

  private handleHistoryPrepend(events: unknown[]): void {
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
          this.renderer.renderHistoryEvent(evt as HistoryEvent);
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
    this.renderer.pruneByIdx(20);
  }

  private handleHistoryReplaceAll(events: unknown[]): void {
    this.streamingState.resetAll();
    this.renderer.clearMessages();

    if (Array.isArray(events)) {
      this.renderer.setPrepending(false);
      this.renderer.setSuppressAutoScroll(true);

      try {
        for (const evt of events) {
          try {
            this.renderer.renderHistoryEvent(evt as HistoryEvent);
          } catch {
            // Suppress render errors
          }
        }
      } finally {
        this.renderer.setSuppressAutoScroll(false);
      }

      this.renderer.scrollToBottom();
    }
  }
}
