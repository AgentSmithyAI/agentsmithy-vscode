import * as vscode from 'vscode';
import {ApiService, HistoryEvent} from '../api/ApiService';
import {ERROR_MESSAGES} from '../constants';
import {getErrorMessage} from '../utils/typeGuards';

/**
 * Service for managing chat history and pagination
 */
export class HistoryService {
  private _currentDialogId?: string;
  private _historyCursor?: number;
  private _historyHasMore = false;
  private _historyLoading = false;
  // The server-reported first_idx of the topmost loaded page
  private _serverCursor?: number;
  // The first visible user/chat idx currently rendered in the webview (floor)
  private _visibleFloor?: number;
  // Snapshot of the last loadLatest page to allow reset when returning to the latest view
  private _latestFirstIdx?: number;
  private _latestHasMore?: boolean;

  private readonly _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(private readonly apiService: ApiService) {}

  /**
   * Explicitly set the cursor to the first visible idx currently rendered in the webview.
   * If the webview has scrolled back to the latest page (visible >= latest first_idx),
   * reset cursor/hasMore to the latest snapshot so pagination resumes from the top.
   */
  setVisibleFirstIdx(idx: number | undefined | null): void {
    const nextVisible = typeof idx === 'number' ? idx : undefined;
    this._visibleFloor = nextVisible;

    // Minimal guard: only perform reset when clearly at/after latest boundary
    if (nextVisible !== undefined && this._latestFirstIdx !== undefined && nextVisible >= this._latestFirstIdx) {
      this._serverCursor = this._latestFirstIdx;
      this._historyCursor = this._latestFirstIdx;
      this._historyHasMore = Boolean(this._latestHasMore);
    }

    this._onDidChangeState.fire();
  }

  get currentDialogId(): string | undefined {
    return this._currentDialogId;
  }

  set currentDialogId(value: string | undefined) {
    this._currentDialogId = value;
    this._onDidChangeState.fire();
  }

  get hasMore(): boolean {
    return this._historyHasMore;
  }

  get isLoading(): boolean {
    return this._historyLoading;
  }

  /**
   * Load the latest history page
   */
  async loadLatest(dialogId: string): Promise<{events: HistoryEvent[]; hasMore: boolean} | null> {
    if (this._historyLoading) {
      return null;
    }

    this._historyLoading = true;
    this._onDidChangeState.fire();

    try {
      const PAGE_SIZE = 20;
      const resp = await this.apiService.loadHistory(dialogId, PAGE_SIZE);
      this._serverCursor = resp.first_idx ?? undefined;
      // Fresh load resets visible floor; cursor comes directly from server
      this._visibleFloor = undefined;
      this._historyCursor = resp.first_idx ?? undefined;
      this._historyHasMore = Boolean(resp.has_more);
      // Store snapshot of latest page to allow reset when returning to it
      this._latestFirstIdx = resp.first_idx ?? undefined;
      this._latestHasMore = Boolean(resp.has_more);
      this._onDidChangeState.fire();

      return {
        events: resp.events,
        hasMore: Boolean(resp.has_more),
      };
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      throw new Error(msg);
    } finally {
      this._historyLoading = false;
      this._onDidChangeState.fire();
    }
  }

  /**
   * Load previous history page (pagination)
   */
  async loadPrevious(dialogId: string): Promise<{events: HistoryEvent[]; hasMore: boolean} | null> {
    // Trust server pagination; only load when server previously indicated there is more
    const beforeUsed = this._historyCursor;
    if (this._historyLoading || beforeUsed === undefined || !this._historyHasMore) {
      return null;
    }

    this._historyLoading = true;
    this._onDidChangeState.fire();

    try {
      const PAGE_SIZE = 20;
      const resp = await this.apiService.loadHistory(dialogId, PAGE_SIZE, beforeUsed);

      // Update cursors directly from server response
      this._serverCursor = resp.first_idx ?? undefined;
      this._historyCursor = this._serverCursor;
      this._historyHasMore = Boolean(resp.has_more);
      this._onDidChangeState.fire();

      return {
        events: resp.events,
        hasMore: this._historyHasMore,
      };
    } catch (e: unknown) {
      const msg = getErrorMessage(e, ERROR_MESSAGES.LOAD_HISTORY);
      throw new Error(msg);
    } finally {
      this._historyLoading = false;
      this._onDidChangeState.fire();
    }
  }

  /**
   * Get or determine current dialog ID
   */
  async resolveCurrentDialogId(): Promise<string | undefined> {
    if (this._currentDialogId) {
      return this._currentDialogId;
    }

    try {
      const current = await this.apiService.getCurrentDialog();
      if (current.id) {
        this._currentDialogId = current.id;
        return current.id;
      }

      const list = await this.apiService.listDialogs();
      if (list.current_dialog_id) {
        this._currentDialogId = list.current_dialog_id;
        return list.current_dialog_id;
      }

      if (Array.isArray(list.dialogs) && list.dialogs.length > 0) {
        const sorted = [...list.dialogs].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );
        this._currentDialogId = sorted[0].id;
        return sorted[0].id;
      }
    } catch {
      // noop - return undefined
    }

    return undefined;
  }

  reset(): void {
    this._currentDialogId = undefined;
    this._historyCursor = undefined;
    this._serverCursor = undefined;
    this._visibleFloor = undefined;
    this._latestFirstIdx = undefined;
    this._latestHasMore = undefined;
    this._historyHasMore = false;
    this._historyLoading = false;
    this._onDidChangeState.fire();
  }
}
