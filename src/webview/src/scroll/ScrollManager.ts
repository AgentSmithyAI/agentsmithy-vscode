import {VSCodeAPI, MAX_MESSAGES_IN_DOM} from '../types';
import {UserInteractionDetector} from './UserInteractionDetector';
import {AutoScrollController} from './AutoScrollController';
import {HistoryLoadTrigger} from './HistoryLoadTrigger';
import {DOMPruner, MessageRenderer} from './DOMPruner';

/**
 * Coordinates scrolling behavior, infinite scroll, and DOM pruning
 * Delegates responsibilities to specialized sub-modules
 */
export class ScrollManager {
  private lastScrollTop = 0;

  // Sub-modules handling specific concerns
  private userInteractionDetector: UserInteractionDetector;
  private autoScrollController: AutoScrollController;
  private historyLoadTrigger: HistoryLoadTrigger;
  private domPruner: DOMPruner;

  constructor(
    private messagesContainer: HTMLElement,
    private vscode: VSCodeAPI,
    private renderer: MessageRenderer,
  ) {
    // Initialize sub-modules
    this.userInteractionDetector = new UserInteractionDetector(messagesContainer, window);
    this.autoScrollController = new AutoScrollController(messagesContainer, this.userInteractionDetector);
    this.historyLoadTrigger = new HistoryLoadTrigger(vscode);
    this.domPruner = new DOMPruner(messagesContainer, vscode, renderer);

    this.setupScrollListener();
  }

  /**
   * Call when content height decreases significantly (e.g., reasoning collapsed).
   * If user is near bottom, unlock and snap to bottom to prevent drift.
   */
  handleContentShrink(): void {
    this.autoScrollController.handleContentShrink();
  }

  private setupScrollListener(): void {
    this.messagesContainer.addEventListener('scroll', () => {
      const scrollTop = this.messagesContainer.scrollTop;
      const isScrollingUp = scrollTop < this.lastScrollTop;

      // Handle content growth and auto-scroll
      this.autoScrollController.handleContentGrowth();

      // Update user scroll lock state
      this.autoScrollController.updateLockState(scrollTop, this.lastScrollTop);

      // Check if we need to load more history (infinite scroll up)
      this.historyLoadTrigger.checkTrigger(scrollTop, isScrollingUp);

      // Prune when user is near bottom to keep recent view light
      const didPrune = this.domPruner.checkAndPrune(MAX_MESSAGES_IN_DOM);

      // Re-arm history trigger after pruning so user can scroll back to load more
      if (didPrune && this.historyLoadTrigger.canRearm(scrollTop)) {
        this.historyLoadTrigger.rearm();
      }

      this.lastScrollTop = scrollTop;
    });
  }

  /**
   * Check if user is at the bottom of the chat (for auto-scroll purposes)
   */
  isAtBottom(): boolean {
    return this.autoScrollController.isAtBottom();
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
   * @param _element Optional, unused - kept for backward compatibility
   */
  scrollIntoViewIfAtBottom(_element?: HTMLElement): void {
    this.autoScrollController.scrollIntoViewIfAtBottom();
  }

  /**
   * Scroll to the absolute bottom of the container
   * Uses double rAF to ensure DOM updates are complete
   * Also clears user lock (explicit action should follow user's intent to see bottom)
   */
  scrollToBottom(): void {
    this.autoScrollController.scrollToBottom();
  }

  /**
   * Notify scroll manager that history loading has finished
   */
  finishHistoryLoad(): void {
    this.historyLoadTrigger.finishHistoryLoad();
  }

  /**
   * Set whether more history can be loaded
   */
  setCanLoadMore(canLoad: boolean): void {
    this.historyLoadTrigger.setCanLoadMore(canLoad);
  }

  /**
   * Get the cached first visible index
   */
  getCachedFirstVisibleIdx(): number | undefined {
    return this.domPruner.getCachedFirstVisibleIdx();
  }

  /**
   * Manually request the first loaded index (first in DOM)
   */
  requestFirstVisibleIdx(): void {
    this.domPruner.requestFirstVisibleIdx();
  }
}
