/**
 * Controls UI elements like buttons, inputs, and their states
 */
export class UIController {
  constructor(
    private messageInput: HTMLTextAreaElement,
    private sendButton: HTMLButtonElement,
  ) {
    this.setupInputAutoResize();
    // Ensure input is enabled by default
    this.messageInput.readOnly = false;
    this.messageInput.disabled = false;
  }

  private setupInputAutoResize(): void {
    this.messageInput.addEventListener('input', () => {
      // Resize to fit content up to CSS max-height
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = this.messageInput.scrollHeight + 'px';

      // NOTE: We intentionally DO NOT force scroll to bottom here.
      // The browser automatically scrolls the textarea to keep the caret visible.
      // Forcing scrollTop = scrollHeight would break middle-insertion UX by
      // jumping the viewport away from where the user is typing/pasting.
    });
  }

  /**
   * Get the current message input value and clear it
   */
  getAndClearInput(): string {
    const text = this.messageInput.value.trim();
    if (text) {
      this.messageInput.value = '';
      this.messageInput.style.height = 'auto';
    }
    return text;
  }

  /**
   * Update the UI to reflect processing state
   */
  setProcessing(processing: boolean): void {
    // Keep input editable to preserve caret visibility and focus.
    // We avoid readOnly/disabled because some browsers hide the caret on readOnly textarea.
    this.messageInput.readOnly = false;
    this.messageInput.disabled = false;

    // Reflect busy state for accessibility/automation without changing editability
    if (processing) {
      this.messageInput.setAttribute('aria-busy', 'true');
      this.sendButton.innerHTML =
        '<svg class="stop-icon" viewBox="0 0 32 32" aria-hidden="true">' +
        '<rect x="10" y="10" width="12" height="12" fill="currentColor" rx="2"/>' +
        '<circle cx="16" cy="16" r="15" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="47.1 47.1" class="spinner-ring" opacity="0.4"/>' +
        '</svg>';
      this.sendButton.classList.add('processing');
      this.sendButton.title = 'Stop';
      this.sendButton.setAttribute('aria-label', 'Stop');
    } else {
      this.messageInput.removeAttribute('aria-busy');
      this.sendButton.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>' + '</svg>';
      this.sendButton.classList.remove('processing');
      this.sendButton.title = 'Send (Enter)';
      this.sendButton.setAttribute('aria-label', 'Send');
    }
  }
}
