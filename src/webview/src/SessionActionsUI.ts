import {WEBVIEW_IN_MSG} from '../../shared/messages';
import {VSCodeAPI} from './types';
import {LoadingButton} from './LoadingButton';
import {escapeHtml} from './utils';

interface WebviewState {
  sessionChangesHeight?: number;
}

/**
 * Manages the session actions panel (approve/reset buttons)
 */
export class SessionActionsUI {
  private panel: HTMLElement;
  private approveBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private changesPanel: HTMLElement;
  private approveLoading: LoadingButton;
  private resetLoading: LoadingButton;

  /**
   * Compute min height that still shows exactly one row of the list (header + 1 item).
   */
  private getMinOneRowHeight(): number {
    const panelEl = this.changesPanel;
    if (!panelEl) return 40;
    try {
      const header = panelEl.querySelector('.session-changes-header') as HTMLElement | null;
      const body = panelEl.querySelector('.session-changes-body') as HTMLElement | null;
      const firstItem = panelEl.querySelector('.session-change-item') as HTMLElement | null;

      const headerH = header ? header.getBoundingClientRect().height : 16;
      const itemH = firstItem ? firstItem.getBoundingClientRect().height : 22;

      // Include body vertical padding in minimum height so one full row is never clipped
      let bodyPad = 0;
      if (body) {
        const cs = getComputedStyle(body);
        const pt = parseFloat(cs.paddingTop || '0');
        const pb = parseFloat(cs.paddingBottom || '0');
        bodyPad = (isFinite(pt) ? pt : 0) + (isFinite(pb) ? pb : 0);
      }

      return Math.max(24, Math.ceil(headerH + bodyPad + itemH));
    } catch {
      return 40;
    }
  }

  /**
   * Get the maximum allowed height for the panel based on viewport size.
   */
  private getMaxAllowedHeight(): number {
    return Math.floor(window.innerHeight * SessionActionsUI.MAX_HEIGHT_RATIO);
  }

  private currentDialogId: string | null = null;

  // Single source of truth for processing and availability
  private isProcessing = false;
  private canAct = false; // reflects hasUnapproved from backend
  private activeOp: 'approve' | 'reset' | null = null;

  // Resize state
  private resizeState: {
    dragging: boolean;
    startY: number;
    startHeight: number;
    origin: 'top' | 'bottom';
    defaultHAtDrag?: number; // freeze snap target for the whole drag to avoid jitter
    snappedLatched?: boolean; // true once we snapped; requires hysteresis to unsnap
  } = {
    dragging: false,
    startY: 0,
    startHeight: 0,
    origin: 'bottom',
    defaultHAtDrag: undefined,
    snappedLatched: false,
  };

  // Snap behavior constants
  private static readonly SNAP_PX = 8;
  private static readonly UNSNAP_PX = SessionActionsUI.SNAP_PX * 2;
  // Maximum panel height as a fraction of viewport height
  private static readonly MAX_HEIGHT_RATIO = 0.4;

  constructor(
    private readonly vscode: VSCodeAPI,
    private readonly workspaceRoot: string,
  ) {
    this.panel = document.getElementById('sessionActions')!;
    this.approveBtn = document.getElementById('sessionApproveBtn') as HTMLButtonElement;
    this.resetBtn = document.getElementById('sessionResetBtn') as HTMLButtonElement;
    this.changesPanel = document.getElementById('sessionChanges') as HTMLElement;

    this.approveLoading = new LoadingButton(this.approveBtn);
    this.resetLoading = new LoadingButton(this.resetBtn);

    this.setupEventListeners();
    this.setupChangesPanelDelegation();
    this.updateUI();
  }

  // Event delegation for changes panel to avoid memory leaks
  // This listener is set once and handles all clicks, even for dynamically rendered elements
  private setupChangesPanelDelegation(): void {
    if (!this.changesPanel) {
      return; // Panel might not exist in some test scenarios
    }

    this.changesPanel.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Handle file link clicks
      const fileLink = target.closest('.file-link') as HTMLElement | null;
      if (fileLink) {
        e.preventDefault();
        e.stopPropagation();
        const file = fileLink.getAttribute('data-file') || '';
        if (file) {
          this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_FILE_DIFF, file: decodeURIComponent(file)});
        }
        return;
      }

      // Handle diff view toggle button
      const diffBtn = target.closest('#diffViewToggleBtn') as HTMLElement | null;
      if (diffBtn) {
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.TOGGLE_DIFF_VIEW});
        return;
      }
    });

    // Resizer needs mousedown, so use delegation on changesPanel
    this.changesPanel.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      const resizer = target.closest('.session-changes-resizer.top') as HTMLElement | null;
      if (resizer) {
        this.onResizeStart(e as MouseEvent, 'top');
      }
    });
  }

  // Event wiring
  private setupEventListeners(): void {
    this.approveBtn.addEventListener('click', () => this.onApprove());
    this.resetBtn.addEventListener('click', () => this.onReset());

    // Global listeners for resize drag
    document.addEventListener('mousemove', (e) => this.onResizeMove(e));
    document.addEventListener('mouseup', () => this.onResizeEnd());
  }

  // Public API
  setCurrentDialogId(dialogId: string | null): void {
    this.currentDialogId = dialogId;
    // Reset processing and spinners when switching dialogs
    this.finishOperation();
    // Keep canAct as is until backend sends hasUnapproved for this dialog
    this.updateUI();
  }

  updateSessionStatus(
    hasUnapproved: boolean,
    changedFiles?: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
      diff: string | null;
      base_content?: string | null;
      is_binary?: boolean;
      is_too_large?: boolean;
    }>,
  ): void {
    // Backend completed an operation or provided state; update flags
    this.canAct = !!hasUnapproved;
    this.finishOperation();
    this.renderChangedFiles(changedFiles);
    this.updateUI();
  }

  /**
   * Cancel any ongoing session operation (e.g., user cancelled confirmation dialog)
   */
  cancelOperation(): void {
    this.finishOperation();
    this.updateUI();
  }

  // Handlers
  private onApprove(): void {
    if (!this.ensureReady('approve')) return;
    this.startOperation('approve');
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.APPROVE_SESSION,
      dialogId: this.currentDialogId,
    });
  }

  private onReset(): void {
    if (!this.ensureReady('reset')) return;
    this.startOperation('reset');
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
      dialogId: this.currentDialogId,
    });
  }

  /**
   * Ensures the component is in a valid state to perform an action.
   * Logs a diagnostic warning if a user action is ignored due to state.
   */
  private ensureReady(action: 'approve' | 'reset'): boolean {
    if (!this.currentDialogId) {
      return false;
    }
    if (this.isProcessing) {
      return false;
    }
    if (!this.canAct) {
      return false;
    }
    return true;
  }

  // State helpers
  private startOperation(op: 'approve' | 'reset'): void {
    this.isProcessing = true;
    this.activeOp = op;
    // Start spinner only on the triggered button
    if (op === 'approve') this.approveLoading.start();
    else this.resetLoading.start();
    this.updateUI();
  }

  private finishOperation(): void {
    this.isProcessing = false;
    // Stop both spinners to be safe (handles switch/cancel/finish)
    this.approveLoading.stop();
    this.resetLoading.stop();
    this.activeOp = null;
  }

  private updateUI(): void {
    // Disable both buttons if not allowed to act or while processing
    const disabled = !this.canAct || this.isProcessing;
    this.approveBtn.disabled = disabled;
    this.resetBtn.disabled = disabled;
  }

  private renderChangedFiles(
    changed?: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
      diff: string | null;
      base_content?: string | null;
      is_binary?: boolean;
      is_too_large?: boolean;
    }>,
  ): void {
    if (!this.changesPanel) return;
    if (!changed || changed.length === 0) {
      // Fully collapse the panel when no changes:
      // - hide via display none (in addition to .hidden for safety)
      // - remove any previously persisted inline sizes
      this.changesPanel.classList.add('hidden');
      this.changesPanel.style.display = 'none';
      // Clear any inline sizing to fully collapse
      this.changesPanel.style.height = '';
      this.changesPanel.style.maxHeight = '';
      this.changesPanel.innerHTML = '';
      return;
    }

    const itemsHtml = changed
      .map((f) => {
        const statsHtml =
          f.status === 'modified'
            ? `<span class="added">+${Math.max(0, f.additions)}</span> <span class="removed">-${Math.max(0, f.deletions)}</span>`
            : f.status === 'added'
              ? '<span class="added">added</span>'
              : f.status === 'deleted'
                ? '<span class="removed">deleted</span>'
                : `<span>${escapeHtml(f.status)}</span>`;
        const displayPath = escapeHtml(f.path);
        const absolutePath =
          f.path.startsWith('/') || /^\w:\\/.test(f.path)
            ? f.path
            : this.workspaceRoot
              ? `${this.workspaceRoot}/${f.path}`
              : f.path;
        const dataFile = encodeURIComponent(absolutePath);
        return `<div class="session-change-item">
          <a href="#" class="file-link" data-file="${dataFile}">${displayPath}</a>
          <span class="session-change-meta">${statsHtml}</span>
        </div>`;
      })
      .join('');

    // Place resizer at the top so user can stretch upwards
    this.changesPanel.innerHTML = `
      <div class="session-changes-header">
        <div class="session-changes__title">Pending changes</div>
        <div class="session-changes__actions">
          <button class="session-action-btn" id="diffViewToggleBtn" title="Toggle diff view (inline/two-pane)" aria-label="Toggle diff view">
            <span class="codicon codicon-diff" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="session-changes-resizer top" title="Drag to resize"></div>
      <div class="session-changes-body">
        ${itemsHtml}
      </div>
    `;
    // Make sure the container is visible and uses flex layout as defined in CSS
    this.changesPanel.classList.remove('hidden');
    this.changesPanel.style.display = '';

    // Apply initial sizing or restore persisted height
    this.applyInitialOrPersistedHeight();

    // Note: Event listeners are NOT added here to avoid memory leaks.
    // They are set up once in constructor via setupChangesPanelDelegation() using event delegation.
  }

  /**
   * Compute the default target height for the changes panel used for "snap" behavior.
   *
   * Rules:
   * - Minimum height is exactly one list row + header (so one visible item row at least).
   * - Default snap height depends on the list fill: 1 row -> snap to 1 row, 2 rows -> snap to 2, etc.
   * - The snap target will never exceed 80% of the viewport height to avoid covering the whole webview.
   */
  private getDefaultMaxHeight(): number {
    const panelEl = this.changesPanel;
    if (!panelEl) return 140;
    try {
      const header = panelEl.querySelector('.session-changes-header') as HTMLElement | null;
      const body = panelEl.querySelector('.session-changes-body') as HTMLElement | null;

      const headerH = header ? header.getBoundingClientRect().height : 16;

      // Prefer exact content height: full scrollHeight of the list body
      // This accounts for row gaps, borders, and padding to avoid half-hidden rows.
      let bodyContentH = 0;
      if (body) {
        bodyContentH = body.scrollHeight; // includes padding and gaps
      } else {
        // Fallback to estimating via first item height * count
        const items = panelEl.querySelectorAll('.session-change-item');
        const firstItem = items.item(0) as HTMLElement | null;
        const rowH = firstItem ? firstItem.getBoundingClientRect().height : 22;
        const count = Math.max(1, items.length);
        bodyContentH = rowH * count;
      }

      const desired = Math.ceil(headerH + bodyContentH);
      const viewportLimit = this.getMaxAllowedHeight();

      // Never below one-row minimum
      const minOneRow = this.getMinOneRowHeight();

      return Math.max(minOneRow, Math.min(viewportLimit, desired));
    } catch {
      return 140;
    }
  }

  private applyInitialOrPersistedHeight(): void {
    const panelEl = this.changesPanel;
    if (!panelEl) return;

    // Try to restore from VS Code webview state
    let state: unknown;
    try {
      state = this.vscode.getState?.();
    } catch {}
    const saved = (state as WebviewState)?.sessionChangesHeight;

    const minOneRow = this.getMinOneRowHeight();
    const maxAllowed = this.getMaxAllowedHeight();

    if (typeof saved === 'number' && saved > minOneRow) {
      // Explicit height overrides max-height on the container so it resizes
      // Clamp to maximum allowed height
      const clampedHeight = Math.min(saved, maxAllowed);
      panelEl.style.height = `${clampedHeight}px`;
      panelEl.style.maxHeight = `${maxAllowed}px`;
      return;
    }

    // No saved height — compute default snap height based on list fill (1..N rows)
    const targetMax = this.getDefaultMaxHeight();
    panelEl.style.removeProperty('height');
    panelEl.style.maxHeight = `${targetMax}px`;
  }

  private onResizeStart(e: MouseEvent, origin: 'top' | 'bottom' = 'bottom'): void {
    e.preventDefault();
    const panelEl = this.changesPanel;
    if (!panelEl) return;

    this.resizeState.dragging = true;
    this.resizeState.startY = e.clientY;
    this.resizeState.startHeight = panelEl.getBoundingClientRect().height;
    this.resizeState.origin = origin;
    // Freeze default snap target for the whole drag session
    this.resizeState.defaultHAtDrag = this.getDefaultMaxHeight();
    this.resizeState.snappedLatched = false;
    // Disable text selection while resizing
    (document.body as HTMLElement).style.userSelect = 'none';
  }

  private onResizeMove(e: MouseEvent): void {
    if (!this.resizeState.dragging) return;
    const panelEl = this.changesPanel;
    if (!panelEl) return;

    const dy = e.clientY - this.resizeState.startY;
    // If resizing from top, dragging up (negative dy) should increase height
    const newH =
      this.resizeState.origin === 'top' ? this.resizeState.startHeight - dy : this.resizeState.startHeight + dy;

    // Enforce minimum height: header + exactly one row
    const minOneRow = this.getMinOneRowHeight();
    const maxAllowed = this.getMaxAllowedHeight();
    const clamped = Math.max(minOneRow, Math.min(maxAllowed, newH));

    // Use frozen default target to avoid oscillation while dragging
    const defaultH = this.resizeState.defaultHAtDrag ?? this.getDefaultMaxHeight();

    let applied = Math.round(clamped);

    if (this.resizeState.snappedLatched) {
      // Stay snapped until the handle moves far enough away
      if (Math.abs(applied - defaultH) > SessionActionsUI.UNSNAP_PX) {
        this.resizeState.snappedLatched = false;
        delete panelEl.dataset.snapped;
      } else {
        applied = defaultH;
        panelEl.dataset.snapped = '1';
      }
    } else {
      // Not yet snapped; snap when entering the tight zone
      if (Math.abs(applied - defaultH) <= SessionActionsUI.SNAP_PX) {
        applied = defaultH;
        this.resizeState.snappedLatched = true;
        panelEl.dataset.snapped = '1';
      } else {
        delete panelEl.dataset.snapped;
      }
    }

    panelEl.style.height = `${applied}px`;
    panelEl.style.maxHeight = `${maxAllowed}px`;
  }

  private onResizeEnd(): void {
    if (!this.resizeState.dragging) return;
    this.resizeState.dragging = false;
    (document.body as HTMLElement).style.userSelect = '';

    const panelEl = this.changesPanel;
    if (!panelEl) return;

    const rect = panelEl.getBoundingClientRect();
    const defaultH = this.resizeState.defaultHAtDrag ?? this.getDefaultMaxHeight();
    const isSnapped = panelEl.dataset?.snapped === '1' || Math.abs(rect.height - defaultH) <= SessionActionsUI.SNAP_PX;

    try {
      const prev = (this.vscode.getState?.() as WebviewState) || {};
      if (isSnapped) {
        // Clear explicit height and reset persisted size so default applies next time
        // Remove stored override
        const {sessionChangesHeight, ...rest} = prev;
        this.vscode.setState?.(rest);
        // Apply default visual sizing
        panelEl.style.removeProperty('height');
        panelEl.style.maxHeight = `${defaultH}px`;
      } else {
        // Persist explicit height but never below one-row min and never above max allowed
        const minOneRow = this.getMinOneRowHeight();
        const maxAllowed = this.getMaxAllowedHeight();
        const target = Math.max(minOneRow, Math.min(maxAllowed, Math.round(rect.height)));
        this.vscode.setState?.({...prev, sessionChangesHeight: target});
        panelEl.style.maxHeight = `${maxAllowed}px`;
      }
    } catch {}

    // Cleanup snap marker and drag-state flags
    delete panelEl.dataset.snapped;
    this.resizeState.defaultHAtDrag = undefined;
    this.resizeState.snappedLatched = false;
  }
}
