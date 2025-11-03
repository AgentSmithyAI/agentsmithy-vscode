import * as vscode from 'vscode';
import {ApiService, HistoryEvent} from '../api/ApiService';
import {ERROR_MESSAGES, PAGINATION} from '../constants';
import {getErrorMessage} from '../utils/typeGuards';

/**
 * Service for managing chat history and pagination
 */
export class HistoryService {
  private _currentDialogId?: string;
  private _historyCursor?: number;
  private _lastExhaustedBefore?: number;
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
    const prevCursor = this._historyCursor;
    this._visibleFloor = nextVisible;

    const topMovedDown =
      nextVisible !== undefined && prevCursor !== undefined && Number.isFinite(prevCursor) && nextVisible > prevCursor;
    if (topMovedDown) {
      this._serverCursor = nextVisible;
      this._historyCursor = nextVisible;
      this._lastExhaustedBefore = undefined;
    } else if (nextVisible !== undefined && this._latestFirstIdx !== undefined && nextVisible >= this._latestFirstIdx) {
      // User has scrolled back to the latest page; restore cursor to latest snapshot
      this._serverCursor = this._latestFirstIdx;
      this._historyCursor = this._latestFirstIdx;
      this._lastExhaustedBefore = this._latestHasMore ? undefined : this._latestFirstIdx;
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
    if (this._historyCursor === undefined) {
      return false;
    }
    // If we never hit an exhausted boundary, we can always try to load more
    if (this._lastExhaustedBefore === undefined) {
      return true;
    }
    // We can load more if cursor is strictly greater than the exhausted boundary
    // OR if cursor equals boundary but we haven't actually tried loading from there yet
    // (this handles the case where we pruned and moved cursor forward)
    return this._historyCursor >= this._lastExhaustedBefore;
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
      const resp = await this.apiService.loadHistory(dialogId, PAGINATION.DEFAULT_PAGE_SIZE);
      this._serverCursor = resp.first_idx ?? undefined;
      // Fresh load resets visible floor; cursor comes directly from server
      this._visibleFloor = undefined;
      this._historyCursor = resp.first_idx ?? undefined;
      this._lastExhaustedBefore = resp.has_more ? undefined : this._historyCursor;
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
    if (this._historyLoading || beforeUsed === undefined) {
      return null;
    }

    if (this._lastExhaustedBefore !== undefined && beforeUsed <= this._lastExhaustedBefore) {
      return null;
    }

    this._historyLoading = true;
    this._onDidChangeState.fire();

    try {
      const resp = await this.apiService.loadHistory(dialogId, PAGINATION.DEFAULT_PAGE_SIZE, beforeUsed);

      // Update cursors directly from server response
      this._serverCursor = resp.first_idx ?? undefined;
      this._historyCursor = this._serverCursor;
      if (!resp.has_more) {
        this._lastExhaustedBefore = this._historyCursor;
      } else {
        this._lastExhaustedBefore = undefined;
      }
      this._onDidChangeState.fire();

      return {
        events: resp.events,
        hasMore: this._lastExhaustedBefore === undefined,
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
    this._lastExhaustedBefore = undefined;
    this._historyLoading = false;
    this._onDidChangeState.fire();
  }
}
