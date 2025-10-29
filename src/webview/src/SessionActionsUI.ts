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
  private approveLoading: LoadingButton;
  private resetLoading: LoadingButton;
  private currentDialogId: string | null = null;
  private isApproveProcessing = false;
  private isResetProcessing = false;

  constructor(private readonly vscode: VSCodeAPI) {
    this.panel = document.getElementById('sessionActions')!;
    this.approveBtn = document.getElementById('sessionApproveBtn') as HTMLButtonElement;
    this.resetBtn = document.getElementById('sessionResetBtn') as HTMLButtonElement;

    this.approveLoading = new LoadingButton(this.approveBtn);
    this.resetLoading = new LoadingButton(this.resetBtn);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.approveBtn.addEventListener('click', () => {
      // Prevent parallel actions: if any operation is running, ignore
      if (this.isApproveProcessing || this.isResetProcessing) {
        return;
      }
      if (this.currentDialogId) {
        this.isApproveProcessing = true;
        this.approveLoading.start();
        this.updateButtonStates();
        this.vscode.postMessage({
          type: WEBVIEW_IN_MSG.APPROVE_SESSION,
          dialogId: this.currentDialogId,
        });
      }
    });

    this.resetBtn.addEventListener('click', () => {
      // Prevent parallel actions: if any operation is running, ignore
      if (this.isApproveProcessing || this.isResetProcessing) {
        return;
      }
      if (this.currentDialogId) {
        this.isResetProcessing = true;
        this.resetLoading.start();
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
    this.approveLoading.stop();
    this.resetLoading.stop();
    this.updateButtonStates();
  }

  updateSessionStatus(hasUnapproved: boolean): void {
    // Clear processing flags when we get a status update (operation completed)
    this.isApproveProcessing = false;
    this.isResetProcessing = false;
    this.approveLoading.stop();
    this.resetLoading.stop();
    this.updateButtonStates(hasUnapproved);
  }

  /**
   * Cancel any ongoing session operation (e.g., user cancelled confirmation dialog)
   */
  cancelOperation(): void {
    this.isApproveProcessing = false;
    this.isResetProcessing = false;
    this.approveLoading.stop();
    this.resetLoading.stop();
    this.updateButtonStates();
  }

  private updateButtonStates(hasUnapproved?: boolean): void {
    const approveBtnElement = this.approveBtn as HTMLButtonElement;
    const resetBtnElement = this.resetBtn as HTMLButtonElement;

    // Determine if buttons should be enabled based on session status
    // If hasUnapproved is not provided, keep current disabled state from approve button
    const shouldEnable =
      hasUnapproved !== undefined
        ? hasUnapproved
        : !approveBtnElement.disabled && !this.isApproveProcessing && !this.isResetProcessing;

    // Disable both if: no unapproved changes OR any operation is in progress
    const anyProcessing = this.isApproveProcessing || this.isResetProcessing;
    approveBtnElement.disabled = !shouldEnable || anyProcessing;
    resetBtnElement.disabled = !shouldEnable || anyProcessing;
  }
}
