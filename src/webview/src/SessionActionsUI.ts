import {WEBVIEW_IN_MSG} from '../../shared/messages';
import {VSCodeAPI} from './types';
import {LoadingButton} from './LoadingButton';

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

  private currentDialogId: string | null = null;

  // Single source of truth for processing and availability
  private isProcessing = false;
  private canAct = false; // reflects hasUnapproved from backend
  private activeOp: 'approve' | 'reset' | null = null;

  // Resize state
  private resizeState: {dragging: boolean; startY: number; startHeight: number; origin: 'top' | 'bottom'} = {
    dragging: false,
    startY: 0,
    startHeight: 0,
    origin: 'bottom',
  };

  constructor(private readonly vscode: VSCodeAPI) {
    this.panel = document.getElementById('sessionActions')!;
    this.approveBtn = document.getElementById('sessionApproveBtn') as HTMLButtonElement;
    this.resetBtn = document.getElementById('sessionResetBtn') as HTMLButtonElement;
    this.changesPanel = document.getElementById('sessionChanges') as HTMLElement;

    this.approveLoading = new LoadingButton(this.approveBtn);
    this.resetLoading = new LoadingButton(this.resetBtn);

    this.setupEventListeners();
    this.updateUI();
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
      console.warn(`[SessionActionsUI] ${action} ignored: no currentDialogId`);
      return false;
    }
    if (this.isProcessing) {
      // Buttons should already be disabled; log defensively in case of race.
      console.warn(`[SessionActionsUI] ${action} ignored: already processing`);
      return false;
    }
    if (!this.canAct) {
      console.warn(`[SessionActionsUI] ${action} ignored: action not allowed (no unapproved changes)`);
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
      this.changesPanel.style.removeProperty('height');
      this.changesPanel.style.removeProperty('maxHeight');
      this.changesPanel.innerHTML = '';
      return;
    }

    const itemsHtml = changed
      .map((f) => {
        const statsHtml =
          f.status === 'modified'
            ? `<span class="added">+${f.additions}</span> <span class="removed">−${f.deletions}</span>`
            : f.status === 'added'
              ? '<span class="added">added</span>'
              : f.status === 'deleted'
                ? '<span class="removed">deleted</span>'
                : `<span>${f.status}</span>`;
        const displayPath = f.path.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const root = (window as unknown as {WORKSPACE_ROOT?: string}).WORKSPACE_ROOT || '';
        const absolutePath =
          f.path.startsWith('/') || /^\w:\\/.test(f.path) ? f.path : root ? `${root}/${f.path}` : f.path;
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
          <button class="session-action-btn" id="diffViewToggleBtn" title="Toggle diff view (inline/two‑pane)" aria-label="Toggle diff view">
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

    // Delegate clicks to open file with diff
    this.changesPanel.querySelectorAll('.file-link').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        const file = el.getAttribute('data-file') || '';
        if (file) {
          this.vscode.postMessage({type: WEBVIEW_IN_MSG.OPEN_FILE_DIFF, file: decodeURIComponent(file)});
        }
      });
    });

    // Hook resizer drag
    const topResizer = this.changesPanel.querySelector('.session-changes-resizer.top');
    if (topResizer) {
      topResizer.addEventListener('mousedown', (e) => this.onResizeStart(e, 'top'));
    }

    // Wire diff view toggle (button is rendered with the header)
    const diffBtn = this.changesPanel.querySelector('#diffViewToggleBtn') as HTMLButtonElement | null;
    if (diffBtn) {
      diffBtn.addEventListener('click', () => {
        this.vscode.postMessage({type: WEBVIEW_IN_MSG.TOGGLE_DIFF_VIEW});
      });
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
    const saved = (state as any)?.sessionChangesHeight as number | undefined;

    if (typeof saved === 'number' && saved > 40) {
      // Explicit height overrides max-height on the container so it resizes
      panelEl.style.height = `${saved}px`;
      panelEl.style.maxHeight = 'none';
      return;
    }

    // No saved height — compute max height for ~5 rows
    try {
      const header = panelEl.querySelector('.session-changes-header') as HTMLElement | null;
      const firstItem = panelEl.querySelector('.session-change-item') as HTMLElement | null;
      const headerH = header ? header.offsetHeight : 16;
      const rowH = firstItem ? firstItem.offsetHeight : 22;
      const targetMax = Math.max(40, headerH + rowH * 5);
      panelEl.style.removeProperty('height');
      panelEl.style.maxHeight = `${targetMax}px`;
    } catch {
      // Fallback constant
      panelEl.style.maxHeight = '140px';
    }
  }

  private onResizeStart(e: MouseEvent, origin: 'top' | 'bottom' = 'bottom'): void {
    e.preventDefault();
    const panelEl = this.changesPanel;
    if (!panelEl) return;

    this.resizeState.dragging = true;
    this.resizeState.startY = e.clientY;
    this.resizeState.startHeight = panelEl.getBoundingClientRect().height;
    this.resizeState.origin = origin;
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
    const minH = 40; // at least header + ~1 row
    const clamped = Math.max(minH, Math.min(window.innerHeight * 0.8, newH));
    panelEl.style.height = `${Math.round(clamped)}px`;
    panelEl.style.maxHeight = 'none';
  }

  private onResizeEnd(): void {
    if (!this.resizeState.dragging) return;
    this.resizeState.dragging = false;
    (document.body as HTMLElement).style.userSelect = '';

    const panelEl = this.changesPanel;
    if (!panelEl) return;

    // Persist height
    const rect = panelEl.getBoundingClientRect();
    try {
      const prev = (this.vscode.getState?.() as any) || {};
      this.vscode.setState?.({...prev, sessionChangesHeight: Math.round(rect.height)});
    } catch {}
  }
}
