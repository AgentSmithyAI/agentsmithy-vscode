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

  private readonly TOP_TRIGGER_THRESHOLD = 100;
  private readonly REARM_THRESHOLD = 300;
  private readonly BOTTOM_THRESHOLD = 200;

  constructor(
    private messagesContainer: HTMLElement,
    private vscode: VSCodeAPI,
    private renderer: MessageRenderer,
  ) {
    this.setupScrollListener();
  }

  private setupScrollListener(): void {
    this.messagesContainer.addEventListener('scroll', () => {
      const scrollTop = this.messagesContainer.scrollTop;
      const isScrollingUp = scrollTop < this.lastScrollTop;

      // Arm the top trigger only after the user scrolls away sufficiently
      if (scrollTop > this.REARM_THRESHOLD) {
        this.topTriggerArmed = true;
      }

      // Trigger when within threshold from top, only if user is scrolling up and trigger is armed
      if (isScrollingUp && scrollTop <= this.TOP_TRIGGER_THRESHOLD && this.topTriggerArmed) {
        this.topTriggerArmed = false;
        this.tryLoadMoreHistory();
      }

      // Prune when user is near bottom to keep recent view light
      if (this.isNearBottom()) {
        this.pruneOldMessages();
      }

      this.lastScrollTop = scrollTop;
    });
  }

  private isNearBottom(): boolean {
    const {scrollHeight, scrollTop, clientHeight} = this.messagesContainer;
    return scrollHeight - scrollTop - clientHeight < this.BOTTOM_THRESHOLD;
  }

  /**
   * Check if user is at the bottom of the chat (for auto-scroll purposes)
   */
  isAtBottom(): boolean {
    return this.isNearBottom();
  }

  /**
   * Scroll element into view only if user is at the bottom
   */
  scrollIntoViewIfAtBottom(element: HTMLElement): void {
    if (this.isAtBottom()) {
      this.scrollToBottom();
    }
  }

  /**
   * Scroll to the absolute bottom of the container
   * Uses double rAF to ensure DOM updates are complete
   */
  scrollToBottom(): void {
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
