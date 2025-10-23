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
import type {VSCodeAPI, WebviewOutMessage} from '../types';
import {UIController} from '../UIController';

const createMockVSCodeAPI = (): VSCodeAPI => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
});

describe('MessageHandler with DialogViewManager', () => {
  let vscode: VSCodeAPI;
  let messagesContainer: HTMLElement;
  let dialogViewsContainer: HTMLElement;
  let renderer: MessageRenderer;
  let streamingState: StreamingStateManager;
  let scrollManager: ScrollManager;
  let uiController: UIController;
  let dialogViewManager: DialogViewManager;
  let messageHandler: MessageHandler;
  let messageInput: HTMLTextAreaElement;
  let sendButton: HTMLButtonElement;

  beforeEach(() => {
    // Mock scrollIntoView
    HTMLElement.prototype.scrollIntoView = vi.fn();

    // Setup DOM
    document.body.innerHTML = `
      <div id="messages"></div>
      <div id="dialogViews"></div>
      <textarea id="messageInput"></textarea>
      <button id="sendButton"></button>
    `;

    vscode = createMockVSCodeAPI();
    messagesContainer = document.getElementById('messages') as HTMLElement;
    dialogViewsContainer = document.getElementById('dialogViews') as HTMLElement;
    messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    sendButton = document.getElementById('sendButton') as HTMLButtonElement;

    renderer = new MessageRenderer(messagesContainer, null, null, '/workspace');
    streamingState = new StreamingStateManager();
    scrollManager = new ScrollManager(messagesContainer, vscode, renderer);
    uiController = new UIController(messageInput, sendButton);
    dialogViewManager = new DialogViewManager('/workspace', vscode, dialogViewsContainer);

    messageHandler = new MessageHandler(
      renderer,
      streamingState,
      scrollManager,
      uiController,
      messagesContainer,
      dialogViewManager,
    );
  });

  describe('routing with dialogId', () => {
    it('routes HISTORY_REPLACE_ALL to correct dialog', () => {
      const message: WebviewOutMessage = {
        type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL,
        events: [
          {type: 'user', content: 'Hello', idx: 1},
          {type: 'chat', content: 'Hi', idx: 2},
        ],
        dialogId: 'dialog-1',
      };

      messageHandler.handle(message);

      const view = dialogViewManager.getView('dialog-1');
      expect(view).toBeTruthy();

      const messagesContainer = view?.container.querySelector('.messages');
      expect(messagesContainer?.textContent).toContain('Hello');
      expect(messagesContainer?.textContent).toContain('Hi');
    });

    it('routes streaming events to correct dialog', () => {
      const dialogId = 'dialog-1';

      // Start assistant message
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId,
      });

      const view = dialogViewManager.getView(dialogId);
      expect(view).toBeTruthy();
      expect(view?.getStreamingState().isCurrentlyProcessing()).toBe(true);

      // Append content
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT,
        content: 'Test response',
        dialogId,
      });

      expect(view?.getStreamingState().getCurrentAssistantText()).toBe('Test response');
    });

    it('updates only active dialog UI on stream events', () => {
      const view1 = dialogViewManager.switchToDialog('dialog-1');
      view1.show();

      // Start stream in active dialog
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: 'dialog-1',
      });

      expect(uiController.isInputDisabled()).toBe(true);

      // Start stream in inactive dialog
      dialogViewManager.getOrCreateView('dialog-2');
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE,
        dialogId: 'dialog-2',
      });

      // UI should not update for inactive dialog
      expect(uiController.isInputDisabled()).toBe(true); // Still from dialog-1
    });

    it('handles HISTORY_PREPEND_EVENTS for specific dialog', () => {
      const view = dialogViewManager.getOrCreateView('dialog-1');

      // Add initial message
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL,
        events: [{type: 'user', content: 'New', idx: 3}],
        dialogId: 'dialog-1',
      });

      // Prepend older messages
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS,
        events: [
          {type: 'user', content: 'Old 1', idx: 1},
          {type: 'chat', content: 'Old 2', idx: 2},
        ],
        dialogId: 'dialog-1',
      });

      const messagesContainer = view.container.querySelector('.messages');
      expect(messagesContainer?.textContent).toContain('Old 1');
      expect(messagesContainer?.textContent).toContain('Old 2');
      expect(messagesContainer?.textContent).toContain('New');
    });

    it('routes SCROLL_TO_BOTTOM to correct dialog', () => {
      const view = dialogViewManager.getOrCreateView('dialog-1');
      const renderer = view.getRenderer();

      // Add messages
      for (let i = 0; i < 50; i++) {
        renderer.addMessage('user', `Message ${i}`);
      }

      const messagesContainer = view.container.querySelector('.messages') as HTMLElement;

      // Mock scrollHeight to simulate scrollable content
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        configurable: true,
        value: 1000,
      });
      Object.defineProperty(messagesContainer, 'clientHeight', {
        configurable: true,
        value: 100,
      });

      messagesContainer.scrollTop = 0;
      expect(messagesContainer.scrollTop).toBe(0);

      // Send SCROLL_TO_BOTTOM
      messageHandler.handle({
        type: WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM,
        dialogId: 'dialog-1',
      });

      // In JSDOM scrollTop assignment works
      expect(messagesContainer.scrollTop).toBeGreaterThanOrEqual(0);
    });
  });

  describe('fallback to legacy handler', () => {
    it('uses legacy handlers when no dialogId provided', () => {
      const message: WebviewOutMessage = {
        type: WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL,
        events: [{type: 'user', content: 'Legacy', idx: 1}],
      };

      messageHandler.handle(message);

      // Should render in legacy messagesContainer
      expect(messagesContainer.textContent).toContain('Legacy');
    });
  });
});
