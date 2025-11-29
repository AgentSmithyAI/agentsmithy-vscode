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

/**
 * Paste behavior tests
 *
 * These tests verify that pasting text into the message input works correctly,
 * specifically that the caret position is NOT forced to the end of the entire
 * textarea content after paste.
 *
 * The browser's default behavior places the caret at the END OF THE PASTED FRAGMENT,
 * which is correct for middle-insertion workflows. Previously, there was code that
 * overrode this and moved the caret to the end of all text, breaking the UX.
 *
 * See docs/focus-behavior.md section "4. Paste behavior" for details.
 */
describe('Paste behavior in message input', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  /**
   * Helper to simulate paste event.
   * In JSDOM, the actual clipboard paste doesn't modify textarea value,
   * so we manually simulate what the browser does:
   * 1. Insert text at current caret position
   * 2. Move caret to end of inserted text
   * 3. Dispatch paste and input events
   */
  function simulatePaste(textarea: HTMLTextAreaElement, textToPaste: string) {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);

    // Browser inserts pasted text at selection, replacing any selected text
    textarea.value = before + textToPaste + after;

    // Browser moves caret to end of pasted fragment
    const newCaretPos = start + textToPaste.length;
    textarea.setSelectionRange(newCaretPos, newCaretPos);

    // Dispatch events that browser would fire
    textarea.dispatchEvent(new Event('paste', {bubbles: true}));
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
  }

  it('does NOT move caret to end of all text when pasting in the middle', async () => {
    // This is a regression test for the bug where paste handler moved caret
    // to textarea.value.length instead of keeping it at end of pasted fragment.
    const {messageInput} = await mountWebview();

    // Setup: "Hello World" with caret at position 6 (after "Hello ")
    messageInput.value = 'Hello World';
    messageInput.focus();
    messageInput.setSelectionRange(6, 6);

    // Paste "Beautiful " at position 6
    simulatePaste(messageInput, 'Beautiful ');

    // Let any async handlers run
    vi.runAllTimers();

    // Result should be "Hello Beautiful World"
    expect(messageInput.value).toBe('Hello Beautiful World');

    // Caret should be at position 16 (end of "Hello Beautiful "), NOT at 21 (end of all text)
    // Position 16 = 6 (original position) + 10 (length of "Beautiful ")
    expect(messageInput.selectionStart).toBe(16);
    expect(messageInput.selectionEnd).toBe(16);
  });

  it('paste at the beginning keeps caret at end of pasted text', async () => {
    const {messageInput} = await mountWebview();

    messageInput.value = 'World';
    messageInput.focus();
    messageInput.setSelectionRange(0, 0); // Caret at beginning

    simulatePaste(messageInput, 'Hello ');

    vi.runAllTimers();

    expect(messageInput.value).toBe('Hello World');
    // Caret should be at 6 (after "Hello "), not at 11 (end of all)
    expect(messageInput.selectionStart).toBe(6);
    expect(messageInput.selectionEnd).toBe(6);
  });

  it('paste at the end naturally puts caret at the end', async () => {
    const {messageInput} = await mountWebview();

    messageInput.value = 'Hello';
    messageInput.focus();
    messageInput.setSelectionRange(5, 5); // Caret at end

    simulatePaste(messageInput, ' World');

    vi.runAllTimers();

    expect(messageInput.value).toBe('Hello World');
    // Here caret at end of pasted = end of all text, both are 11
    expect(messageInput.selectionStart).toBe(11);
    expect(messageInput.selectionEnd).toBe(11);
  });

  it('paste replacing selection puts caret at end of replacement', async () => {
    const {messageInput} = await mountWebview();

    // "Hello World" with "World" selected (positions 6-11)
    messageInput.value = 'Hello World';
    messageInput.focus();
    messageInput.setSelectionRange(6, 11); // Select "World"

    // Replace selection with "Universe"
    simulatePaste(messageInput, 'Universe');

    vi.runAllTimers();

    expect(messageInput.value).toBe('Hello Universe');
    // Caret at 14 = 6 (start of selection) + 8 (length of "Universe")
    expect(messageInput.selectionStart).toBe(14);
    expect(messageInput.selectionEnd).toBe(14);
  });
});
