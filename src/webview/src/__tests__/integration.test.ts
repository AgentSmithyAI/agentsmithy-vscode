/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {WEBVIEW_OUT_MSG} from '../../../shared/messages';
import {DialogViewManager} from '../DialogViewManager';
import {MessageHandler} from '../MessageHandler';
import {MessageRenderer} from '../renderer';
import {ScrollManager} from '../ScrollManager';
import {StreamingStateManager} from '../StreamingStateManager';
import type {VSCodeAPI} from '../types';
import {UIController} from '../UIController';

const createMockVSCodeAPI = (): VSCodeAPI => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
});

describe('Dialog Switching Integration Tests', () => {
  let vscode: VSCodeAPI;
  let dialogViewsContainer: HTMLElement;
  let dialogViewManager: DialogViewManager;
  let messageHandler: MessageHandler;
  let uiController: UIController;
  let messageInput: HTMLTextAreaElement;
  let sendButton: HTMLButtonElement;

  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();

    document.body.innerHTML = `
      <div id="dialogViews"></div>
      <div id="messages"></div>
      <textarea id="messageInput"></textarea>
      <button id="sendButton"></button>
    `;

    vscode = createMockVSCodeAPI();
    dialogViewsContainer = document.getElementById('dialogViews') as HTMLElement;
    const messagesContainer = document.getElementById('messages') as HTMLElement;
    messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    sendButton = document.getElementById('sendButton') as HTMLButtonElement;

    dialogViewManager = new DialogViewManager('/workspace', vscode, dialogViewsContainer);
    const renderer = new MessageRenderer(messagesContainer, null, null, '/workspace');
    const streamingState = new StreamingStateManager();
    const scrollManager = new ScrollManager(messagesContainer, vscode, renderer);
    uiController = new UIController(messageInput, sendButton);

    messageHandler = new MessageHandler(
      renderer,
      streamingState,
      scrollManager,
      uiController,
      messagesContainer,
      dialogViewManager,
    );
  });

  describe('Background streaming while switching dialogs', () => {
    it('continues stream in background when user switches away', () => {
      const dialogA = 'dialog-a';
      const dialogB = 'dialog-b';

      // Load and show dialog A
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL,
        events: [{type: 'user', content: 'Question A', idx: 1}],
        dialogId: dialogA,
      });

      const viewA = dialogViewManager.switchToDialog(dialogA);
      expect(viewA.getIsActive()).toBe(true);

      // Start streaming in dialog A
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: dialogA,
      });

      expect(viewA.getStreamingState().isCurrentlyProcessing()).toBe(true);

      // User switches to dialog B
      const viewB = dialogViewManager.switchToDialog(dialogB);
      expect(viewA.getIsActive()).toBe(false);
      expect(viewB.getIsActive()).toBe(true);

      // Stream continues in dialog A (background)
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: 'Answer A part 1',
        dialogId: dialogA,
      });

      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: ' part 2',
        dialogId: dialogA,
      });

      // Verify content was added to dialog A
      expect(viewA.getStreamingState().getCurrentAssistantText()).toBe('Answer A part 1 part 2');

      // Verify dialog B is unaffected
      expect(viewB.getStreamingState().isCurrentlyProcessing()).toBe(false);
    });

    it('preserves stream state when switching back', () => {
      const dialogA = 'dialog-a';
      const dialogB = 'dialog-b';

      // Start stream in dialog A
      const viewA = dialogViewManager.switchToDialog(dialogA);
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: dialogA,
      });

      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: 'Streaming content',
        dialogId: dialogA,
      });

      // Switch to dialog B
      dialogViewManager.switchToDialog(dialogB);

      // More content arrives for dialog A
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: ' more content',
        dialogId: dialogA,
      });

      // Switch back to dialog A
      dialogViewManager.switchToDialog(dialogA);

      // Stream state should be preserved
      expect(viewA.getIsActive()).toBe(true);
      expect(viewA.getStreamingState().isCurrentlyProcessing()).toBe(true);
      expect(viewA.getStreamingState().getCurrentAssistantText()).toBe('Streaming content more content');
    });
  });

  describe('UI updates only for active dialog', () => {
    it('shows spinner only when active dialog is streaming', () => {
      const dialogA = 'dialog-a';
      const dialogB = 'dialog-b';

      const viewA = dialogViewManager.switchToDialog(dialogA);

      // Start stream in active dialog A
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: dialogA,
      });

      expect(uiController.isInputDisabled()).toBe(true);

      // Switch to dialog B (no stream)
      dialogViewManager.switchToDialog(dialogB);

      // UI should update to reflect dialog B state (not streaming)
      // Note: This happens in ChatWebview.handleDialogSwitch, not in MessageHandler

      // Start stream in background dialog A
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: 'Background content',
        dialogId: dialogA,
      });

      // UI should NOT change (dialog A is not active)
      // The uiController state remains from when we switched to B
    });

    it('does not trigger auto-scroll for background dialog', () => {
      const dialogA = 'dialog-a';
      const dialogB = 'dialog-b';

      const viewA = dialogViewManager.switchToDialog(dialogA);
      const messagesContainerA = viewA.container.querySelector('.messages') as HTMLElement;

      // Set up scrollable content
      Object.defineProperty(messagesContainerA, 'scrollHeight', {
        configurable: true,
        value: 1000,
      });
      Object.defineProperty(messagesContainerA, 'clientHeight', {
        configurable: true,
        value: 100,
      });

      // Start stream in dialog A
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: dialogA,
      });

      // Switch to dialog B
      dialogViewManager.switchToDialog(dialogB);

      const scrollTopBefore = messagesContainerA.scrollTop;

      // Content arrives for dialog A in background
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: 'Background content',
        dialogId: dialogA,
      });

      // Scroll should NOT have been triggered (dialog A is inactive)
      expect(messagesContainerA.scrollTop).toBe(scrollTopBefore);
    });
  });

  describe('History loading during initialization', () => {
    it('loads history into correct dialog before DIALOG_SWITCHED', () => {
      const dialogId = 'initial-dialog';

      // History arrives BEFORE currentDialogId is set
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL,
        events: [
          {type: 'user', content: 'Early message 1', idx: 1},
          {type: 'chat', content: 'Early response 1', idx: 2},
        ],
        dialogId,
      });

      // View should have been created with history
      const view = dialogViewManager.getView(dialogId);
      expect(view).toBeTruthy();

      const messagesContainer = view?.container.querySelector('.messages');
      expect(messagesContainer?.textContent).toContain('Early message 1');
      expect(messagesContainer?.textContent).toContain('Early response 1');
    });
  });

  describe('Multiple simultaneous streams', () => {
    it('handles streams in multiple dialogs independently', () => {
      const dialogA = 'dialog-a';
      const dialogB = 'dialog-b';

      // Start stream in dialog A
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: dialogA,
      });

      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: 'Response A',
        dialogId: dialogA,
      });

      // Start different stream in dialog B
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: dialogB,
      });

      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: 'Response B',
        dialogId: dialogB,
      });

      // Verify both streams maintained separately
      const viewA = dialogViewManager.getView(dialogA);
      const viewB = dialogViewManager.getView(dialogB);

      expect(viewA?.getStreamingState().getCurrentAssistantText()).toBe('Response A');
      expect(viewB?.getStreamingState().getCurrentAssistantText()).toBe('Response B');

      expect(viewA?.getStreamingState().isCurrentlyProcessing()).toBe(true);
      expect(viewB?.getStreamingState().isCurrentlyProcessing()).toBe(true);
    });
  });

  describe('Memory cleanup', () => {
    it('removes inactive views without streams during cleanup', () => {
      // Create 5 dialogs
      for (let i = 1; i <= 5; i++) {
        dialogViewManager.getOrCreateView(`dialog-${i}`);
      }

      expect(dialogViewManager.getLoadedDialogIds().length).toBe(5);

      // Switch to dialog-5 (makes it active)
      dialogViewManager.switchToDialog('dialog-5');

      // Trigger cleanup
      dialogViewManager.cleanupInactiveViews();

      // Should keep:
      // - dialog-5 (active)
      // - Up to 3 most recent inactive dialogs
      // Total: <= 4
      const loadedIds = dialogViewManager.getLoadedDialogIds();
      expect(loadedIds.length).toBeLessThanOrEqual(4);
      expect(loadedIds).toContain('dialog-5'); // Active must be kept
    });

    it('preserves views with active streams during cleanup', () => {
      // Create 5 dialogs
      for (let i = 1; i <= 5; i++) {
        const view = dialogViewManager.getOrCreateView(`dialog-${i}`);
        // Start stream in dialog-2
        if (i === 2) {
          view.getStreamingState().setProcessing(true, `dialog-${i}`);
        }
      }

      // Switch to dialog-5 (active)
      dialogViewManager.switchToDialog('dialog-5');

      // Cleanup
      dialogViewManager.cleanupInactiveViews();

      // Must keep dialog-2 (has stream) and dialog-5 (active)
      expect(dialogViewManager.isDialogLoaded('dialog-2')).toBe(true);
      expect(dialogViewManager.isDialogLoaded('dialog-5')).toBe(true);
    });
  });
});
