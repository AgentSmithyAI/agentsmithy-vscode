import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ApiService, Dialog} from '../ApiService';

/**
 * Tests for dialog management API methods
 */
describe('ApiService - Dialogs', () => {
  let apiService: ApiService;
  const baseUrl = 'http://localhost:8765';
  const testDialogId = 'dialog-123';

  beforeEach(() => {
    apiService = new ApiService(baseUrl);
    global.fetch = vi.fn();
  });

  describe('getCurrentDialog', () => {
    it('fetches current dialog ID', async () => {
      const mockResponse = {id: testDialogId};

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.getCurrentDialog();

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/current`, {
        headers: {Accept: 'application/json'},
      });
      expect(result.id).toBe(testDialogId);
    });

    it('returns null when no current dialog', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({id: null}),
      });

      const result = await apiService.getCurrentDialog();
      expect(result.id).toBeNull();
    });

    it('returns null on HTTP error (graceful fallback)', async () => {
      // Note: getCurrentDialog has try-catch that returns {id: null} on any error
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await apiService.getCurrentDialog();
      expect(result.id).toBeNull();
    });

    it('returns null on malformed response (graceful fallback)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => 'invalid',
      });

      const result = await apiService.getCurrentDialog();
      expect(result.id).toBeNull();
    });
  });

  describe('listDialogs', () => {
    it('fetches list of all dialogs', async () => {
      const mockDialogs: Dialog[] = [
        {id: 'dlg-1', title: 'First chat', created_at: '2024-01-01', updated_at: '2024-01-02'},
        {id: 'dlg-2', title: null, created_at: '2024-01-03', updated_at: '2024-01-03'},
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({dialogs: mockDialogs, current_dialog_id: 'dlg-1'}),
      });

      const result = await apiService.listDialogs();

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs`, {
        headers: {Accept: 'application/json'},
      });
      expect(result.dialogs).toHaveLength(2);
      expect(result.dialogs[0].title).toBe('First chat');
      expect(result.dialogs[1].title).toBeNull();
      expect(result.current_dialog_id).toBe('dlg-1');
    });

    it('handles empty dialog list', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({dialogs: []}),
      });

      const result = await apiService.listDialogs();
      expect(result.dialogs).toEqual([]);
    });

    it('returns empty list when dialogs field is missing', async () => {
      // API returns object but without dialogs field
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({wrong_field: true}),
      });

      const result = await apiService.listDialogs();
      // Method is defensive - returns empty array instead of throwing
      expect(result.dialogs).toEqual([]);
    });

    it('returns empty list on null response', async () => {
      // listDialogs is defensive - returns empty array instead of throwing
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      const result = await apiService.listDialogs();
      expect(result.dialogs).toEqual([]);
    });
  });

  describe('createDialog', () => {
    it('creates dialog with title', async () => {
      const title = 'My new chat';
      const mockResponse = {
        id: 'new-dialog-123',
        title,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.createDialog(title);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({title}),
      });
      expect(result.id).toBe('new-dialog-123');
      expect(result.title).toBe(title);
    });

    it('creates dialog without title', async () => {
      const mockResponse = {
        id: 'untitled-123',
        title: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.createDialog();

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(result.title).toBeNull();
    });

    it('handles missing fields with defaults', async () => {
      // API might return partial response
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await apiService.createDialog('test');

      // Should use empty strings as defaults for missing fields
      expect(result.id).toBe('');
      expect(result.title).toBeNull();
      expect(result.created_at).toBe('');
      expect(result.updated_at).toBe('');
    });

    it('throws on null response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      await expect(apiService.createDialog('test')).rejects.toThrow('Malformed create dialog response');
    });
  });

  describe('setCurrentDialog', () => {
    it('sets dialog as current', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiService.setCurrentDialog(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/dialogs/current?id=${encodeURIComponent(testDialogId)}`,
        {
          method: 'PATCH',
          headers: {Accept: 'application/json'},
        },
      );
    });

    it('throws on HTTP error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(apiService.setCurrentDialog(testDialogId)).rejects.toThrow('HTTP error! status: 404');
    });
  });

  describe('getDialog', () => {
    it('fetches single dialog by ID', async () => {
      const mockDialog: Dialog = {
        id: testDialogId,
        title: 'Test dialog',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockDialog,
      });

      const result = await apiService.getDialog(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}`, {
        headers: {Accept: 'application/json'},
      });
      expect(result.id).toBe(testDialogId);
      expect(result.title).toBe('Test dialog');
    });

    it('handles missing fields with defaults', async () => {
      // API returns object but missing some fields
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({wrong_structure: true}),
      });

      const result = await apiService.getDialog(testDialogId);
      // Method is defensive - uses empty strings and null as defaults
      expect(result.id).toBe('');
      expect(result.title).toBeNull();
      expect(result.created_at).toBe('');
      expect(result.updated_at).toBe('');
    });

    it('throws on null response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      await expect(apiService.getDialog(testDialogId)).rejects.toThrow('Malformed dialog response');
    });
  });

  describe('updateDialog', () => {
    it('updates dialog title', async () => {
      const newTitle = 'Updated title';
      const mockResponse = {
        id: testDialogId,
        title: newTitle,
        updated_at: '2024-01-03T00:00:00Z',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.updateDialog(testDialogId, {title: newTitle});

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({title: newTitle}),
      });
      expect(result.title).toBe(newTitle);
    });

    it('throws on malformed response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      await expect(apiService.updateDialog(testDialogId, {title: 'test'})).rejects.toThrow(
        'Malformed update dialog response',
      );
    });
  });

  describe('deleteDialog', () => {
    it('deletes dialog successfully', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiService.deleteDialog(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}`, {
        method: 'DELETE',
        headers: {Accept: 'application/json'},
      });
    });

    it('throws on HTTP error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(apiService.deleteDialog(testDialogId)).rejects.toThrow('HTTP error! status: 404');
    });
  });

  describe('loadHistory', () => {
    it('loads history with default parameters', async () => {
      const mockResponse = {
        dialog_id: testDialogId,
        events: [
          {type: 'user', content: 'Hello'},
          {type: 'chat', content: 'Hi there'},
        ],
        total_events: 2,
        has_more: false,
        first_idx: 0,
        last_idx: 1,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.loadHistory(testDialogId);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/history`, {
        headers: {Accept: 'application/json'},
      });
      expect(result.events).toHaveLength(2);
      expect(result.has_more).toBe(false);
    });

    it('loads history with limit and before parameters', async () => {
      const mockResponse = {
        dialog_id: testDialogId,
        events: [],
        total_events: 100,
        has_more: true,
        first_idx: 0,
        last_idx: 19,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await apiService.loadHistory(testDialogId, 20, 50);

      const expectedUrl = new URL(`${baseUrl}/api/dialogs/${encodeURIComponent(testDialogId)}/history`);
      expectedUrl.searchParams.set('limit', '20');
      expectedUrl.searchParams.set('before', '50');

      expect(global.fetch).toHaveBeenCalledWith(expectedUrl.toString(), {
        headers: {Accept: 'application/json'},
      });
    });

    it('throws on malformed response (null or non-object)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      await expect(apiService.loadHistory(testDialogId)).rejects.toThrow('Malformed history response');
    });

    it('handles missing optional fields gracefully', async () => {
      // API might return minimal response
      const mockResponse = {
        dialog_id: testDialogId,
        events: [],
        // Missing: total_events, has_more, first_idx, last_idx
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.loadHistory(testDialogId);

      // Should use sensible defaults
      expect(result.dialog_id).toBe(testDialogId);
      expect(result.events).toEqual([]);
      expect(result.total_events).toBe(0); // Defaults to events.length
      expect(result.has_more).toBe(false); // Boolean(undefined) = false
      expect(result.first_idx).toBeNull();
      expect(result.last_idx).toBeNull();
    });
  });
});
