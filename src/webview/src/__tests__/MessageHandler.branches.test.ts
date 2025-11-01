/**
 * @vitest-environment jsdom
 */
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {WEBVIEW_OUT_MSG} from '../../../shared/messages';
import {DialogViewManager} from '../DialogViewManager';
import {MessageHandler} from '../MessageHandler';
import {MessageRenderer} from '../renderer';
import {ScrollManager} from '../ScrollManager';
import {StreamingStateManager} from '../StreamingStateManager';
import {UIController} from '../UIController';

const nextTick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('MessageHandler branches', () => {
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
    HTMLElement.prototype.scrollIntoView = vi.fn();

    document.body.innerHTML = `
      <div id="messages"></div>
      <div id="dialogViews"></div>
      <textarea id="messageInput"></textarea>
      <button id="sendButton"></button>
    `;

    messagesContainer = document.getElementById('messages') as HTMLElement;
    dialogViewsContainer = document.getElementById('dialogViews') as HTMLElement;
    messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    sendButton = document.getElementById('sendButton') as HTMLButtonElement;

    renderer = new MessageRenderer(messagesContainer, null, null, '/workspace');
    streamingState = new StreamingStateManager();
    scrollManager = new ScrollManager(messagesContainer, {postMessage: vi.fn()} as any, renderer);
    uiController = new UIController(messageInput, sendButton);
    dialogViewManager = new DialogViewManager('/workspace', {postMessage: vi.fn()} as any, dialogViewsContainer);

    messageHandler = new MessageHandler(
      renderer,
      streamingState,
      scrollManager,
      uiController,
      messagesContainer,
      dialogViewManager,
    );
  });

  it('handles reasoning start/append/end only for active dialog', async () => {
    const active = 'dlg-1';
    const other = 'dlg-2';

    dialogViewManager.switchToDialog(active);

    messageHandler.handle({type: WEBVIEW_OUT_MSG.START_REASONING, dialogId: other});
    await nextTick();

    const activeView = dialogViewManager.getView(active)!;
    const otherView = dialogViewManager.getView(other)!;
    expect(activeView.getStreamingState().getCurrentReasoningBlock()).toBeFalsy();
    expect(otherView.getStreamingState().getCurrentReasoningBlock()).toBeTruthy();

    messageHandler.handle({type: WEBVIEW_OUT_MSG.END_REASONING, dialogId: other});
    await nextTick();
    expect(otherView.getStreamingState().getCurrentReasoningBlock()).toBeNull();
  });

  it('finalizes stream on END_STREAM updates UI for active dialog only', async () => {
    const active = 'dlg-1';
    const other = 'dlg-2';

    dialogViewManager.switchToDialog(active);

    // Start assistant in other dialog (should not affect active UIController)
    messageHandler.handle({type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE, dialogId: other});
    expect(uiController.isInputDisabled()).toBe(false);

    // Start assistant in active dialog (should reflect in UI)
    messageHandler.handle({type: WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE, dialogId: active});
    expect(uiController.isInputDisabled()).toBe(true);

    // End stream for the active dialog
    messageHandler.handle({type: WEBVIEW_OUT_MSG.END_STREAM, dialogId: active});
    await nextTick();
    expect(uiController.isInputDisabled()).toBe(false);
  });
});
