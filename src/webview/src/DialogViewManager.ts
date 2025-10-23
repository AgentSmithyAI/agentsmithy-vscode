import {DialogView} from './DialogView';
import {VSCodeAPI} from './types';

/**
 * Manages multiple DialogView instances.
 * Handles creation, switching, and cleanup of dialog views.
 */
export class DialogViewManager {
  private views: Map<string, DialogView> = new Map();
  private activeDialogId: string | null = null;
  private workspaceRoot: string;
  private vscode: VSCodeAPI;
  private parentContainer: HTMLElement;

  // Configuration
  private readonly MAX_INACTIVE_VIEWS = 3; // Keep max 3 inactive views in memory
  private readonly CLEANUP_CHECK_INTERVAL = 30000; // Check for cleanup every 30 seconds

  private cleanupTimer: number | null = null;

  constructor(workspaceRoot: string, vscode: VSCodeAPI, parentContainer: HTMLElement) {
    this.workspaceRoot = workspaceRoot;
    this.vscode = vscode;
    this.parentContainer = parentContainer;

    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Get or create a dialog view
   */
  getOrCreateView(dialogId: string): DialogView {
    let view = this.views.get(dialogId);

    if (!view) {
      view = new DialogView(dialogId, this.workspaceRoot, this.vscode, this.parentContainer);
      this.views.set(dialogId, view);
    }

    return view;
  }

  /**
   * Get an existing dialog view (returns undefined if not loaded)
   */
  getView(dialogId: string): DialogView | undefined {
    return this.views.get(dialogId);
  }

  /**
   * Get the currently active dialog view
   */
  getActiveView(): DialogView | null {
    if (!this.activeDialogId) {
      return null;
    }
    return this.views.get(this.activeDialogId) || null;
  }

  /**
   * Get the currently active dialog ID
   */
  getActiveDialogId(): string | null {
    return this.activeDialogId;
  }

  /**
   * Switch to a different dialog
   */
  switchToDialog(dialogId: string): DialogView {
    // Hide current active view
    if (this.activeDialogId) {
      const currentView = this.views.get(this.activeDialogId);
      if (currentView) {
        currentView.hide();
      }
    }

    // Get or create new view
    const newView = this.getOrCreateView(dialogId);

    // Show new view
    newView.show();
    this.activeDialogId = dialogId;

    // Schedule cleanup of old views
    this.scheduleCleanup();

    return newView;
  }

  /**
   * Remove a dialog view
   */
  removeView(dialogId: string): void {
    const view = this.views.get(dialogId);
    if (view) {
      view.destroy();
      this.views.delete(dialogId);

      // If this was the active view, clear active dialog
      if (this.activeDialogId === dialogId) {
        this.activeDialogId = null;
      }
    }
  }

  /**
   * Get all dialog IDs that have loaded views
   */
  getLoadedDialogIds(): string[] {
    return Array.from(this.views.keys());
  }

  /**
   * Check if a dialog is currently loaded
   */
  isDialogLoaded(dialogId: string): boolean {
    return this.views.has(dialogId);
  }

  /**
   * Cleanup inactive dialog views to free memory.
   * Keeps views that:
   * - Are currently active
   * - Have an active stream
   * - Are among the most recently used (up to MAX_INACTIVE_VIEWS)
   */
  cleanupInactiveViews(): void {
    const viewsToKeep: string[] = [];
    const viewsToRemove: string[] = [];

    // First pass: identify views that must be kept
    for (const [dialogId, view] of this.views.entries()) {
      if (dialogId === this.activeDialogId) {
        // Keep active view
        viewsToKeep.push(dialogId);
      } else if (view.hasActiveStream()) {
        // Keep views with active streams
        viewsToKeep.push(dialogId);
      } else {
        // Candidate for removal
        viewsToRemove.push(dialogId);
      }
    }

    // If we have more inactive views than MAX_INACTIVE_VIEWS, remove the excess
    // For now, we just remove all inactive views without active streams
    // In a more sophisticated implementation, we could track last access time
    const inactiveCount = viewsToRemove.length;
    if (inactiveCount > this.MAX_INACTIVE_VIEWS) {
      const toRemoveCount = inactiveCount - this.MAX_INACTIVE_VIEWS;
      const actualRemoval = viewsToRemove.slice(0, toRemoveCount);

      for (const dialogId of actualRemoval) {
        this.removeView(dialogId);
      }
    }
  }

  /**
   * Schedule a cleanup check
   */
  private scheduleCleanup(): void {
    // Debounce cleanup - only run after a delay
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
    }

    this.cleanupTimer = window.setTimeout(() => {
      this.cleanupInactiveViews();
      this.cleanupTimer = null;
    }, 5000); // Wait 5 seconds after last dialog switch
  }

  /**
   * Start periodic cleanup checks
   */
  private startPeriodicCleanup(): void {
    setInterval(() => {
      this.cleanupInactiveViews();
    }, this.CLEANUP_CHECK_INTERVAL);
  }

  /**
   * Destroy all views and cleanup
   */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const view of this.views.values()) {
      view.destroy();
    }

    this.views.clear();
    this.activeDialogId = null;
  }
}
