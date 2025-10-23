/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DialogView} from '../DialogView';
import type {VSCodeAPI} from '../types';

const createMockVSCodeAPI = (): VSCodeAPI => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
});

describe('DialogView', () => {
  let vscode: VSCodeAPI;
  let parentContainer: HTMLElement;
  let dialogView: DialogView;

  beforeEach(() => {
    vscode = createMockVSCodeAPI();
    parentContainer = document.createElement('div');
    document.body.appendChild(parentContainer);

    dialogView = new DialogView('test-dialog-id', '/workspace', vscode, parentContainer);
  });

  describe('constructor', () => {
    it('creates a dialog view with correct dialog ID', () => {
      expect(dialogView.dialogId).toBe('test-dialog-id');
    });

    it('creates a DOM container', () => {
      expect(dialogView.container).toBeTruthy();
      expect(dialogView.container.dataset.dialogId).toBe('test-dialog-id');
    });

    it('is hidden by default', () => {
      expect(dialogView.container.style.display).toBe('none');
      expect(dialogView.getIsActive()).toBe(false);
    });

    it('creates messages container inside dialog container', () => {
      const messagesContainer = dialogView.container.querySelector('.messages');
      expect(messagesContainer).toBeTruthy();
    });

    it('appends container to parent', () => {
      expect(parentContainer.contains(dialogView.container)).toBe(true);
    });
  });

  describe('show/hide', () => {
    it('shows the dialog view', () => {
      dialogView.show();
      expect(dialogView.container.style.display).toBe('block');
      expect(dialogView.getIsActive()).toBe(true);
    });

    it('hides the dialog view', () => {
      dialogView.show();
      dialogView.hide();
      expect(dialogView.container.style.display).toBe('none');
      expect(dialogView.getIsActive()).toBe(false);
    });
  });

  describe('managers', () => {
    it('provides access to renderer', () => {
      const renderer = dialogView.getRenderer();
      expect(renderer).toBeTruthy();
    });

    it('provides access to scroll manager', () => {
      const scrollManager = dialogView.getScrollManager();
      expect(scrollManager).toBeTruthy();
    });

    it('provides access to streaming state', () => {
      const streamingState = dialogView.getStreamingState();
      expect(streamingState).toBeTruthy();
    });
  });

  describe('hasActiveStream', () => {
    it('returns false initially', () => {
      expect(dialogView.hasActiveStream()).toBe(false);
    });

    it('returns true when streaming is active', () => {
      dialogView.getStreamingState().setProcessing(true, 'test-dialog-id');
      expect(dialogView.hasActiveStream()).toBe(true);
    });

    it('returns false after streaming ends', () => {
      dialogView.getStreamingState().setProcessing(true, 'test-dialog-id');
      dialogView.getStreamingState().setProcessing(false);
      expect(dialogView.hasActiveStream()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('removes the container from DOM', () => {
      dialogView.destroy();
      expect(parentContainer.contains(dialogView.container)).toBe(false);
    });
  });
});
