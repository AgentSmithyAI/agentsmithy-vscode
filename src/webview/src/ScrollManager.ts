import {WEBVIEW_IN_MSG} from '../../shared/messages';
import {MessageRenderer} from './renderer';
import {VSCodeAPI} from './types';

/**
 * Manages scrolling behavior, infinite scroll, and DOM pruning
 */
export class ScrollManager {
  private lastScrollTop = 0;
  private topTriggerArmed = true;
  private isLoadingHistory = false;
  private canLoadMoreHistory = true;
  private cachedFirstVisibleIdx: number | undefined;

  private readonly PRUNE_MAX_IDX = 20;
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

  private pruneOldMessages(): void {
    // Cache current first visible idx so provider can keep cursor forward-only
    this.cachedFirstVisibleIdx = this.getFirstVisibleIdx();
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX,
      idx: this.cachedFirstVisibleIdx,
    });
    this.renderer.pruneByIdx(this.PRUNE_MAX_IDX);
  }

  private tryLoadMoreHistory(): void {
    if (this.isLoadingHistory || !this.canLoadMoreHistory) {
      return;
    }
    this.isLoadingHistory = true;
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.LOAD_MORE_HISTORY});
  }

  private getFirstVisibleIdx(): number | undefined {
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
   * Manually request the first visible index
   */
  requestFirstVisibleIdx(): void {
    const idx = this.getFirstVisibleIdx();
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX,
      idx,
    });
  }
}
