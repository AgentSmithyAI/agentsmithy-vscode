import {beforeEach, describe, expect, it, vi} from 'vitest';
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

// Helper to create mock API service
const createMockApiService = () => {
  return {
    loadHistory: vi.fn<Parameters<ApiService['loadHistory']>, ReturnType<ApiService['loadHistory']>>(),
    getCurrentDialog: vi.fn<Parameters<ApiService['getCurrentDialog']>, ReturnType<ApiService['getCurrentDialog']>>(
      async () => ({id: null}),
    ),
    listDialogs: vi.fn<Parameters<ApiService['listDialogs']>, ReturnType<ApiService['listDialogs']>>(async () => ({
      items: [],
    })),
  } as Pick<ApiService, 'loadHistory' | 'getCurrentDialog' | 'listDialogs'>;
};

describe('HistoryService cursor logic', () => {
  let api: ReturnType<typeof createMockApiService>;
  let svc: HistoryService;

  beforeEach(() => {
    api = createMockApiService();
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

  it('moves cursor forward when visible first idx advances after pruning', async () => {
    // Load latest -> snapshot latestFirstIdx=500
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 500, has_more: true}));
    await svc.loadLatest('dlg');

    // Load older chunk -> cursor becomes 450
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 450, has_more: true}));
    await svc.loadPrevious('dlg');

    // Pruning removes that chunk, visible idx jumps forward
    svc.setVisibleFirstIdx(505);
    expect((svc as any)._historyCursor).toBe(505);
    expect(svc.hasMore).toBe(true);

    // Next load should use the new boundary (505)
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 400, has_more: false}));
    await svc.loadPrevious('dlg');
    expect(api.loadHistory).toHaveBeenLastCalledWith('dlg', 20, 505);
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

  it('updates cursor forward and re-enables history loading when visible first idx increases', async () => {
    // Step 1: Load latest history (indices 480+)
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 480, has_more: true}));
    await svc.loadLatest('dlg');

    // Step 2: Load previous chunk that reaches the very top (server says no more)
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 16, has_more: false}));
    await svc.loadPrevious('dlg');
    expect((svc as any)._historyCursor).toBe(16);
    // hasMore should still be true (cursor >= exhaustedBefore allows one more try)
    expect(svc.hasMore).toBe(true);

    // Step 3: Webview prunes that chunk and reports new first idx (146)
    svc.setVisibleFirstIdx(146);

    expect((svc as any)._historyCursor).toBe(146);
    expect(svc.hasMore).toBe(true);

    // Step 4: User scrolls back up -> should trigger another load from 146
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 16, has_more: false}));
    const result = await svc.loadPrevious('dlg');
    expect(result).not.toBeNull();
    expect(api.loadHistory).toHaveBeenLastCalledWith('dlg', 20, 146);
  });

  it('restores latest snapshot when visible first idx returns to latest boundary', async () => {
    // Load latest page
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 480, has_more: true}));
    await svc.loadLatest('dlg');

    // Load previous chunk to move cursor back
    api.loadHistory.mockResolvedValueOnce(mkHistoryResp({first_idx: 200, has_more: true}));
    await svc.loadPrevious('dlg');

    // Pruning removes that chunk, so visible idx jumps forward
    svc.setVisibleFirstIdx(300);
    expect((svc as any)._historyCursor).toBe(300);
    expect(svc.hasMore).toBe(true);

    // When visible idx reaches the latest boundary, cursor snaps back to latest snapshot
    svc.setVisibleFirstIdx(480);
    expect((svc as any)._historyCursor).toBe(480);
    expect(svc.hasMore).toBe(true);
  });
});
