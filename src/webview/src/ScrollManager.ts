import {WEBVIEW_IN_MSG} from '../../shared/messages';
import {MessageRenderer} from './renderer';
import {MAX_MESSAGES_IN_DOM, VSCodeAPI} from './types';

/**
 * Manages scrolling behavior, infinite scroll, and DOM pruning
 */
export class ScrollManager {
  private lastScrollTop = 0;
  private topTriggerArmed = true;
  private isLoadingHistory = false;
  private canLoadMoreHistory = true;
  private cachedFirstVisibleIdx: number | undefined;
  // Track previous content height to detect growth between appends
  private prevScrollHeight: number;

  // Thresholds
  private readonly TOP_TRIGGER_THRESHOLD = 100; // px from top to trigger history load
  private readonly REARM_THRESHOLD = 300; // px user must move away from top to re-arm
  private readonly BOTTOM_PRUNE_THRESHOLD = 200; // px from bottom considered "near" for pruning only
  private readonly BOTTOM_AUTOSCROLL_THRESHOLD = 40; // tighter threshold for auto-scroll decisions

  // User intent lock: when user scrolls up, we suppress auto-scroll until they return to bottom
  private userScrollLocked = false;
  // Track whether the scroll is user-initiated (pointer/keyboard). We only lock on user intent.
  private userInteracting = false;
  private interactionResetTimer: number | undefined;

  /**
   * Call when content height decreases significantly (e.g., reasoning collapsed).
   * If user is near bottom, unlock and snap to bottom to prevent drift.
   */
  handleContentShrink(): void {
    if (this.isNearBottomForAutoScroll()) {
      this.userScrollLocked = false;
      this.scrollToBottom();
    }
  }

  constructor(
    private messagesContainer: HTMLElement,
    private vscode: VSCodeAPI,
    private renderer: MessageRenderer,
  ) {
    this.prevScrollHeight = this.messagesContainer.scrollHeight;
    this.setupScrollListener();
  }

  private setupScrollListener(): void {
    // Detect user interaction to disambiguate programmatic/layout-induced scrolls
    const setInteracting = () => {
      this.userInteracting = true;
      if (this.interactionResetTimer) {
        clearTimeout(this.interactionResetTimer);
      }
      // Reset shortly after interaction ends to avoid sticky state
      this.interactionResetTimer = window.setTimeout(() => {
        this.userInteracting = false;
      }, 250);
    };
    this.messagesContainer.addEventListener('wheel', setInteracting, {passive: true});
    this.messagesContainer.addEventListener('touchstart', setInteracting, {passive: true});
    this.messagesContainer.addEventListener('mousedown', setInteracting);
    window.addEventListener('keydown', (e) => {
      // Keys that typically scroll
      const keys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'];
      if (keys.includes(e.key)) setInteracting();
    });

    this.messagesContainer.addEventListener('scroll', () => {
      const scrollTop = this.messagesContainer.scrollTop;
      const isScrollingUp = scrollTop < this.lastScrollTop;

      // If content grew and user hasn't locked, snap to bottom to stay glued during streaming
      const grew = this.messagesContainer.scrollHeight > this.prevScrollHeight;
      this.prevScrollHeight = this.messagesContainer.scrollHeight;
      if (grew && !this.userScrollLocked && this.isNearBottomForAutoScroll()) {
        this.scrollToBottom();
      }

      // Arm the top trigger only after the user scrolls away sufficiently
      if (scrollTop > this.REARM_THRESHOLD) {
        this.topTriggerArmed = true;
      }

      // Trigger when within threshold from top, only if user is scrolling up and trigger is armed
      if (isScrollingUp && scrollTop <= this.TOP_TRIGGER_THRESHOLD && this.topTriggerArmed) {
        this.topTriggerArmed = false;
        this.tryLoadMoreHistory();
      }

      // Update user intent lock ONLY on real user-initiated scrolls
      if (this.userInteracting && isScrollingUp && !this.isNearBottomForAutoScroll()) {
        this.userScrollLocked = true;
      }
      // Unlock when user (or programmatic) returns near bottom
      if (this.isNearBottomForAutoScroll()) {
        this.userScrollLocked = false;
      }

      // Prune when user is near bottom to keep recent view light
      if (this.isNearBottomForPrune()) {
        this.pruneOldMessages();
      }

      this.lastScrollTop = scrollTop;
    });
  }

  private isNearBottomForPrune(): boolean {
    const {scrollHeight, scrollTop, clientHeight} = this.messagesContainer;
    return scrollHeight - scrollTop - clientHeight <= this.BOTTOM_PRUNE_THRESHOLD;
  }

  private isNearBottomForAutoScroll(): boolean {
    const {scrollHeight, scrollTop, clientHeight} = this.messagesContainer;
    return scrollHeight - scrollTop - clientHeight <= this.BOTTOM_AUTOSCROLL_THRESHOLD;
  }

  /**
   * Check if user is at the bottom of the chat (for auto-scroll purposes)
   */
  isAtBottom(): boolean {
    return this.isNearBottomForAutoScroll() && !this.userScrollLocked;
  }

  /**
   * Scroll element into view only if user is at the bottom and not locked
   *
   * Note: `_element` is intentionally unused. Historically this method accepted
   * an element to scroll into view, but current logic snaps the container to
   * bottom based on auto-scroll heuristics (growth/lock state) and does not
   * need the specific element. We keep the parameter for API compatibility with
   * existing callers/tests. Consider making it optional or removing in a major
   * revision.
   * @param _element Unused, kept for backward compatibility
   */
  scrollIntoViewIfAtBottom(_element: HTMLElement): void {
    const grew = this.messagesContainer.scrollHeight > this.prevScrollHeight;
    if (!this.userScrollLocked && (this.isAtBottom() || grew)) {
      this.scrollToBottom();
    }
    this.prevScrollHeight = this.messagesContainer.scrollHeight;
  }

  /**
   * Scroll to the absolute bottom of the container
   * Uses double rAF to ensure DOM updates are complete
   * Also clears user lock (explicit action should follow user's intent to see bottom)
   */
  scrollToBottom(): void {
    // Explicit action implies intent to see the bottom; clear lock and interaction
    this.userScrollLocked = false;
    this.userInteracting = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      });
    });
  }

  private pruneOldMessages(): void {
    // Cache first loaded idx (first in DOM) so provider can keep cursor forward-only
    this.cachedFirstVisibleIdx = this.getFirstLoadedIdx();
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX,
      idx: this.cachedFirstVisibleIdx,
    });
    this.renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);
  }

  private tryLoadMoreHistory(): void {
    if (this.isLoadingHistory || !this.canLoadMoreHistory) {
      return;
    }
    this.isLoadingHistory = true;
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.LOAD_MORE_HISTORY});
  }

  /**
   * Get the first indexed message in DOM (not necessarily visible on screen)
   * This represents the oldest loaded message, used for pagination cursor tracking
   */
  private getFirstLoadedIdx(): number | undefined {
    for (const child of Array.from(this.messagesContainer.children)) {
      if (child instanceof HTMLElement && child.dataset?.idx) {
        const value = Number(child.dataset.idx);
        if (!Number.isNaN(value)) {
          return value;
        }
      }
    }
    return undefined;
  }

  /**
   * Get the cached first visible index
   */
  getCachedFirstVisibleIdx(): number | undefined {
    return this.cachedFirstVisibleIdx;
  }

  /**
   * Notify scroll manager that history loading has finished
   */
  finishHistoryLoad(): void {
    this.isLoadingHistory = false;
    // Do not immediately trigger another load due to being near the top after reflow
    // Require the user to scroll away (>300) before re-arming
    this.topTriggerArmed = false;
  }

  /**
   * Set whether more history can be loaded
   */
  setCanLoadMore(canLoad: boolean): void {
    this.canLoadMoreHistory = canLoad;
    if (!this.canLoadMoreHistory) {
      this.isLoadingHistory = false;
    }
    // Re-arm top trigger when external state toggles loading capability back on
    if (this.canLoadMoreHistory && this.messagesContainer.scrollTop > this.REARM_THRESHOLD) {
      this.topTriggerArmed = true;
    }
  }

  /**
   * Manually request the first loaded index (first in DOM)
   */
  requestFirstVisibleIdx(): void {
    const idx = this.getFirstLoadedIdx();
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX,
      idx,
    });
  }
}
