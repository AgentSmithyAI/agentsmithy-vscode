import {beforeEach, describe, expect, it, vi} from 'vitest';

// Minimal vscode mock for EventEmitter used inside HistoryService
vi.mock('vscode', () => {
  class Emitter<T = void> {
    private listeners: Array<(e: T) => unknown> = [];
    event = (listener: (e: T) => unknown) => {
      this.listeners.push(listener);
      return {dispose() {}};
    };
    fire(data: T extends void ? never : T = undefined as never) {
      for (const l of this.listeners) l(data as T);
    }
  }
  return {EventEmitter: Emitter};
});

import type {ApiService, HistoryEvent, HistoryResponse} from '../../api/ApiService';
import {HistoryService} from '../HistoryService';

const mkHistoryResp = (over: Partial<HistoryResponse>): HistoryResponse => ({
  dialog_id: 'dlg',
  events: [],
  total_events: 0,
  has_more: false,
  first_idx: null,
  last_idx: null,
  ...over,
});

describe('HistoryService cursor logic', () => {
  let api: Pick<ApiService, 'loadHistory' | 'getCurrentDialog' | 'listDialogs'> & {
    loadHistory: ReturnType<typeof vi.fn>;
  };
  let svc: HistoryService;

  beforeEach(() => {
    api = {
      loadHistory: vi.fn(),
      getCurrentDialog: vi.fn(async () => ({id: null})),
      listDialogs: vi.fn(async () => ({items: []})),
    };
    svc = new HistoryService(api as unknown as ApiService);
  });

  it('uses server first_idx as cursor and relies on server has_more', async () => {
    // Latest at 300
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 300, has_more: true}));
    await svc.loadLatest('dlg');

    // Previous page from 300 boundary
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 250, has_more: true}));
    await svc.loadPrevious('dlg');
    expect(api.loadHistory).toHaveBeenLastCalledWith('dlg', 20, 300);
  });

  it('sets cursor from loadLatest and respects hasMore', async () => {
    api.loadHistory.mockResolvedValueOnce(
      mkHistoryResp({first_idx: 120, has_more: true, events: [{type: 'user', idx: 120} as HistoryEvent]}),
    );

    const res = await svc.loadLatest('dlg');

    expect(res?.hasMore).toBe(true);
    expect(svc.hasMore).toBe(true);
    // Initial page should not pass `before`
    expect(api.loadHistory).toHaveBeenCalledWith('dlg', 20);
  });

  it('loadPrevious uses current cursor as before', async () => {
    // First call (latest)
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 200, has_more: true}));
    await svc.loadLatest('dlg');

    // Second call (previous)
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 150, has_more: true}));
    await svc.loadPrevious('dlg');

    // Verify that the second call used before=200
    expect(api.loadHistory).toHaveBeenNthCalledWith(2, 'dlg', 20, 200);
  });

  it('advances cursor to the new page first_idx so next request uses older boundary', async () => {
    // Latest -> first_idx 300
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 300, has_more: true}));
    await svc.loadLatest('dlg');

    // Prev page -> first_idx 227
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 227, has_more: true}));
    await svc.loadPrevious('dlg');

    // Next prev page should use before=227 (boundary of previous page just loaded)
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 180, has_more: true}));
    await svc.loadPrevious('dlg');

    expect(api.loadHistory).toHaveBeenNthCalledWith(3, 'dlg', 20, 227);

    // And after that, the cursor should move further back to 180 so the next request uses 180
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 160, has_more: true}));
    await svc.loadPrevious('dlg');

    expect(api.loadHistory).toHaveBeenNthCalledWith(4, 'dlg', 20, 180);
  });

  it('resets cursor/hasMore when returning to latest via setVisibleFirstIdx', async () => {
    // Load latest -> snapshot latestFirstIdx=500, has_more=true
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 500, has_more: true}));
    await svc.loadLatest('dlg');

    // Go back one page -> cursor becomes 450
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 450, has_more: true}));
    await svc.loadPrevious('dlg');

    // Sanity: next call would use before=450
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 400, has_more: false}));

    // Now emulate returning to latest view by setting visible idx >= latestFirstIdx
    svc.setVisibleFirstIdx(505);

    // After reset, loadPrevious should use the latest boundary (500), not 450
    await svc.loadPrevious('dlg');
    expect(api.loadHistory).toHaveBeenLastCalledWith('dlg', 20, 500);
  });

  it('ignores loadPrevious when already loading or when hasMore=false or cursor is undefined', async () => {
    // Not loaded yet -> cursor undefined
    const res0 = await svc.loadPrevious('dlg');
    expect(res0).toBeNull();

    // Prepare state
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 50, has_more: false}));
    await svc.loadLatest('dlg');

    // hasMore=false -> ignored
    const res1 = await svc.loadPrevious('dlg');
    expect(res1).toBeNull();

    // Set hasMore=true and simulate concurrent call
    // First call enters and we do not await it immediately
    api.loadHistory.mockResolvedValueOnce(
      new Promise<HistoryResponse>((resolve) =>
        setTimeout(() => resolve(mkHistoryResp({first_idx: 40, has_more: true})), 5),
      ),
    );
    // Re-load latest to set hasMore=true
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 50, has_more: true}));
    await svc.loadLatest('dlg');

    const p1 = svc.loadPrevious('dlg');
    const p2 = svc.loadPrevious('dlg');

    const [r1, r2] = await Promise.all([p1, p2]);
    // Second should be ignored due to _historyLoading gate
    expect(r1).not.toBeNull();
    expect(r2).toBeNull();
  });
});
