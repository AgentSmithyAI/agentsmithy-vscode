/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {WEBVIEW_IN_MSG} from '../../../shared/messages';
import {DialogsUI} from '../DialogsUI';
import type {VSCodeAPI} from '../types';

const mkDialog = (id: string, title: string | null, updated_at: string) => ({
  id,
  title,
  updated_at,
});

const createMockVSCodeAPI = (): VSCodeAPI => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
});

describe('DialogsUI', () => {
  let vscode: VSCodeAPI;
  let dialogsUI: DialogsUI;
  let container: HTMLElement;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="dialogTitleBtn"></div>
      <div id="dialogTitleText">New dialog</div>
      <div id="dialogDropdown" style="display: none;">
        <div id="dialogsList"></div>
      </div>
      <div id="newDialogBtn"></div>
    `;

    vscode = createMockVSCodeAPI();
    dialogsUI = new DialogsUI(vscode);
    container = document.getElementById('dialogsList')!;
  });

  describe('updateDialogs', () => {
    it('renders dialog list', () => {
      const dialogs = [
        mkDialog('dlg1', 'First Dialog', '2025-01-01T12:00:00Z'),
        mkDialog('dlg2', null, '2025-01-01T11:00:00Z'),
      ];

      dialogsUI.updateDialogs(dialogs, 'dlg1');

      expect(container.querySelectorAll('.dialog-item')).toHaveLength(2);
      expect(container.textContent).toContain('First Dialog');
      expect(container.textContent).toContain('New dialog'); // Fallback for null title
    });

    it('marks active dialog', () => {
      const dialogs = [
        mkDialog('dlg1', 'First', '2025-01-01T12:00:00Z'),
        mkDialog('dlg2', 'Second', '2025-01-01T11:00:00Z'),
      ];

      dialogsUI.updateDialogs(dialogs, 'dlg2');

      const items = container.querySelectorAll('.dialog-item');
      expect(items[0].classList.contains('active')).toBe(false);
      expect(items[1].classList.contains('active')).toBe(true);
    });

    it('shows "No conversations yet" when empty', () => {
      dialogsUI.updateDialogs([], null);

      expect(container.textContent).toContain('No conversations yet');
    });

    it('updates dialog title in header', () => {
      const dialogs = [mkDialog('dlg1', 'Active Dialog', '2025-01-01T12:00:00Z')];
      const titleElement = document.getElementById('dialogTitleText')!;

      dialogsUI.updateDialogs(dialogs, 'dlg1');

      expect(titleElement.textContent).toBe('Active Dialog');
    });

    it('shows "New dialog" in header when no title', () => {
      const dialogs = [mkDialog('dlg1', null, '2025-01-01T12:00:00Z')];
      const titleElement = document.getElementById('dialogTitleText')!;

      dialogsUI.updateDialogs(dialogs, 'dlg1');

      expect(titleElement.textContent).toBe('New dialog');
    });
  });

  describe('showLoading', () => {
    it('shows loading spinner', () => {
      dialogsUI.showLoading();

      expect(container.querySelector('.dialog-spinner')).toBeTruthy();
      expect(container.textContent).toContain('Loading...');
    });
  });

  describe('showError', () => {
    it('shows error message', () => {
      dialogsUI.showError('Failed to load');

      expect(container.querySelector('.dialog-item.error')).toBeTruthy();
      expect(container.textContent).toContain('Failed to load');
    });

    it('escapes HTML in error message', () => {
      dialogsUI.showError('<script>alert("xss")</script>');

      expect(container.innerHTML).not.toContain('<script>');
      expect(container.textContent).toContain('<script>alert("xss")</script>');
    });
  });

  describe('updateCurrentDialog', () => {
    it('updates header title', () => {
      const titleElement = document.getElementById('dialogTitleText')!;

      dialogsUI.updateCurrentDialog('dlg1', 'Updated Title');

      expect(titleElement.textContent).toBe('Updated Title');
    });

    it('uses fallback for empty title', () => {
      const titleElement = document.getElementById('dialogTitleText')!;

      dialogsUI.updateCurrentDialog('dlg1', '');

      expect(titleElement.textContent).toBe('New dialog');
    });
  });

  describe('dialog switching', () => {
    it('sends SWITCH_DIALOG message when clicking non-active dialog', () => {
      const dialogs = [
        mkDialog('dlg1', 'First', '2025-01-01T12:00:00Z'),
        mkDialog('dlg2', 'Second', '2025-01-01T11:00:00Z'),
      ];
      dialogsUI.updateDialogs(dialogs, 'dlg1');

      const secondItem = container.querySelectorAll('.dialog-item')[1] as HTMLElement;
      secondItem.click();

      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.SWITCH_DIALOG,
        dialogId: 'dlg2',
      });
    });

    it('does not send message when clicking active dialog', () => {
      const dialogs = [mkDialog('dlg1', 'First', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, 'dlg1');

      const item = container.querySelector('.dialog-item') as HTMLElement;
      item.click();

      expect(vscode.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('new dialog button', () => {
    it('sends CREATE_DIALOG message', () => {
      const newDialogBtn = document.getElementById('newDialogBtn')!;
      newDialogBtn.click();

      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.CREATE_DIALOG,
      });
    });
  });

  describe('delete dialog', () => {
    it('sends DELETE_DIALOG_CONFIRM message when clicking delete button', () => {
      const dialogs = [mkDialog('dlg1', 'To Delete', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, null);

      const deleteBtn = container.querySelector('.delete-btn') as HTMLButtonElement;
      deleteBtn.click();

      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.DELETE_DIALOG_CONFIRM,
        dialogId: 'dlg1',
        title: 'To Delete',
      });
    });
  });

  describe('date formatting', () => {
    it('formats recent dates relatively', () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const dialogs = [mkDialog('dlg1', 'Recent', fiveMinutesAgo)];

      dialogsUI.updateDialogs(dialogs, null);

      const meta = container.querySelector('.dialog-item-meta')!;
      expect(meta.textContent).toContain('min');
      expect(meta.textContent).toContain('ago');
    });

    it('formats very recent as "just now"', () => {
      const now = new Date().toISOString();
      const dialogs = [mkDialog('dlg1', 'Just Now', now)];

      dialogsUI.updateDialogs(dialogs, null);

      const meta = container.querySelector('.dialog-item-meta')!;
      expect(meta.textContent).toContain('just now');
    });
  });
});
