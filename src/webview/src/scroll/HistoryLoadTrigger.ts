import {WEBVIEW_IN_MSG} from '../../../shared/messages';
import {VSCodeAPI} from '../types';

/**
 * Manages infinite scroll up: triggers history loading when user scrolls near top
 */
export class HistoryLoadTrigger {
  private topTriggerArmed = true;
  private isLoadingHistory = false;
  private canLoadMoreHistory = true;

  private readonly TOP_TRIGGER_THRESHOLD = 100; // px from top to trigger history load
  private readonly REARM_THRESHOLD = 300; // px user must move away from top to re-arm

  constructor(private vscode: VSCodeAPI) {}

  /**
   * Check if trigger should fire based on scroll position and direction
   * Returns true if history load was requested
   */
  checkTrigger(scrollTop: number, isScrollingUp: boolean): boolean {
    // Arm the trigger only after the user scrolls away sufficiently
    if (scrollTop > this.REARM_THRESHOLD) {
      this.topTriggerArmed = true;
    }

    // Trigger when within threshold from top, only if user is scrolling up and trigger is armed
    if (isScrollingUp && scrollTop <= this.TOP_TRIGGER_THRESHOLD && this.topTriggerArmed) {
      this.topTriggerArmed = false;
      return this.tryLoadMoreHistory();
    }

    return false;
  }

  private tryLoadMoreHistory(): boolean {
    if (this.isLoadingHistory || !this.canLoadMoreHistory) {
      return false;
    }
    this.isLoadingHistory = true;
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.LOAD_MORE_HISTORY});
    return true;
  }

  /**
   * Notify that history loading has finished
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
  }

  /**
   * Re-arm the trigger (e.g., after pruning)
   */
  rearm(): void {
    this.topTriggerArmed = true;
  }

  /**
   * Check if trigger can be re-armed based on scroll position
   */
  canRearm(scrollTop: number): boolean {
    return scrollTop > this.REARM_THRESHOLD;
  }
}
