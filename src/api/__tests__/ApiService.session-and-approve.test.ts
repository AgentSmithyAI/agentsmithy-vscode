import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ApiService} from '../ApiService';

describe('ApiService - Session status and approve', () => {
  let apiService: ApiService;
  const baseUrl = 'http://localhost:8765';
  const testDialogId = 'dialog-42';

  beforeEach(() => {
    apiService = new ApiService(baseUrl);
    global.fetch = vi.fn();
  });

  describe('getSessionStatus', () => {
    it('returns normalized session status on success', async () => {
      const mockResponse = {
        active_session: 'sess-1',
        session_ref: 'refs/heads/feature-x',
        has_unapproved: true,
        last_approved_at: '2024-01-01T00:00:00Z',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await apiService.getSessionStatus(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/session`, {
        headers: {Accept: 'application/json'},
      });
      expect(res).toEqual({
        active_session: 'sess-1',
        session_ref: 'refs/heads/feature-x',
        has_unapproved: true,
        last_approved_at: '2024-01-01T00:00:00Z',
      });
    });

    it('throws on HTTP error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok: false, status: 500});
      await expect(apiService.getSessionStatus(testDialogId)).rejects.toThrow('HTTP error! status: 500');
    });

    it('throws on malformed body', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok: true, json: async () => null});
      await expect(apiService.getSessionStatus(testDialogId)).rejects.toThrow('Malformed session status response');
    });
  });

  describe('approveSession', () => {
    it('posts approve and normalizes response', async () => {
      const mockResponse = {
        approved_commit: 'abc123',
        new_session: 'sess-2',
        commits_approved: 7,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await apiService.approveSession(testDialogId, 'Looks good');

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/approve`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({message: 'Looks good'}),
      });
      expect(res).toEqual(mockResponse);
    });

    it('throws on HTTP error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok: false, status: 404});
      await expect(apiService.approveSession(testDialogId)).rejects.toThrow('HTTP error! status: 404');
    });

    it('throws on malformed body', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok: true, json: async () => 'nope'});
      await expect(apiService.approveSession(testDialogId)).rejects.toThrow('Malformed approve response');
    });
  });
});
