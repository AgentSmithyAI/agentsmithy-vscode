import {ReasoningBlock} from './types';

/**
 * Manages streaming state for assistant messages and reasoning blocks
 */
export class StreamingStateManager {
  private currentAssistantMessage: HTMLElement | null = null;
  private currentAssistantText = '';
  private currentReasoningBlock: ReasoningBlock | null = null;
  private currentReasoningText = '';
  private isProcessing = false;

  /**
   * Start a new assistant message stream
   */
  startAssistantMessage(messageElement: HTMLElement): void {
    this.currentAssistantMessage = messageElement;
    this.currentAssistantText = '';
    messageElement.classList.add('streaming');
  }

  /**
   * Append text to the current assistant message
   */
  appendToAssistant(content: string): void {
    if (!this.currentAssistantMessage) {
      return;
    }
    this.currentAssistantText += content;
    this.currentAssistantMessage.textContent = this.currentAssistantText;
  }

  /**
   * Finalize the current assistant message
   */
  endAssistantMessage(renderMarkdown: (text: string) => string): void {
    if (!this.currentAssistantMessage || !this.currentAssistantText) {
      return;
    }
    this.currentAssistantMessage.classList.remove('streaming');
    this.currentAssistantMessage.innerHTML = renderMarkdown(this.currentAssistantText);
    this.currentAssistantMessage = null;
    this.currentAssistantText = '';
  }

  /**
   * Get the current assistant message element
   */
  getCurrentAssistantMessage(): HTMLElement | null {
    return this.currentAssistantMessage;
  }

  /**
   * Get the current assistant text
   */
  getCurrentAssistantText(): string {
    return this.currentAssistantText;
  }

  /**
   * Start a new reasoning block stream
   */
  startReasoning(reasoningBlock: ReasoningBlock): void {
    this.currentReasoningBlock = reasoningBlock;
    this.currentReasoningText = '';
  }

  /**
   * Append text to the current reasoning block
   */
  appendToReasoning(content: string, renderMarkdown: (text: string) => string): void {
    if (!this.currentReasoningBlock?.content) {
      return;
    }
    this.currentReasoningText += content;
    this.currentReasoningBlock.content.innerHTML = renderMarkdown(this.currentReasoningText);
    if (this.currentReasoningBlock.content.style.display === 'none') {
      this.currentReasoningBlock.content.style.display = 'block';
    }
  }

  /**
   * Finalize the current reasoning block
   */
  endReasoning(): void {
    if (!this.currentReasoningBlock?.content || !this.currentReasoningBlock?.header) {
      return;
    }
    this.currentReasoningBlock.content.style.display = 'none';
    const toggle = this.currentReasoningBlock.header.querySelector('.reasoning-toggle');
    if (toggle) {
      toggle.textContent = '▶';
    }
    this.currentReasoningBlock = null;
    this.currentReasoningText = '';
  }

  /**
   * Get the current reasoning block
   */
  getCurrentReasoningBlock(): ReasoningBlock | null {
    return this.currentReasoningBlock;
  }

  /**
   * Reset all streaming state (useful when clearing or replacing history)
   */
  resetAll(): void {
    this.currentAssistantMessage = null;
    this.currentAssistantText = '';
    this.currentReasoningBlock = null;
    this.currentReasoningText = '';
  }

  /**
   * Set processing state
   */
  setProcessing(processing: boolean): void {
    this.isProcessing = processing;
  }

  /**
   * Get processing state
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }
}
