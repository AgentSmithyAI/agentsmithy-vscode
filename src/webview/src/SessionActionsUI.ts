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

  constructor(private readonly vscode: VSCodeAPI) {
    this.panel = document.getElementById('sessionActions')!;
    this.approveBtn = document.getElementById('sessionApproveBtn')!;
    this.resetBtn = document.getElementById('sessionResetBtn')!;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.approveBtn.addEventListener('click', () => {
      if (this.currentDialogId) {
        this.vscode.postMessage({
          type: WEBVIEW_IN_MSG.APPROVE_SESSION,
          dialogId: this.currentDialogId,
        });
      }
    });

    this.resetBtn.addEventListener('click', () => {
      if (this.currentDialogId) {
        this.vscode.postMessage({
          type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
          dialogId: this.currentDialogId,
        });
      }
    });
  }

  setCurrentDialogId(dialogId: string | null): void {
    this.currentDialogId = dialogId;
  }

  updateSessionStatus(hasUnapproved: boolean): void {
    if (hasUnapproved) {
      this.panel.style.display = 'flex';
    } else {
      this.panel.style.display = 'none';
    }
  }
}
