/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Utility to mount the ChatWebview from index.ts with required DOM and globals
async function mountWebview() {
  // Minimal DOM required by index.ts and DialogsUI
  document.body.innerHTML = `
    <header>
      <button id="dialogTitleBtn"></button>
      <span id="dialogTitleText"></span>
      <div id="dialogDropdown" style="display:none">
        <div id="dialogsList"></div>
        <button id="newDialogBtn"></button>
      </div>
    </header>
    <section id="sessionActions">
      <button id="sessionApproveBtn"></button>
      <button id="sessionResetBtn"></button>
    </section>
    <div id="dialogViews"></div>
    <div id="messages"></div>
    <textarea id="messageInput"></textarea>
    <button id="sendButton"></button>
  `;

  // Mock VS Code API
  (globalThis as any).acquireVsCodeApi = () => ({
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  });

  // Workspace root consumed at module init
  (window as any).WORKSPACE_ROOT = '/workspace';

  // requestAnimationFrame shim to run immediately
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    // Execute callback synchronously; return fake handle
    cb(0);
    return 1 as any;
  });

  // Avoid periodic cleanup setInterval during tests
  vi.spyOn(global, 'setInterval').mockImplementation((() => 0) as any);

  // Importing index bootstraps ChatWebview
  await import('../index');

  const messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
  const sendButton = document.getElementById('sendButton') as HTMLButtonElement;

  return {messageInput, sendButton};
}

describe('Webview focus behavior (integration)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  it('keeps focus in input after sending via Enter', async () => {
    const {messageInput} = await mountWebview();
    messageInput.value = 'Hello world';
    messageInput.focus();

    // Press Enter (without Shift)
    const evt = new KeyboardEvent('keydown', {key: 'Enter', shiftKey: false, bubbles: true});
    messageInput.dispatchEvent(evt);

    expect(document.activeElement).toBe(messageInput);
    // After send the input is cleared; caret should be at 0
    expect(messageInput.selectionStart).toBe(0);
    expect(messageInput.selectionEnd).toBe(0);
  });

  it('keeps focus in input after clicking Send button', async () => {
    const {messageInput, sendButton} = await mountWebview();
    messageInput.value = 'Ping';
    messageInput.focus();

    // Click send button (not in processing state)
    sendButton.click();

    vi.runAllTimers();

    expect(document.activeElement).toBe(messageInput);
    expect(messageInput.selectionStart).toBe(0);
    expect(messageInput.selectionEnd).toBe(0);
  });

  it('restores focus and caret after visibility -> visible', async () => {
    const {messageInput} = await mountWebview();
    messageInput.value = 'abcdef';
    messageInput.focus();
    messageInput.setSelectionRange(3, 3);

    // Simulate webview becoming hidden
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));

    // Now become visible again
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));

    // window.focus handler also triggers restore
    window.dispatchEvent(new Event('focus'));

    // Allow deferred timer (50ms) to run
    vi.advanceTimersByTime(60);

    expect(document.activeElement).toBe(messageInput);
    expect(messageInput.selectionStart).toBe(3);
    expect(messageInput.selectionEnd).toBe(3);
  });
});
