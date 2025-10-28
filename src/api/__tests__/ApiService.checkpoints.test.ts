import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ApiService} from '../ApiService';

describe('ApiService - Checkpoints', () => {
  let apiService: ApiService;
  const baseUrl = 'http://localhost:8765';
  const testDialogId = 'test-dialog-123';

  beforeEach(() => {
    apiService = new ApiService(baseUrl);
    global.fetch = vi.fn();
  });

  describe('listCheckpoints', () => {
    it('should fetch checkpoints for a dialog', async () => {
      const mockResponse = {
        dialog_id: testDialogId,
        checkpoints: [
          {
            commit_id: 'abc123',
            message: 'Initial snapshot',
          },
          {
            commit_id: 'def456',
            message: 'Transaction: 3 files\nwrite: main.py\nwrite: utils.py\nwrite: test.py',
          },
        ],
        initial_checkpoint: 'abc123',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.listCheckpoints(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/checkpoints`,
        {headers: {Accept: 'application/json'}},
      );
      expect(result.dialog_id).toBe(testDialogId);
      expect(result.checkpoints).toHaveLength(2);
      expect(result.checkpoints[0].commit_id).toBe('abc123');
      expect(result.initial_checkpoint).toBe('abc123');
    });

    it('should handle malformed response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      await expect(apiService.listCheckpoints(testDialogId)).rejects.toThrow('Malformed checkpoints response');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(apiService.listCheckpoints(testDialogId)).rejects.toThrow('HTTP error! status: 404');
    });
  });

  describe('restoreCheckpoint', () => {
    it('should restore to a specific checkpoint', async () => {
      const checkpointId = 'abc123';
      const mockResponse = {
        restored_to: checkpointId,
        new_checkpoint: 'xyz789',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.restoreCheckpoint(testDialogId, checkpointId);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({checkpoint_id: checkpointId}),
      });
      expect(result.restored_to).toBe(checkpointId);
      expect(result.new_checkpoint).toBe('xyz789');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(apiService.restoreCheckpoint(testDialogId, 'abc123')).rejects.toThrow('HTTP error! status: 500');
    });
  });

  describe('resetToApproved', () => {
    it('should reset dialog to approved state', async () => {
      const mockResponse = {
        reset_to: 'abc123',
        new_session: 'xyz789',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.resetToApproved(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/reset`, {
        method: 'POST',
        headers: {Accept: 'application/json'},
      });
      expect(result.reset_to).toBe('abc123');
      expect(result.new_session).toBe('xyz789');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(apiService.resetToApproved(testDialogId)).rejects.toThrow('HTTP error! status: 404');
    });
  });
});
