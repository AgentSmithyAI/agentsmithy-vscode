import {WEBVIEW_IN_MSG} from '../../shared/messages';
import {VSCodeAPI} from './types';

/**
 * Manages the session actions panel (approve/reset buttons)
 */
export class SessionActionsUI {
  private panel: HTMLElement;
  private approveBtn: HTMLElement;
  private resetBtn: HTMLElement;
  private currentDialogId: string | null = null;
  private isApproveProcessing = false;
  private isResetProcessing = false;

  constructor(private readonly vscode: VSCodeAPI) {
    this.panel = document.getElementById('sessionActions')!;
    this.approveBtn = document.getElementById('sessionApproveBtn')!;
    this.resetBtn = document.getElementById('sessionResetBtn')!;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.approveBtn.addEventListener('click', () => {
      if (this.currentDialogId && !this.isApproveProcessing) {
        this.isApproveProcessing = true;
        this.updateButtonStates();
        this.vscode.postMessage({
          type: WEBVIEW_IN_MSG.APPROVE_SESSION,
          dialogId: this.currentDialogId,
        });
      }
    });

    this.resetBtn.addEventListener('click', () => {
      if (this.currentDialogId && !this.isResetProcessing) {
        this.isResetProcessing = true;
        this.updateButtonStates();
        this.vscode.postMessage({
          type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
          dialogId: this.currentDialogId,
        });
      }
    });
  }

  setCurrentDialogId(dialogId: string | null): void {
    this.currentDialogId = dialogId;
    // Reset processing flags when switching dialogs
    this.isApproveProcessing = false;
    this.isResetProcessing = false;
    this.updateButtonStates();
  }

  updateSessionStatus(hasUnapproved: boolean): void {
    // Clear processing flags when we get a status update (operation completed)
    this.isApproveProcessing = false;
    this.isResetProcessing = false;
    this.updateButtonStates(hasUnapproved);
  }

  /**
   * Cancel any ongoing session operation (e.g., user cancelled confirmation dialog)
   */
  cancelOperation(): void {
    this.isApproveProcessing = false;
    this.isResetProcessing = false;
    this.updateButtonStates();
  }

  private updateButtonStates(hasUnapproved?: boolean): void {
    const approveBtnElement = this.approveBtn as HTMLButtonElement;
    const resetBtnElement = this.resetBtn as HTMLButtonElement;

    // Determine if buttons should be enabled based on session status
    // If hasUnapproved is not provided, keep current disabled state
    const shouldEnable =
      hasUnapproved !== undefined ? hasUnapproved : !approveBtnElement.disabled && !this.isApproveProcessing;

    // Disable if: no unapproved changes OR operation is in progress
    approveBtnElement.disabled = !shouldEnable || this.isApproveProcessing;
    resetBtnElement.disabled = !shouldEnable || this.isResetProcessing;
  }
}
