/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {StreamingStateManager} from '../StreamingStateManager';

describe('StreamingStateManager', () => {
  let manager: StreamingStateManager;

  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    manager = new StreamingStateManager();
  });

  describe('dialog ID tracking', () => {
    it('tracks dialog ID when starting processing', () => {
      expect(manager.getCurrentStreamDialogId()).toBeNull();

      manager.setProcessing(true, 'dialog-123');

      expect(manager.isCurrentlyProcessing()).toBe(true);
      expect(manager.getCurrentStreamDialogId()).toBe('dialog-123');
    });

    it('clears dialog ID when stopping processing', () => {
      manager.setProcessing(true, 'dialog-123');
      expect(manager.getCurrentStreamDialogId()).toBe('dialog-123');

      manager.setProcessing(false);

      expect(manager.isCurrentlyProcessing()).toBe(false);
      expect(manager.getCurrentStreamDialogId()).toBeNull();
    });

    it('does not set dialog ID if not provided', () => {
      manager.setProcessing(true);

      expect(manager.isCurrentlyProcessing()).toBe(true);
      expect(manager.getCurrentStreamDialogId()).toBeNull();
    });

    it('updates dialog ID when switching streams', () => {
      manager.setProcessing(true, 'dialog-1');
      expect(manager.getCurrentStreamDialogId()).toBe('dialog-1');

      manager.setProcessing(true, 'dialog-2');
      expect(manager.getCurrentStreamDialogId()).toBe('dialog-2');
    });
  });

  describe('assistant message streaming', () => {
    it('tracks assistant message element and dialog ID together', () => {
      const element = document.createElement('div');

      manager.startAssistantMessage(element);
      manager.setProcessing(true, 'dialog-abc');

      expect(manager.getCurrentAssistantMessage()).toBe(element);
      expect(manager.getCurrentStreamDialogId()).toBe('dialog-abc');
      expect(manager.isCurrentlyProcessing()).toBe(true);
    });

    it('maintains dialog ID through full stream lifecycle', () => {
      const element = document.createElement('div');
      const dialogId = 'test-dialog';

      manager.setProcessing(true, dialogId);
      manager.startAssistantMessage(element);
      manager.appendToAssistant('Hello');
      manager.appendToAssistant(' world');

      expect(manager.getCurrentStreamDialogId()).toBe(dialogId);
      expect(manager.getCurrentAssistantText()).toBe('Hello world');

      const mockRender = vi.fn((text: string) => text);
      manager.endAssistantMessage(mockRender);

      expect(manager.getCurrentAssistantMessage()).toBeNull();
      expect(manager.isCurrentlyProcessing()).toBe(true); // Still processing until END_STREAM
      expect(manager.getCurrentStreamDialogId()).toBe(dialogId);
    });
  });

  describe('resetAll', () => {
    it('preserves processing state and dialog ID', () => {
      const element = document.createElement('div');
      manager.setProcessing(true, 'dialog-123');
      manager.startAssistantMessage(element);
      manager.appendToAssistant('Test');

      manager.resetAll();

      // These should be cleared
      expect(manager.getCurrentAssistantMessage()).toBeNull();
      expect(manager.getCurrentAssistantText()).toBe('');

      // But processing state is preserved
      expect(manager.isCurrentlyProcessing()).toBe(true);
      expect(manager.getCurrentStreamDialogId()).toBe('dialog-123');
    });
  });

  describe('reasoning blocks with dialog tracking', () => {
    it('tracks reasoning blocks independently of dialog ID', () => {
      const reasoningDiv = document.createElement('div');
      const contentDiv = document.createElement('div');
      const headerDiv = document.createElement('div');
      const block = {block: reasoningDiv, content: contentDiv, header: headerDiv};

      manager.setProcessing(true, 'dialog-xyz');
      manager.startReasoning(block);

      expect(manager.getCurrentReasoningBlock()).toBe(block);
      expect(manager.getCurrentStreamDialogId()).toBe('dialog-xyz');
    });
  });
});
