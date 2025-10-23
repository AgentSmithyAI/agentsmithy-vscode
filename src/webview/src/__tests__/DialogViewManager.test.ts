/**
 * @vitest-environment jsdom
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DialogViewManager} from '../DialogViewManager';
import type {VSCodeAPI} from '../types';

const createMockVSCodeAPI = (): VSCodeAPI => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
});

describe('DialogViewManager', () => {
  let vscode: VSCodeAPI;
  let parentContainer: HTMLElement;
  let manager: DialogViewManager;

  beforeEach(() => {
    // Mock scrollIntoView
    HTMLElement.prototype.scrollIntoView = vi.fn();

    vscode = createMockVSCodeAPI();
    parentContainer = document.createElement('div');
    document.body.appendChild(parentContainer);

    manager = new DialogViewManager('/workspace', vscode, parentContainer);
  });

  afterEach(() => {
    manager.destroy();
    document.body.removeChild(parentContainer);
  });

  describe('getOrCreateView', () => {
    it('creates a new view if it does not exist', () => {
      const view = manager.getOrCreateView('dialog-1');
      expect(view).toBeTruthy();
      expect(view.dialogId).toBe('dialog-1');
    });

    it('returns existing view if it already exists', () => {
      const view1 = manager.getOrCreateView('dialog-1');
      const view2 = manager.getOrCreateView('dialog-1');
      expect(view1).toBe(view2);
    });

    it('creates multiple different views', () => {
      const view1 = manager.getOrCreateView('dialog-1');
      const view2 = manager.getOrCreateView('dialog-2');
      expect(view1).not.toBe(view2);
      expect(view1.dialogId).toBe('dialog-1');
      expect(view2.dialogId).toBe('dialog-2');
    });
  });

  describe('getView', () => {
    it('returns undefined for non-existent view', () => {
      const view = manager.getView('non-existent');
      expect(view).toBeUndefined();
    });

    it('returns existing view', () => {
      manager.getOrCreateView('dialog-1');
      const view = manager.getView('dialog-1');
      expect(view).toBeTruthy();
      expect(view?.dialogId).toBe('dialog-1');
    });
  });

  describe('switchToDialog', () => {
    it('switches to a new dialog', () => {
      const view = manager.switchToDialog('dialog-1');
      expect(view.dialogId).toBe('dialog-1');
      expect(view.getIsActive()).toBe(true);
      expect(manager.getActiveDialogId()).toBe('dialog-1');
    });

    it('hides previous dialog when switching', () => {
      const view1 = manager.switchToDialog('dialog-1');
      const view2 = manager.switchToDialog('dialog-2');

      expect(view1.getIsActive()).toBe(false);
      expect(view2.getIsActive()).toBe(true);
    });

    it('updates active view', () => {
      manager.switchToDialog('dialog-1');
      const activeView1 = manager.getActiveView();
      expect(activeView1?.dialogId).toBe('dialog-1');

      manager.switchToDialog('dialog-2');
      const activeView2 = manager.getActiveView();
      expect(activeView2?.dialogId).toBe('dialog-2');
    });
  });

  describe('removeView', () => {
    it('removes a view from memory', () => {
      manager.getOrCreateView('dialog-1');
      expect(manager.isDialogLoaded('dialog-1')).toBe(true);

      manager.removeView('dialog-1');
      expect(manager.isDialogLoaded('dialog-1')).toBe(false);
    });

    it('clears active dialog if removed', () => {
      manager.switchToDialog('dialog-1');
      expect(manager.getActiveDialogId()).toBe('dialog-1');

      manager.removeView('dialog-1');
      expect(manager.getActiveDialogId()).toBeNull();
    });

    it('does nothing if view does not exist', () => {
      expect(() => manager.removeView('non-existent')).not.toThrow();
    });
  });

  describe('getLoadedDialogIds', () => {
    it('returns empty array initially', () => {
      expect(manager.getLoadedDialogIds()).toEqual([]);
    });

    it('returns list of loaded dialog IDs', () => {
      manager.getOrCreateView('dialog-1');
      manager.getOrCreateView('dialog-2');
      manager.getOrCreateView('dialog-3');

      const ids = manager.getLoadedDialogIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('dialog-1');
      expect(ids).toContain('dialog-2');
      expect(ids).toContain('dialog-3');
    });
  });

  describe('cleanupInactiveViews', () => {
    it('keeps active view', () => {
      manager.switchToDialog('dialog-1');
      manager.cleanupInactiveViews();
      expect(manager.isDialogLoaded('dialog-1')).toBe(true);
    });

    it('keeps views with active streams', () => {
      const view = manager.getOrCreateView('dialog-1');
      view.getStreamingState().setProcessing(true, 'dialog-1');

      manager.switchToDialog('dialog-2');
      manager.cleanupInactiveViews();

      expect(manager.isDialogLoaded('dialog-1')).toBe(true);
      expect(manager.isDialogLoaded('dialog-2')).toBe(true);
    });

    it('removes excess inactive views', () => {
      // Create more views than MAX_INACTIVE_VIEWS (3)
      manager.getOrCreateView('dialog-1');
      manager.getOrCreateView('dialog-2');
      manager.getOrCreateView('dialog-3');
      manager.getOrCreateView('dialog-4');
      manager.switchToDialog('dialog-5'); // This becomes active

      // Now we have 4 inactive views and 1 active
      manager.cleanupInactiveViews();

      // Active view should be kept
      expect(manager.isDialogLoaded('dialog-5')).toBe(true);

      // Should have at most 3 inactive + 1 active = 4 total
      const loadedIds = manager.getLoadedDialogIds();
      expect(loadedIds.length).toBeLessThanOrEqual(4);
    });
  });

  describe('destroy', () => {
    it('destroys all views', () => {
      manager.getOrCreateView('dialog-1');
      manager.getOrCreateView('dialog-2');

      manager.destroy();

      expect(manager.getLoadedDialogIds()).toEqual([]);
      expect(manager.getActiveDialogId()).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('handles dialog switching during active stream', () => {
      // Start stream in dialog-1
      const view1 = manager.switchToDialog('dialog-1');
      view1.getStreamingState().setProcessing(true, 'dialog-1');
      expect(view1.getIsActive()).toBe(true);
      expect(view1.hasActiveStream()).toBe(true);

      // Switch to dialog-2 while dialog-1 is streaming
      const view2 = manager.switchToDialog('dialog-2');
      expect(view1.getIsActive()).toBe(false);
      expect(view2.getIsActive()).toBe(true);
      expect(view1.hasActiveStream()).toBe(true); // Stream continues in background

      // Switch back to dialog-1
      manager.switchToDialog('dialog-1');
      expect(view1.getIsActive()).toBe(true);
      expect(view1.hasActiveStream()).toBe(true);
    });

    it('preserves dialog state when switching away and back', () => {
      const view1 = manager.switchToDialog('dialog-1');
      const renderer1 = view1.getRenderer();

      // Add a message
      renderer1.addMessage('user', 'Test message');

      // Switch to another dialog
      manager.switchToDialog('dialog-2');

      // Switch back
      manager.switchToDialog('dialog-1');

      // Check that message is still there
      const messagesContainer = view1.container.querySelector('.messages');
      expect(messagesContainer?.textContent).toContain('Test message');
    });

    it('creates view on first access even without switch', () => {
      const view = manager.getOrCreateView('dialog-1');
      expect(view).toBeTruthy();
      expect(view.dialogId).toBe('dialog-1');
      expect(view.getIsActive()).toBe(false); // Not shown until switched
      expect(manager.isDialogLoaded('dialog-1')).toBe(true);
    });
  });
});
