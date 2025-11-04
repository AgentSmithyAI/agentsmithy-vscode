import {UserInteractionDetector} from './UserInteractionDetector';

/**
 * Controls auto-scroll behavior: when to snap to bottom, and when to lock
 * auto-scroll based on user intent
 */
export class AutoScrollController {
  private userScrollLocked = false;
  private prevScrollHeight: number;
  private readonly BOTTOM_AUTOSCROLL_THRESHOLD = 40; // px from bottom for auto-scroll decisions

  constructor(
    private container: HTMLElement,
    private userInteractionDetector: UserInteractionDetector,
  ) {
    this.prevScrollHeight = container.scrollHeight;
  }

  /**
   * Check if user is near the bottom (for auto-scroll purposes)
   */
  private isNearBottom(): boolean {
    const {scrollHeight, scrollTop, clientHeight} = this.container;
    return scrollHeight - scrollTop - clientHeight <= this.BOTTOM_AUTOSCROLL_THRESHOLD;
  }

  /**
   * Check if user is at the bottom (near bottom AND not locked by user scroll)
   */
  isAtBottom(): boolean {
    return this.isNearBottom() && !this.userScrollLocked;
  }

  /**
   * Update lock state based on scroll direction and user interaction
   */
  updateLockState(scrollTop: number, lastScrollTop: number): void {
    const isScrollingUp = scrollTop < lastScrollTop;
    const userInteracting = this.userInteractionDetector.isUserInteracting();

    // Lock auto-scroll ONLY on real user-initiated scrolls upward when not near bottom
    if (userInteracting && isScrollingUp && !this.isNearBottom()) {
      this.userScrollLocked = true;
    }

    // Unlock when user (or programmatic scroll) returns near bottom
    if (this.isNearBottom()) {
      this.userScrollLocked = false;
    }
  }

  /**
   * Check if content grew and snap to bottom if needed
   * Returns true if scroll was adjusted
   */
  handleContentGrowth(): boolean {
    const grew = this.container.scrollHeight > this.prevScrollHeight;
    this.prevScrollHeight = this.container.scrollHeight;

    if (grew && !this.userScrollLocked && this.isNearBottom()) {
      this.scrollToBottom();
      return true;
    }
    return false;
  }

  /**
   * Handle content shrink (e.g., reasoning collapsed)
   * If user is near bottom, unlock and snap to prevent drift
   */
  handleContentShrink(): void {
    if (this.isNearBottom()) {
      this.userScrollLocked = false;
      this.scrollToBottom();
    }
  }

  /**
   * Scroll to the absolute bottom of the container
   * Uses double rAF to ensure DOM updates are complete
   * Clears user lock (explicit action implies intent to see bottom)
   */
  scrollToBottom(): void {
    this.userScrollLocked = false;
    this.userInteractionDetector.reset();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.container.scrollTop = this.container.scrollHeight;
      });
    });
  }

  /**
   * Scroll into view only if at bottom and not locked
   */
  scrollIntoViewIfAtBottom(): void {
    const grew = this.container.scrollHeight > this.prevScrollHeight;
    if (!this.userScrollLocked && (this.isAtBottom() || grew)) {
      this.scrollToBottom();
    }
    this.prevScrollHeight = this.container.scrollHeight;
  }
}
