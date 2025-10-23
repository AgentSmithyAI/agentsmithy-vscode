import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ApiService, Dialog} from '../../api/ApiService';
import {DialogService} from '../DialogService';

const mkDialog = (over: Partial<Dialog>): Dialog => ({
  id: 'dlg1',
  title: 'Test Dialog',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...over,
});

// Helper to create mock API service
const createMockApiService = () => {
  return {
    listDialogs: vi.fn<Parameters<ApiService['listDialogs']>, ReturnType<ApiService['listDialogs']>>(),
    createDialog: vi.fn<Parameters<ApiService['createDialog']>, ReturnType<ApiService['createDialog']>>(),
    setCurrentDialog: vi.fn<Parameters<ApiService['setCurrentDialog']>, ReturnType<ApiService['setCurrentDialog']>>(),
    getDialog: vi.fn<Parameters<ApiService['getDialog']>, ReturnType<ApiService['getDialog']>>(),
    updateDialog: vi.fn<Parameters<ApiService['updateDialog']>, ReturnType<ApiService['updateDialog']>>(),
    deleteDialog: vi.fn<Parameters<ApiService['deleteDialog']>, ReturnType<ApiService['deleteDialog']>>(),
    getCurrentDialog: vi.fn<Parameters<ApiService['getCurrentDialog']>, ReturnType<ApiService['getCurrentDialog']>>(),
  } as Pick<
    ApiService,
    | 'listDialogs'
    | 'createDialog'
    | 'setCurrentDialog'
    | 'getDialog'
    | 'updateDialog'
    | 'deleteDialog'
    | 'getCurrentDialog'
  >;
};

describe('DialogService', () => {
  let api: ReturnType<typeof createMockApiService>;
  let svc: DialogService;

  beforeEach(() => {
    api = createMockApiService();
    svc = new DialogService(api as unknown as ApiService);
  });

  describe('getDialogDisplayTitle', () => {
    it('returns "New dialog" for null', () => {
      expect(svc.getDialogDisplayTitle(null)).toBe('New dialog');
    });

    it('returns "New dialog" for dialog without title', () => {
      expect(svc.getDialogDisplayTitle(mkDialog({title: null}))).toBe('New dialog');
    });

    it('returns title when present', () => {
      expect(svc.getDialogDisplayTitle(mkDialog({title: 'My Dialog'}))).toBe('My Dialog');
    });
  });

  describe('loadDialogs', () => {
    it('loads and caches dialogs from API', async () => {
      const dialogs = [mkDialog({id: 'dlg1'}), mkDialog({id: 'dlg2', title: null})];
      api.listDialogs.mockResolvedValue({dialogs: dialogs, current_dialog_id: 'dlg1'});

      await svc.loadDialogs();

      expect(svc.dialogs).toEqual(dialogs);
      expect(svc.currentDialogId).toBe('dlg1');
    });

    it('fires change event after loading', async () => {
      const listener = vi.fn();
      svc.onDidChangeDialogs(listener);

      api.listDialogs.mockResolvedValue({dialogs: [], current_dialog_id: undefined});
      await svc.loadDialogs();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('createDialog', () => {
    it('creates dialog and adds to cache', async () => {
      const created = mkDialog({id: 'new-dlg', title: 'New'});
      api.createDialog.mockResolvedValue(created);

      const listener = vi.fn();
      svc.onDidChangeDialogs(listener);

      const result = await svc.createDialog('New');

      expect(api.createDialog).toHaveBeenCalledWith('New');
      expect(result).toEqual(created);
      expect(svc.dialogs).toHaveLength(1);
      expect(svc.dialogs[0]).toMatchObject({id: 'new-dlg', title: 'New'}); // Added at beginning
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('creates dialog without title', async () => {
      const created = mkDialog({id: 'new-dlg', title: null});
      api.createDialog.mockResolvedValue(created);

      await svc.createDialog();

      expect(api.createDialog).toHaveBeenCalledWith(undefined);
    });
  });

  describe('switchDialog', () => {
    it('switches current dialog', async () => {
      api.setCurrentDialog.mockResolvedValue(undefined);

      const listener = vi.fn();
      svc.onDidChangeDialogs(listener);

      await svc.switchDialog('dlg2');

      expect(api.setCurrentDialog).toHaveBeenCalledWith('dlg2');
      expect(svc.currentDialogId).toBe('dlg2');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateDialog', () => {
    it('updates dialog in cache', async () => {
      const dialogs = [mkDialog({id: 'dlg1', title: 'Old'}), mkDialog({id: 'dlg2'})];
      api.listDialogs.mockResolvedValue({dialogs: dialogs});
      await svc.loadDialogs();

      api.updateDialog.mockResolvedValue({
        id: 'dlg1',
        title: 'Updated',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const listener = vi.fn();
      svc.onDidChangeDialogs(listener);

      await svc.updateDialog('dlg1', {title: 'Updated'});

      expect(api.updateDialog).toHaveBeenCalledWith('dlg1', {title: 'Updated'});
      expect(svc.dialogs[0].title).toBe('Updated');
      expect(svc.dialogs[0].updated_at).toBe('2025-01-02T00:00:00Z');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not fire event if dialog not in cache', async () => {
      api.updateDialog.mockResolvedValue({
        id: 'non-existent',
        title: 'Updated',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const listener = vi.fn();
      svc.onDidChangeDialogs(listener);

      await svc.updateDialog('non-existent', {title: 'Updated'});

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('deleteDialog', () => {
    it('deletes dialog from cache', async () => {
      const dialogs = [mkDialog({id: 'dlg1'}), mkDialog({id: 'dlg2'})];
      api.listDialogs.mockResolvedValue({dialogs: dialogs});
      await svc.loadDialogs();

      api.deleteDialog.mockResolvedValue(undefined);

      const listener = vi.fn();
      svc.onDidChangeDialogs(listener);

      await svc.deleteDialog('dlg1');

      expect(api.deleteDialog).toHaveBeenCalledWith('dlg1');
      expect(svc.dialogs).toHaveLength(1);
      expect(svc.dialogs[0].id).toBe('dlg2');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('clears currentDialogId if deleted dialog was current', async () => {
      const dialogs = [mkDialog({id: 'dlg1'})];
      api.listDialogs.mockResolvedValue({dialogs: dialogs, current_dialog_id: 'dlg1'});
      await svc.loadDialogs();

      api.deleteDialog.mockResolvedValue(undefined);

      await svc.deleteDialog('dlg1');

      expect(svc.currentDialogId).toBeNull();
    });
  });

  describe('currentDialog', () => {
    it('returns null when no current dialog', () => {
      expect(svc.currentDialog).toBeNull();
    });

    it('returns current dialog from cache', async () => {
      const dialogs = [mkDialog({id: 'dlg1'}), mkDialog({id: 'dlg2'})];
      api.listDialogs.mockResolvedValue({dialogs: dialogs, current_dialog_id: 'dlg2'});
      await svc.loadDialogs();

      expect(svc.currentDialog?.id).toBe('dlg2');
    });

    it('returns null if current dialog not in cache', async () => {
      const dialogs = [mkDialog({id: 'dlg1'})];
      api.listDialogs.mockResolvedValue({dialogs: dialogs, current_dialog_id: 'non-existent'});
      await svc.loadDialogs();

      expect(svc.currentDialog).toBeNull();
    });
  });

  describe('ensureCurrentDialog', () => {
    it('returns cached currentDialogId if present', async () => {
      svc.setCurrentDialogId('dlg1');

      const result = await svc.ensureCurrentDialog();

      expect(result).toBe('dlg1');
      expect(api.getCurrentDialog).not.toHaveBeenCalled();
    });

    it('fetches from API if no cached currentDialogId', async () => {
      api.getCurrentDialog.mockResolvedValue({id: 'dlg2'});

      const result = await svc.ensureCurrentDialog();

      expect(api.getCurrentDialog).toHaveBeenCalled();
      expect(result).toBe('dlg2');
      expect(svc.currentDialogId).toBe('dlg2');
    });

    it('returns null if API returns null', async () => {
      api.getCurrentDialog.mockResolvedValue({id: null});

      const result = await svc.ensureCurrentDialog();

      expect(result).toBeNull();
    });
  });
});
