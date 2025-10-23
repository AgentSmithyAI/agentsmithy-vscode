import * as vscode from 'vscode';
import {ApiService, type Dialog} from '../api/ApiService';

/**
 * Service for managing dialog state and operations
 */
export class DialogService {
  private _dialogs: Dialog[] = [];
  private _currentDialogId: string | null = null;
  private _onDidChangeDialogs = new vscode.EventEmitter<void>();

  public readonly onDidChangeDialogs = this._onDidChangeDialogs.event;

  constructor(private readonly apiService: ApiService) {}

  /**
   * Get all cached dialogs
   */
  get dialogs(): Dialog[] {
    return this._dialogs;
  }

  /**
   * Get current dialog ID
   */
  get currentDialogId(): string | null {
    return this._currentDialogId;
  }

  /**
   * Get current dialog
   */
  get currentDialog(): Dialog | null {
    if (!this._currentDialogId) {
      return null;
    }
    return this._dialogs.find((d) => d.id === this._currentDialogId) ?? null;
  }

  /**
   * Get dialog title for display (fallback to "New dialog" if no title)
   */
  getDialogDisplayTitle = (dialog: Dialog | null): string => {
    if (!dialog) {
      return 'New dialog';
    }
    return dialog.title || 'New dialog';
  };

  /**
   * Load and cache dialogs from server
   */
  async loadDialogs(): Promise<void> {
    const response = await this.apiService.listDialogs();
    this._dialogs = response.dialogs;
    this._currentDialogId = response.current_dialog_id ?? null;
    this._onDidChangeDialogs.fire();
  }

  /**
   * Create a new dialog
   */
  async createDialog(title?: string): Promise<Dialog> {
    const created = await this.apiService.createDialog(title);
    const dialog: Dialog = {
      id: created.id,
      title: created.title,
      created_at: created.created_at,
      updated_at: created.updated_at,
    };

    // Add to cache at the beginning (most recent)
    this._dialogs.unshift(dialog);
    this._onDidChangeDialogs.fire();

    return dialog;
  }

  /**
   * Switch to a different dialog
   */
  async switchDialog(dialogId: string): Promise<void> {
    await this.apiService.setCurrentDialog(dialogId);
    this._currentDialogId = dialogId;
    this._onDidChangeDialogs.fire();
  }

  /**
   * Update dialog (e.g., rename)
   */
  async updateDialog(dialogId: string, updates: {title?: string}): Promise<void> {
    const updated = await this.apiService.updateDialog(dialogId, updates);

    // Update in cache
    const index = this._dialogs.findIndex((d) => d.id === dialogId);
    if (index !== -1) {
      this._dialogs[index] = {
        ...this._dialogs[index],
        title: updated.title,
        updated_at: updated.updated_at,
      };
      this._onDidChangeDialogs.fire();
    }
  }

  /**
   * Delete a dialog
   */
  async deleteDialog(dialogId: string): Promise<void> {
    await this.apiService.deleteDialog(dialogId);

    // Remove from cache
    this._dialogs = this._dialogs.filter((d) => d.id !== dialogId);

    // If deleted dialog was current, clear current
    if (this._currentDialogId === dialogId) {
      this._currentDialogId = null;
    }

    this._onDidChangeDialogs.fire();
  }

  /**
   * Ensure current dialog is set, load from server if needed
   */
  async ensureCurrentDialog(): Promise<string | null> {
    if (this._currentDialogId) {
      return this._currentDialogId;
    }

    const response = await this.apiService.getCurrentDialog();
    this._currentDialogId = response.id;
    return this._currentDialogId;
  }

  /**
   * Set current dialog ID (without API call)
   */
  setCurrentDialogId(dialogId: string | null): void {
    this._currentDialogId = dialogId;
    this._onDidChangeDialogs.fire();
  }
}
