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
      const headerTitleElement = document.getElementById('dialogTitleText')!;

      dialogsUI.updateDialogs(dialogs, 'dlg1');

      expect(headerTitleElement.textContent).toBe('Active Dialog');
    });

    it('shows "New dialog" in header when no title', () => {
      const dialogs = [mkDialog('dlg1', null, '2025-01-01T12:00:00Z')];
      const headerTitleElement = document.getElementById('dialogTitleText')!;

      dialogsUI.updateDialogs(dialogs, 'dlg1');

      expect(headerTitleElement.textContent).toBe('New dialog');
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

  describe('dropdown opening', () => {
    it('opens dropdown when clicking title button', () => {
      const titleBtn = document.getElementById('dialogTitleBtn')!;
      const dropdown = document.getElementById('dialogDropdown')!;

      expect(dropdown.style.display).toBe('none');

      titleBtn.click();

      expect(dropdown.style.display).toBe('block');
      expect(vscode.postMessage).toHaveBeenCalledWith({type: WEBVIEW_IN_MSG.LOAD_DIALOGS});
    });

    it('closes dropdown when clicking title button again', () => {
      const titleBtn = document.getElementById('dialogTitleBtn')!;
      const dropdown = document.getElementById('dialogDropdown')!;

      titleBtn.click(); // Open
      expect(dropdown.style.display).toBe('block');

      titleBtn.click(); // Close
      expect(dropdown.style.display).toBe('none');
    });

    it('closes dropdown when clicking outside', () => {
      const titleBtn = document.getElementById('dialogTitleBtn')!;
      const dropdown = document.getElementById('dialogDropdown')!;

      titleBtn.click(); // Open
      expect(dropdown.style.display).toBe('block');

      document.body.click(); // Click outside
      expect(dropdown.style.display).toBe('none');
    });

    it('does not close when clicking inside dropdown', () => {
      const titleBtn = document.getElementById('dialogTitleBtn')!;
      const dropdown = document.getElementById('dialogDropdown')!;

      titleBtn.click(); // Open
      dropdown.click(); // Click inside

      expect(dropdown.style.display).toBe('block');
    });
  });

  describe('inline editing', () => {
    beforeEach(() => {
      const dialogs = [mkDialog('dlg1', 'Original Title', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, null);
    });

    it('replaces title with input when clicking rename button', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const input = container.querySelector('.dialog-title-input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('Original Title');
    });

    it('shows save and cancel buttons when editing', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const saveBtn = container.querySelector('.save-btn');
      const cancelBtn = container.querySelector('.cancel-btn');

      expect(saveBtn).toBeTruthy();
      expect(cancelBtn).toBeTruthy();
    });

    it('sends RENAME_DIALOG message when clicking save with new title', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const input = container.querySelector('.dialog-title-input') as HTMLInputElement;
      input.value = 'New Title';

      const saveBtn = container.querySelector('.save-btn') as HTMLButtonElement;
      saveBtn.click();

      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RENAME_DIALOG,
        dialogId: 'dlg1',
        title: 'New Title',
      });
    });

    it('does not send message when saving without changes', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const saveBtn = container.querySelector('.save-btn') as HTMLButtonElement;
      saveBtn.click();

      expect(vscode.postMessage).not.toHaveBeenCalled();
    });

    it('restores original content when clicking cancel', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const input = container.querySelector('.dialog-title-input') as HTMLInputElement;
      input.value = 'Changed';

      const cancelBtn = container.querySelector('.cancel-btn') as HTMLButtonElement;
      cancelBtn.click();

      // Should restore original title
      const title = container.querySelector('.dialog-item-title');
      expect(title?.textContent).toBe('Original Title');
      expect(container.querySelector('.dialog-title-input')).toBeNull();
    });

    it('saves on Enter key', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const input = container.querySelector('.dialog-title-input') as HTMLInputElement;
      input.value = 'Enter Title';

      const enterEvent = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true});
      input.dispatchEvent(enterEvent);

      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RENAME_DIALOG,
        dialogId: 'dlg1',
        title: 'Enter Title',
      });
    });

    it('cancels on Escape key', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const input = container.querySelector('.dialog-title-input') as HTMLInputElement;
      input.value = 'Changed';

      const escapeEvent = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true});
      input.dispatchEvent(escapeEvent);

      // Should restore original title without sending message
      expect(vscode.postMessage).not.toHaveBeenCalled();
      const title = container.querySelector('.dialog-item-title');
      expect(title?.textContent).toBe('Original Title');
    });

    it('restores event listeners after editing', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const saveBtn = container.querySelector('.save-btn') as HTMLButtonElement;
      saveBtn.click();

      // After save, rename button should be clickable again
      const newRenameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      expect(newRenameBtn).toBeTruthy();

      // Verify it's a fresh element by clicking it
      (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
      newRenameBtn.click();

      const input = container.querySelector('.dialog-title-input');
      expect(input).toBeTruthy(); // Should enter edit mode again
    });

    it('uses grid layout for left and right sections', () => {
      const leftElement = container.querySelector('.dialog-item-left');
      const rightElement = container.querySelector('.dialog-item-right');

      expect(leftElement).toBeTruthy();
      expect(rightElement).toBeTruthy();
    });

    it('handles special characters in title', () => {
      const dialogs = [mkDialog('dlg1', 'Title with "quotes" & <tags>', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, null);

      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const input = container.querySelector('.dialog-title-input') as HTMLInputElement;
      // escapeHtml should properly escape the value
      expect(input.value).toBe('Title with "quotes" & <tags>');
    });

    it('does not send rename message with empty title', () => {
      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      const input = container.querySelector('.dialog-title-input') as HTMLInputElement;
      input.value = '   '; // Only whitespace

      const saveBtn = container.querySelector('.save-btn') as HTMLButtonElement;
      saveBtn.click();

      expect(vscode.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('UI layout', () => {
    it('renders left and right sections', () => {
      const dialogs = [mkDialog('dlg1', 'Test', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, null);

      const left = container.querySelector('.dialog-item-left');
      const right = container.querySelector('.dialog-item-right');

      expect(left).toBeTruthy();
      expect(right).toBeTruthy();
    });

    it('shows meta in right section by default', () => {
      const dialogs = [mkDialog('dlg1', 'Test', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, null);

      const right = container.querySelector('.dialog-item-right');
      const meta = right?.querySelector('.dialog-item-meta');
      const actions = right?.querySelector('.dialog-item-actions');

      expect(meta).toBeTruthy();
      expect(actions).toBeTruthy();
    });

    it('replaces both left and right sections when editing', () => {
      const dialogs = [mkDialog('dlg1', 'Test', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, null);

      const renameBtn = container.querySelector('.rename-btn') as HTMLButtonElement;
      renameBtn.click();

      // Left should have input
      const left = container.querySelector('.dialog-item-left');
      const input = left?.querySelector('.dialog-title-input');
      expect(input).toBeTruthy();

      // Right should have save/cancel buttons
      const right = container.querySelector('.dialog-item-right');
      const saveBtn = right?.querySelector('.save-btn');
      const cancelBtn = right?.querySelector('.cancel-btn');
      expect(saveBtn).toBeTruthy();
      expect(cancelBtn).toBeTruthy();

      // Meta and old actions should be gone
      expect(right?.querySelector('.dialog-item-meta')).toBeNull();
      expect(right?.querySelector('.rename-btn')).toBeNull();
    });
  });

  describe('hover behavior', () => {
    it('meta and actions are in same location', () => {
      const dialogs = [mkDialog('dlg1', 'Test', '2025-01-01T12:00:00Z')];
      dialogsUI.updateDialogs(dialogs, null);

      const meta = container.querySelector('.dialog-item-meta') as HTMLElement;
      const actions = container.querySelector('.dialog-item-actions') as HTMLElement;

      // Both should be in the right section
      const right = container.querySelector('.dialog-item-right');
      expect(right?.contains(meta)).toBe(true);
      expect(right?.contains(actions)).toBe(true);
    });
  });

  describe('responsive design', () => {
    it('dialog items render with short and long titles', () => {
      const shortDialog = mkDialog('s', 'A', '2025-01-01T12:00:00Z');
      const longDialog = mkDialog('l', 'Very long dialog title that exceeds normal width', '2025-01-01T12:00:00Z');

      dialogsUI.updateDialogs([shortDialog, longDialog], null);

      const items = container.querySelectorAll('.dialog-item');
      expect(items).toHaveLength(2);

      // Both should render properly
      const titles = container.querySelectorAll('.dialog-item-title');
      expect(titles[0].textContent).toBe('A');
      expect(titles[1].textContent).toContain('Very long');
    });

    it('very long dialog titles have truncation class', () => {
      const veryLongTitle = 'A'.repeat(200);
      const dialogs = [mkDialog('dlg1', veryLongTitle, '2025-01-01T12:00:00Z')];

      dialogsUI.updateDialogs(dialogs, null);

      const title = container.querySelector('.dialog-item-title') as HTMLElement;

      // Should have class that applies overflow and ellipsis
      expect(title.classList.contains('dialog-item-title')).toBe(true);
      expect(title.textContent).toBe(veryLongTitle);
    });

    it('header updates with current dialog title', () => {
      const dialogs = [mkDialog('dlg1', 'Active Dialog', '2025-01-01T12:00:00Z')];

      dialogsUI.updateDialogs(dialogs, 'dlg1');

      const headerTitle = document.getElementById('dialogTitleText')!;
      expect(headerTitle.textContent).toBe('Active Dialog');
    });

    it('header shows fallback for dialog without title', () => {
      const dialogs = [mkDialog('dlg1', null, '2025-01-01T12:00:00Z')];

      dialogsUI.updateDialogs(dialogs, 'dlg1');

      const headerTitle = document.getElementById('dialogTitleText')!;
      expect(headerTitle.textContent).toBe('New dialog');
    });
  });

  describe('overflow detection', () => {
    it('adds overflowing class when text is too long', () => {
      const headerTitle = document.getElementById('dialogTitleText')!;

      // Mock scrollWidth > clientWidth
      Object.defineProperty(headerTitle, 'scrollWidth', {value: 500, configurable: true});
      Object.defineProperty(headerTitle, 'clientWidth', {value: 200, configurable: true});

      dialogsUI.updateCurrentDialog('dlg1', 'Very long title that overflows');

      expect(headerTitle.classList.contains('overflowing')).toBe(true);
    });

    it('does not add overflowing class when text fits', () => {
      const headerTitle = document.getElementById('dialogTitleText')!;

      // Mock scrollWidth <= clientWidth
      Object.defineProperty(headerTitle, 'scrollWidth', {value: 100, configurable: true});
      Object.defineProperty(headerTitle, 'clientWidth', {value: 200, configurable: true});

      dialogsUI.updateCurrentDialog('dlg1', 'Short');

      expect(headerTitle.classList.contains('overflowing')).toBe(false);
    });

    it('removes overflowing class when switching to shorter title', () => {
      const headerTitle = document.getElementById('dialogTitleText')!;

      // First: long title
      Object.defineProperty(headerTitle, 'scrollWidth', {value: 500, configurable: true});
      Object.defineProperty(headerTitle, 'clientWidth', {value: 200, configurable: true});
      dialogsUI.updateCurrentDialog('dlg1', 'Very long title');
      expect(headerTitle.classList.contains('overflowing')).toBe(true);

      // Then: short title
      Object.defineProperty(headerTitle, 'scrollWidth', {value: 50, configurable: true});
      dialogsUI.updateCurrentDialog('dlg2', 'Short');
      expect(headerTitle.classList.contains('overflowing')).toBe(false);
    });
  });
});
