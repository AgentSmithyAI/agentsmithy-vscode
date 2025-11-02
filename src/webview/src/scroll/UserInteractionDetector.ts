/**
 * Detects user-initiated interactions (wheel, touch, keyboard) vs programmatic scrolls
 */
export class UserInteractionDetector {
  private userInteracting = false;
  private interactionResetTimer: number | undefined;
  private readonly INTERACTION_RESET_TIMEOUT_MS = 250; // debounce for user interaction end

  constructor(
    private container: HTMLElement,
    window: Window,
  ) {
    this.setupListeners(container, window);
  }

  private setupListeners(container: HTMLElement, window: Window): void {
    const setInteracting = () => {
      this.userInteracting = true;
      if (this.interactionResetTimer) {
        clearTimeout(this.interactionResetTimer);
      }
      // Reset shortly after interaction ends to avoid sticky state
      this.interactionResetTimer = window.setTimeout(() => {
        this.userInteracting = false;
      }, this.INTERACTION_RESET_TIMEOUT_MS);
    };

    container.addEventListener('wheel', setInteracting, {passive: true});
    container.addEventListener('touchstart', setInteracting, {passive: true});
    container.addEventListener('mousedown', setInteracting);

    window.addEventListener('keydown', (e) => {
      // Keys that typically scroll
      const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'];
      if (scrollKeys.includes(e.key)) {
        setInteracting();
      }
    });
  }

  /**
   * Returns true if user is currently interacting with the scroll container
   */
  isUserInteracting(): boolean {
    return this.userInteracting;
  }

  /**
   * Reset interaction state (e.g., on explicit scrollToBottom)
   */
  reset(): void {
    this.userInteracting = false;
    if (this.interactionResetTimer) {
      clearTimeout(this.interactionResetTimer);
      this.interactionResetTimer = undefined;
    }
  }
}
