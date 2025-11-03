import {MessageRenderer} from './renderer';
import {ScrollManager} from './scroll/ScrollManager';
import {StreamingStateManager} from './StreamingStateManager';
import {VSCodeAPI} from './types';

/**
 * Represents a view for a single dialog.
 * Each dialog has its own DOM container and state managers.
 */
export class DialogView {
  public readonly dialogId: string;
  public readonly container: HTMLElement;

  private renderer: MessageRenderer;
  private scrollManager: ScrollManager;
  private streamingState: StreamingStateManager;
  private isActive: boolean = false;

  constructor(dialogId: string, workspaceRoot: string, vscode: VSCodeAPI, parentContainer: HTMLElement) {
    this.dialogId = dialogId;

    // Create dedicated DOM container for this dialog
    this.container = document.createElement('div');
    this.container.className = 'dialog-view-container';
    this.container.dataset.dialogId = dialogId;
    this.container.style.display = 'none'; // Hidden by default

    // Create messages container inside dialog container
    const messagesContainer = document.createElement('div');
    messagesContainer.className = 'messages';
    messagesContainer.id = `messages-${dialogId}`;
    this.container.appendChild(messagesContainer);

    // Add welcome placeholder
    const welcomePlaceholder = document.createElement('div');
    welcomePlaceholder.className = 'welcome-placeholder';
    welcomePlaceholder.textContent = 'Type a message to start...';
    messagesContainer.appendChild(welcomePlaceholder);

    // Append to parent
    parentContainer.appendChild(this.container);

    // Initialize managers for this dialog
    this.renderer = new MessageRenderer(messagesContainer, welcomePlaceholder, workspaceRoot);
    this.streamingState = new StreamingStateManager();
    this.scrollManager = new ScrollManager(messagesContainer, vscode, this.renderer);

    // Connect renderer to scroll manager
    this.renderer.setScrollManager(this.scrollManager);
  }

  /**
   * Show this dialog view
   */
  show(): void {
    this.isActive = true;
    this.container.style.display = 'block';
  }

  /**
   * Hide this dialog view
   */
  hide(): void {
    this.isActive = false;
    this.container.style.display = 'none';
  }

  /**
   * Check if this dialog is currently active (visible)
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Get the renderer for this dialog
   */
  getRenderer(): MessageRenderer {
    return this.renderer;
  }

  /**
   * Get the scroll manager for this dialog
   */
  getScrollManager(): ScrollManager {
    return this.scrollManager;
  }

  /**
   * Get the streaming state manager for this dialog
   */
  getStreamingState(): StreamingStateManager {
    return this.streamingState;
  }

  /**
   * Check if this dialog has an active stream
   */
  hasActiveStream(): boolean {
    return this.streamingState.isCurrentlyProcessing();
  }

  /**
   * Destroy this dialog view and clean up resources
   */
  destroy(): void {
    this.container.remove();
  }
}
