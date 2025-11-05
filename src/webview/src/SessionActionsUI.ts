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
    changedFiles?: Array<{path: string; status: string; additions: number; deletions: number; diff: string | null}>,
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
    changed?: Array<{path: string; status: string; additions: number; deletions: number; diff: string | null}>,
  ): void {
    if (!this.changesPanel) return;
    if (!changed || changed.length === 0) {
      this.changesPanel.classList.add('hidden');
      this.changesPanel.innerHTML = '';
      return;
    }

    const itemsHtml = changed
      .map((f) => {
        const statsHtml =
          f.status === 'modified'
            ? `<span class="added">+${f.additions}</span> <span class="removed">−${f.deletions}</span>`
            : f.status === 'added'
              ? `<span class="added">added</span>`
              : f.status === 'deleted'
                ? `<span class="removed">deleted</span>`
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

    this.changesPanel.innerHTML = `<div class="session-changes-header">Unapproved changes</div>${itemsHtml}`;
    this.changesPanel.classList.remove('hidden');
  }
}
