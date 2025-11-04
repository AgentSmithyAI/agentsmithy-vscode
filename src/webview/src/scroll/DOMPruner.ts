import {WEBVIEW_IN_MSG} from '../../../shared/messages';
import {VSCodeAPI} from '../types';

export interface MessageRenderer {
  pruneByIdx(maxCount: number): void;
}

/**
 * Manages DOM pruning: removes old messages to keep memory usage bounded
 */
export class DOMPruner {
  private cachedFirstVisibleIdx: number | undefined;
  private readonly BOTTOM_PRUNE_THRESHOLD = 200; // px from bottom considered "near" for pruning only

  constructor(
    private container: HTMLElement,
    private vscode: VSCodeAPI,
    private renderer: MessageRenderer,
  ) {}

  /**
   * Check if user is near bottom (for pruning trigger)
   */
  private isNearBottomForPrune(): boolean {
    const {scrollHeight, scrollTop, clientHeight} = this.container;
    return scrollHeight - scrollTop - clientHeight <= this.BOTTOM_PRUNE_THRESHOLD;
  }

  /**
   * Check if pruning should trigger based on scroll position
   * Returns true if pruning was performed
   */
  checkAndPrune(maxMessagesInDOM: number): boolean {
    if (this.isNearBottomForPrune()) {
      this.pruneOldMessages(maxMessagesInDOM);
      return true;
    }
    return false;
  }

  private pruneOldMessages(maxMessagesInDOM: number): void {
    // Prune old messages from DOM
    this.renderer.pruneByIdx(maxMessagesInDOM);

    // After pruning, send the ACTUAL first idx that remains in DOM
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      this.cachedFirstVisibleIdx = this.getFirstLoadedIdx();
      this.vscode.postMessage({
        type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX,
        idx: this.cachedFirstVisibleIdx,
      });
    });
  }

  /**
   * Get the first indexed message in DOM (not necessarily visible on screen)
   * This represents the oldest loaded message, used for pagination cursor tracking
   */
  private getFirstLoadedIdx(): number | undefined {
    for (const child of Array.from(this.container.children)) {
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
