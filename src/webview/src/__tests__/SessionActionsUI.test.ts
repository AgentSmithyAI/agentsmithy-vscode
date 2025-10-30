/**
 * @vitest-environment jsdom
 */
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {SessionActionsUI} from '../SessionActionsUI';
import {WEBVIEW_IN_MSG} from '../../../shared/messages';
import type {VSCodeAPI} from '../types';

describe('SessionActionsUI', () => {
  let sessionActionsUI: SessionActionsUI;
  let mockVscode: VSCodeAPI;
  let approveBtn: HTMLButtonElement;
  let resetBtn: HTMLButtonElement;

  beforeEach(() => {
    // Create DOM elements
    const panel = document.createElement('div');
    panel.id = 'sessionActions';
    document.body.appendChild(panel);

    approveBtn = document.createElement('button');
    approveBtn.id = 'sessionApproveBtn';
    document.body.appendChild(approveBtn);

    resetBtn = document.createElement('button');
    resetBtn.id = 'sessionResetBtn';
    document.body.appendChild(resetBtn);

    // Create mock VSCode API
    mockVscode = {
      postMessage: vi.fn(),
      getState: vi.fn(),
      setState: vi.fn(),
    };

    sessionActionsUI = new SessionActionsUI(mockVscode);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('button click handling', () => {
    it('should send APPROVE_SESSION message when approve button is clicked', () => {
      const dialogId = 'test-dialog-123';
      sessionActionsUI.setCurrentDialogId(dialogId);
      // Enable actions as backend would when there are unapproved changes
      sessionActionsUI.updateSessionStatus(true);

      approveBtn.click();

      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.APPROVE_SESSION,
        dialogId,
      });
    });

    it('should send RESET_TO_APPROVED message when reset button is clicked', () => {
      const dialogId = 'test-dialog-123';
      sessionActionsUI.setCurrentDialogId(dialogId);
      // Enable actions as backend would when there are unapproved changes
      sessionActionsUI.updateSessionStatus(true);

      resetBtn.click();

      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
        dialogId,
      });
    });

    it('should NOT send message if dialogId is null', () => {
      sessionActionsUI.setCurrentDialogId(null);

      approveBtn.click();
      resetBtn.click();

      expect(mockVscode.postMessage).not.toHaveBeenCalled();
    });

    it('should NOT send message if dialogId was never set', () => {
      // Don't call setCurrentDialogId at all
      approveBtn.click();
      resetBtn.click();

      expect(mockVscode.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('updateSessionStatus', () => {
    beforeEach(() => {
      sessionActionsUI.setCurrentDialogId('test-dialog-123');
    });

    it('should enable buttons when hasUnapproved is true', () => {
      sessionActionsUI.updateSessionStatus(true);

      expect(approveBtn.disabled).toBe(false);
      expect(resetBtn.disabled).toBe(false);
    });

    it('should disable buttons when hasUnapproved is false', () => {
      sessionActionsUI.updateSessionStatus(false);

      expect(approveBtn.disabled).toBe(true);
      expect(resetBtn.disabled).toBe(true);
    });

    it('should re-enable buttons after being disabled', () => {
      // Initially disabled
      sessionActionsUI.updateSessionStatus(false);
      expect(approveBtn.disabled).toBe(true);
      expect(resetBtn.disabled).toBe(true);

      // Then enabled
      sessionActionsUI.updateSessionStatus(true);
      expect(approveBtn.disabled).toBe(false);
      expect(resetBtn.disabled).toBe(false);
    });
  });

  describe('dialog switching race condition', () => {
    it('should handle rapid dialog switches correctly', () => {
      const dialog1 = 'dialog-1';
      const dialog2 = 'dialog-2';
      const dialog3 = 'dialog-3';

      // Rapid switches
      sessionActionsUI.setCurrentDialogId(dialog1);
      sessionActionsUI.setCurrentDialogId(dialog2);
      sessionActionsUI.setCurrentDialogId(dialog3);
      // Enable actions before clicking
      sessionActionsUI.updateSessionStatus(true);

      resetBtn.click();

      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
        dialogId: dialog3, // Should use the latest dialogId
      });
    });

    it('should use correct dialogId even if status updates happen asynchronously', () => {
      const dialogId = 'test-dialog';

      // Set dialog
      sessionActionsUI.setCurrentDialogId(dialogId);

      // Enable buttons
      sessionActionsUI.updateSessionStatus(true);

      // Simulate async status update that disables buttons
      setTimeout(() => {
        sessionActionsUI.updateSessionStatus(false);
      }, 0);

      // Click before async update
      resetBtn.click();

      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
        dialogId,
      });
    });

    it('should allow clicking disabled button if it becomes enabled', async () => {
      const dialogId = 'test-dialog';
      sessionActionsUI.setCurrentDialogId(dialogId);

      // Initially disabled
      sessionActionsUI.updateSessionStatus(false);
      expect(resetBtn.disabled).toBe(true);

      // Try to click - button is disabled so event shouldn't fire
      resetBtn.click();
      expect(mockVscode.postMessage).not.toHaveBeenCalled();

      // Enable
      sessionActionsUI.updateSessionStatus(true);
      expect(resetBtn.disabled).toBe(false);

      // Now click should work
      resetBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
        dialogId,
      });
    });
  });

  describe('reset sequence simulation', () => {
    it('should handle full reset flow: enable -> click -> disable -> re-enable', () => {
      const dialogId = 'test-dialog';

      // 1. Set dialog and enable buttons (has unapproved changes)
      sessionActionsUI.setCurrentDialogId(dialogId);
      sessionActionsUI.updateSessionStatus(true);
      expect(resetBtn.disabled).toBe(false);

      // 2. User clicks reset
      resetBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
        dialogId,
      });

      // 3. After successful reset, server returns clean session -> buttons should be disabled
      sessionActionsUI.updateSessionStatus(false);
      expect(resetBtn.disabled).toBe(true);

      // 4. User makes new changes -> buttons should be enabled again
      sessionActionsUI.updateSessionStatus(true);
      expect(resetBtn.disabled).toBe(false);

      // 5. User should be able to reset again
      vi.clearAllMocks();
      resetBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
        dialogId,
      });
    });

    it('should prevent multiple rapid clicks (debouncing)', () => {
      const dialogId = 'test-dialog';
      sessionActionsUI.setCurrentDialogId(dialogId);
      sessionActionsUI.updateSessionStatus(true);

      // User rapidly clicks reset button 3 times
      resetBtn.click();
      resetBtn.click();
      resetBtn.click();

      // Only the FIRST click should send a message (subsequent clicks are ignored while processing)
      expect(mockVscode.postMessage).toHaveBeenCalledTimes(1);
      expect(mockVscode.postMessage).toHaveBeenCalledWith({
        type: WEBVIEW_IN_MSG.RESET_TO_APPROVED,
        dialogId,
      });

      // Button should be disabled during processing
      expect(resetBtn.disabled).toBe(true);
    });

    it('should allow clicking again after operation completes', () => {
      const dialogId = 'test-dialog';
      sessionActionsUI.setCurrentDialogId(dialogId);
      sessionActionsUI.updateSessionStatus(true);

      // First click
      resetBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledTimes(1);
      expect(resetBtn.disabled).toBe(true);

      // Operation completes - status update re-enables button
      sessionActionsUI.updateSessionStatus(true);
      expect(resetBtn.disabled).toBe(false);

      // Second click should work
      resetBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle cancellation of confirmation dialog', () => {
      const dialogId = 'test-dialog';
      sessionActionsUI.setCurrentDialogId(dialogId);
      sessionActionsUI.updateSessionStatus(true);

      // User clicks reset button
      resetBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledTimes(1);
      expect(resetBtn.disabled).toBe(true);

      // User cancels the confirmation dialog
      // Extension sends SESSION_OPERATION_CANCELLED message
      sessionActionsUI.cancelOperation();

      // Button should be re-enabled
      expect(resetBtn.disabled).toBe(false);

      // User can click again
      resetBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledTimes(2);
    });
  });
});
