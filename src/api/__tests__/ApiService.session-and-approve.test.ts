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
        changed_files: [],
      });
    });

    it('normalizes changed_files with is_binary and is_too_large', async () => {
      const mockResponse = {
        active_session: 'sess-1',
        has_unapproved: true,
        changed_files: [
          {
            path: 'image.png',
            status: 'added',
            additions: 0,
            deletions: 0,
            diff: null,
            base_content: null,
            is_binary: true, // Test boolean handling without as any
            is_too_large: false,
          },
          {
            path: 'huge.bin',
            status: 'modified',
            additions: 0,
            deletions: 0,
            diff: null,
            base_content: null,
            is_binary: 1, // Truthy value should convert to true
            is_too_large: 'yes', // Truthy string should convert to true
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await apiService.getSessionStatus(testDialogId);

      expect(res.changed_files).toHaveLength(2);
      expect(res.changed_files[0].is_binary).toBe(true);
      expect(res.changed_files[0].is_too_large).toBe(false);
      expect(res.changed_files[1].is_binary).toBe(true); // 1 -> true
      expect(res.changed_files[1].is_too_large).toBe(true); // 'yes' -> true
    });

    it('handles missing is_binary and is_too_large fields', async () => {
      const mockResponse = {
        active_session: 'sess-1',
        has_unapproved: true,
        changed_files: [
          {
            path: 'file.ts',
            status: 'modified',
            additions: 5,
            deletions: 2,
            diff: 'some diff',
            base_content: 'old content',
            // Missing: is_binary, is_too_large
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await apiService.getSessionStatus(testDialogId);

      expect(res.changed_files).toHaveLength(1);
      // Boolean(undefined) = false
      expect(res.changed_files[0].is_binary).toBe(false);
      expect(res.changed_files[0].is_too_large).toBe(false);
    });

    it('handles changed_files with all fields', async () => {
      const mockResponse = {
        active_session: 'sess-1',
        has_unapproved: true,
        changed_files: [
          {
            path: 'src/main.ts',
            status: 'modified',
            additions: 10,
            deletions: 5,
            diff: '@@ -1,5 +1,10 @@\n...',
            base_content: 'original code',
            is_binary: false,
            is_too_large: false,
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await apiService.getSessionStatus(testDialogId);

      expect(res.changed_files[0]).toEqual({
        path: 'src/main.ts',
        status: 'modified',
        additions: 10,
        deletions: 5,
        diff: '@@ -1,5 +1,10 @@\n...',
        base_content: 'original code',
        is_binary: false,
        is_too_large: false,
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

      const res = await apiService.approveSession(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/approve`, {
        method: 'POST',
        headers: {Accept: 'application/json'},
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
