import {WEBVIEW_IN_MSG} from '../../shared/messages';
import type {VSCodeAPI} from './types';

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

  private dialogTitleBtn: HTMLElement;
  private dialogTitleText: HTMLElement;
  private dialogDropdown: HTMLElement;
  private dialogsList: HTMLElement;
  private newDialogBtn: HTMLElement;

  constructor(private readonly vscode: VSCodeAPI) {
    this.dialogTitleBtn = document.getElementById('dialogTitleBtn')!;
    this.dialogTitleText = document.getElementById('dialogTitleText')!;
    this.dialogDropdown = document.getElementById('dialogDropdown')!;
    this.dialogsList = document.getElementById('dialogsList')!;
    this.newDialogBtn = document.getElementById('newDialogBtn')!;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Toggle dropdown
    this.dialogTitleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // Create new dialog
    this.newDialogBtn.addEventListener('click', () => {
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
    this.renderDialogsList();
    this.updateCurrentDialogTitle();
  }

  /**
   * Update current dialog display
   */
  updateCurrentDialog(dialogId: string | null, title: string): void {
    this.currentDialogId = dialogId;
    this.dialogTitleText.textContent = title || 'New dialog';
    this.renderDialogsList();
  }

  private updateCurrentDialogTitle(): void {
    const currentDialog = this.dialogs.find((d) => d.id === this.currentDialogId);
    this.dialogTitleText.textContent = currentDialog?.title || 'New dialog';
  }

  private renderDialogsList(): void {
    if (this.dialogs.length === 0) {
      this.dialogsList.innerHTML = '<div class="dialog-item loading">No conversations yet</div>';
      return;
    }

    const html = this.dialogs
      .map((dialog) => {
        const isActive = dialog.id === this.currentDialogId;
        const title = this.escapeHtml(dialog.title || 'New dialog');
        const updatedAt = this.formatDate(dialog.updated_at);

        return `
        <div class="dialog-item ${isActive ? 'active' : ''}" data-dialog-id="${dialog.id}">
          <div class="dialog-item-content">
            <div class="dialog-item-title">${title}</div>
            <div class="dialog-item-meta">${updatedAt}</div>
          </div>
          <div class="dialog-item-actions">
            <button class="dialog-action-btn rename-btn" data-dialog-id="${dialog.id}" title="Rename">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L2 13.59l4.12-1.36.22-.16L14.59 3.82V2.36L13.23 1zM3.84 11.72l.71-2.36 1.65 1.65-2.36.71z"/>
              </svg>
            </button>
            <button class="dialog-action-btn delete-btn" data-dialog-id="${dialog.id}" title="Delete">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z"/>
              </svg>
            </button>
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

    const currentTitle = dialog.title || '';
    const newTitle = prompt('Enter new title:', currentTitle);

    if (newTitle !== null && newTitle.trim() !== currentTitle) {
      this.vscode.postMessage({
        type: WEBVIEW_IN_MSG.RENAME_DIALOG,
        dialogId,
        title: newTitle.trim(),
      });
    }
  }

  private handleDeleteDialog(dialogId: string): void {
    const dialog = this.dialogs.find((d) => d.id === dialogId);
    if (!dialog) {
      return;
    }

    const title = dialog.title || 'New dialog';
    const confirmed = confirm(`Delete conversation "${title}"?`);

    if (confirmed) {
      this.vscode.postMessage({
        type: WEBVIEW_IN_MSG.DELETE_DIALOG,
        dialogId,
      });
    }
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

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
