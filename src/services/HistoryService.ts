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

  private readonly _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(private readonly apiService: ApiService) {}

  /**
   * Explicitly set the cursor to the first visible idx currently rendered in the webview.
   * Useful when the webview prunes old DOM nodes and the next page should be fetched
   * from a more recent boundary instead of an older one.
   */
  setVisibleFirstIdx(idx: number | undefined | null): void {
    const normalized = typeof idx === 'number' ? idx : undefined;
    // Only move the visible floor forward; never regress it.
    const nextVisible =
      normalized === undefined
        ? this._visibleFloor
        : this._visibleFloor === undefined
          ? normalized
          : Math.max(this._visibleFloor, normalized);

    const prevCursor = this._historyCursor;

    if (this._visibleFloor !== nextVisible) {
      this._visibleFloor = nextVisible;
    }

    // Always recompute effective cursor when visible floor is set/invoked,
    // because server cursor might have changed since the last recompute.
    const effective = this._computeEffectiveCursor();
    if (prevCursor !== effective) {
      this._historyCursor = effective;
      this._onDidChangeState.fire();
    }
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
    if (this._historyLoading || !this._historyHasMore || this._historyCursor === undefined) {
      return null;
    }

    this._historyLoading = true;
    this._onDidChangeState.fire();

    try {
      const PAGE_SIZE = 20;
      const before = this._historyCursor;
      const resp = await this.apiService.loadHistory(dialogId, PAGE_SIZE, before);

      const nextFirst = resp.first_idx ?? undefined;
      if (nextFirst !== undefined) {
        this._serverCursor = nextFirst;
      }

      // Cursor for previous page strictly follows server first_idx
      this._historyCursor = nextFirst;
      this._historyHasMore = Boolean(resp.has_more);
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

      if (Array.isArray(list.items) && list.items.length > 0) {
        const sorted = [...list.items].sort(
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
    this._historyHasMore = false;
    this._historyLoading = false;
    this._onDidChangeState.fire();
  }

  private _computeEffectiveCursor(): number | undefined {
    const a = this._serverCursor;
    const b = this._visibleFloor;
    if (a === undefined && b === undefined) return undefined;
    if (a === undefined) return b;
    if (b === undefined) return a;
    // When the webview prunes and advances the visible floor beyond the server cursor,
    // we must re-fetch starting from the NEWER boundary to avoid loading already-pruned items.
    // Therefore choose the newer (higher idx) boundary.
    return Math.max(a, b);
  }
}
