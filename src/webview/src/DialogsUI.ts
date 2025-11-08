import {WEBVIEW_IN_MSG} from '../../shared/messages';
import type {VSCodeAPI} from './types';
import {escapeHtml} from './utils';
import {LoadingButton} from './LoadingButton';

interface Dialog {
  id: string;
  title: string | null;
  updated_at: string;
}

/**
 * Manages the dialogs dropdown UI and interactions
 */
export class DialogsUI {
  private dialogs: Dialog[] = [];
  private currentDialogId: string | null = null;
  private isDropdownOpen = false;

  // Optional callback hooks for host (index.ts)
  public onCreateNewDialog?: () => void;

  private dialogTitleBtn: HTMLElement;
  private dialogTitleText: HTMLElement;
  private dialogDropdown: HTMLElement;
  private dialogsList: HTMLElement;
  private newDialogBtn: HTMLButtonElement;
  private newDialogLoading: LoadingButton | null = null;

  constructor(private readonly vscode: VSCodeAPI) {
    this.dialogTitleBtn = document.getElementById('dialogTitleBtn')!;
    this.dialogTitleText = document.getElementById('dialogTitleText')!;
    this.dialogDropdown = document.getElementById('dialogDropdown')!;
    this.dialogsList = document.getElementById('dialogsList')!;
    this.newDialogBtn = document.getElementById('newDialogBtn') as HTMLButtonElement;
    this.newDialogLoading = new LoadingButton(this.newDialogBtn);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Toggle dropdown
    this.dialogTitleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.toggleDropdown();
    });

    // Create new dialog
    this.newDialogBtn.addEventListener('click', () => {
      // Notify host so it can adjust focus behavior without guessing
      try {
        this.onCreateNewDialog?.();
      } catch {}
      this.newDialogLoading?.start();
      this.vscode.postMessage({type: WEBVIEW_IN_MSG.CREATE_DIALOG});
      this.closeDropdown();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (this.isDropdownOpen && !this.dialogDropdown.contains(target) && !this.dialogTitleBtn.contains(target)) {
        this.closeDropdown();
      }
    });
  }

  private toggleDropdown(): void {
    if (this.isDropdownOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  private openDropdown(): void {
    this.isDropdownOpen = true;
    this.dialogDropdown.style.display = 'block';

    // Load dialogs when opening
    this.vscode.postMessage({type: WEBVIEW_IN_MSG.LOAD_DIALOGS});
  }

  private closeDropdown(): void {
    this.isDropdownOpen = false;
    this.dialogDropdown.style.display = 'none';
  }

  /**
   * Update dialogs list
   */
  updateDialogs(dialogs: Dialog[], currentDialogId: string | null): void {
    this.dialogs = dialogs;
    this.currentDialogId = currentDialogId;
    this.newDialogLoading?.stop();
    this.renderDialogsList();
    this.updateCurrentDialogTitle();
  }

  /**
   * Show loading state
   */
  showLoading(): void {
    this.dialogsList.innerHTML = `
      <div class="dialog-item loading">
        <div class="dialog-spinner"></div>
        <span>Loading...</span>
      </div>
    `;
  }

  /**
   * Show error state
   */
  showError(error: string): void {
    this.dialogsList.innerHTML = `
      <div class="dialog-item error">${escapeHtml(error)}</div>
    `;
  }

  /**
   * Update current dialog display
   */
  updateCurrentDialog(dialogId: string | null, title: string): void {
    this.currentDialogId = dialogId;
    this.dialogTitleText.textContent = title || 'New dialog';
    this.newDialogLoading?.stop();
    this.checkTitleOverflow();
    this.renderDialogsList();
  }

  private updateCurrentDialogTitle(): void {
    const currentDialog = this.dialogs.find((d) => d.id === this.currentDialogId);
    this.dialogTitleText.textContent = currentDialog?.title || 'New dialog';
    this.checkTitleOverflow();
  }

  private checkTitleOverflow(): void {
    // Check if text is overflowing and apply gradient mask only when needed
    const isOverflowing = this.dialogTitleText.scrollWidth > this.dialogTitleText.clientWidth;
    if (isOverflowing) {
      this.dialogTitleText.classList.add('overflowing');
    } else {
      this.dialogTitleText.classList.remove('overflowing');
    }
  }

  private renderDialogsList(): void {
    if (this.dialogs.length === 0) {
      this.dialogsList.innerHTML = '<div class="dialog-item loading">No conversations yet</div>';
      return;
    }

    const html = this.dialogs
      .map((dialog) => {
        const isActive = dialog.id === this.currentDialogId;
        const title = escapeHtml(dialog.title || 'New dialog');
        const escapedId = escapeHtml(dialog.id);
        const updatedAt = this.formatDate(dialog.updated_at);

        return `
        <div class="dialog-item ${isActive ? 'active' : ''}" data-dialog-id="${escapedId}">
          <div class="dialog-item-left">
            <div class="dialog-item-title">${title}</div>
          </div>
          <div class="dialog-item-right">
            <div class="dialog-item-meta">${updatedAt}</div>
            <div class="dialog-item-actions">
              <button class="dialog-action-btn rename-btn" data-dialog-id="${escapedId}" title="Rename">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L2 13.59l4.12-1.36.22-.16L14.59 3.82V2.36L13.23 1zM3.84 11.72l.71-2.36 1.65 1.65-2.36.71z"/>
                </svg>
              </button>
              <button class="dialog-action-btn delete-btn" data-dialog-id="${escapedId}" title="Delete">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
      })
      .join('');

    this.dialogsList.innerHTML = html;

    // Attach event listeners
    this.dialogsList.querySelectorAll('.dialog-item').forEach((item) => {
      const dialogId = (item as HTMLElement).dataset.dialogId;
      if (!dialogId) {
        return;
      }

      // Switch dialog on click
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // Don't switch if clicking on action buttons
        if (target.closest('.dialog-action-btn')) {
          return;
        }

        if (dialogId !== this.currentDialogId) {
          this.vscode.postMessage({
            type: WEBVIEW_IN_MSG.SWITCH_DIALOG,
            dialogId,
          });
        }
        this.closeDropdown();
      });
    });

    // Rename buttons
    this.dialogsList.querySelectorAll('.rename-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dialogId = (btn as HTMLElement).dataset.dialogId;
        if (dialogId) {
          this.handleRenameDialog(dialogId);
        }
      });
    });

    // Delete buttons
    this.dialogsList.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dialogId = (btn as HTMLElement).dataset.dialogId;
        if (dialogId) {
          this.handleDeleteDialog(dialogId);
        }
      });
    });
  }

  private handleRenameDialog(dialogId: string): void {
    const dialog = this.dialogs.find((d) => d.id === dialogId);
    if (!dialog) {
      return;
    }

    // Find elements
    const dialogItem = this.dialogsList.querySelector(`[data-dialog-id="${dialogId}"]`) as HTMLElement;
    if (!dialogItem) {
      return;
    }

    const leftElement = dialogItem.querySelector('.dialog-item-left') as HTMLElement;
    const rightElement = dialogItem.querySelector('.dialog-item-right') as HTMLElement;

    if (!leftElement || !rightElement) {
      return;
    }

    const currentTitle = dialog.title || '';

    // Save original HTML
    const originalLeftHTML = leftElement.innerHTML;
    const originalRightHTML = rightElement.innerHTML;

    // Replace with input and edit buttons
    leftElement.innerHTML = `<input type="text" class="dialog-title-input" value="${escapeHtml(currentTitle)}" />`;

    rightElement.innerHTML = `
      <button class="dialog-action-btn save-btn" title="Save">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M14 3L5 12 2 9l1-1 2 2 8-8z"/>
        </svg>
      </button>
      <button class="dialog-action-btn cancel-btn" title="Cancel">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
        </svg>
      </button>
    `;

    const input = leftElement.querySelector('input') as HTMLInputElement;
    const saveBtn = rightElement.querySelector('.save-btn') as HTMLButtonElement;
    const cancelBtn = rightElement.querySelector('.cancel-btn') as HTMLButtonElement;

    input.focus();
    input.select();

    const finishEdit = () => {
      leftElement.innerHTML = originalLeftHTML;
      rightElement.innerHTML = originalRightHTML;
      // Re-render to restore event listeners
      this.renderDialogsList();
    };

    const saveTitle = () => {
      const newTitle = input.value.trim();

      if (newTitle && newTitle !== currentTitle) {
        this.vscode.postMessage({
          type: WEBVIEW_IN_MSG.RENAME_DIALOG,
          dialogId,
          title: newTitle,
        });
      }

      finishEdit();
    };

    const cancelEdit = () => {
      finishEdit();
    };

    // Save button
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveTitle();
    });

    // Cancel button
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelEdit();
    });

    // Save on Enter, cancel on Escape
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveTitle();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // Prevent item click when editing
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  private handleDeleteDialog(dialogId: string): void {
    const dialog = this.dialogs.find((d) => d.id === dialogId);
    if (!dialog) {
      return;
    }

    // Send request to extension to show confirmation dialog
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.DELETE_DIALOG_CONFIRM,
      dialogId,
      title: dialog.title || 'New dialog',
    });
    this.closeDropdown();
  }

  private formatDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 minute
    if (diff < 60 * 1000) {
      return 'just now';
    }

    // Less than 1 hour
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000));
      return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
    }

    // Less than 24 hours
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }

    // Less than 7 days
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }

    // Format as date
    return date.toLocaleDateString();
  }
}
