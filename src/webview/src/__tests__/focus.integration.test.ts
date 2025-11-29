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

/**
 * Scroll behavior tests for message input textarea
 *
 * These tests verify that the textarea scroll position is NOT forcibly set to
 * the bottom on every input event. Previously, code did `scrollTop = scrollHeight`
 * on each input, which caused the viewport to jump to the end even when the user
 * was editing/pasting in the middle of the text.
 *
 * The correct behavior: let the browser handle scrolling naturally.
 * The browser automatically scrolls to keep the caret visible, which works for
 * all cases (typing at end, typing in middle, pasting anywhere).
 *
 * See UIController.ts setupInputAutoResize() and docs/focus-behavior.md for details.
 */
describe('Textarea scroll behavior on input (regression tests)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  /**
   * Helper to set up a textarea with mocked scroll properties.
   * JSDOM doesn't implement actual scrolling, so we mock scrollTop/scrollHeight.
   */
  function setupScrollableMock(textarea: HTMLTextAreaElement, scrollHeight: number) {
    let currentScrollTop = 0;

    Object.defineProperty(textarea, 'scrollHeight', {
      get: () => scrollHeight,
      configurable: true,
    });

    Object.defineProperty(textarea, 'scrollTop', {
      get: () => currentScrollTop,
      set: (v: number) => {
        currentScrollTop = v;
      },
      configurable: true,
    });

    return {
      getScrollTop: () => currentScrollTop,
      setScrollTop: (v: number) => {
        currentScrollTop = v;
      },
    };
  }

  it('does NOT force scrollTop to scrollHeight on input event', async () => {
    // This is a regression test: previously input handler did scrollTop = scrollHeight,
    // which broke editing in the middle of long text by jumping viewport to the end.
    const {messageInput} = await mountWebview();

    // Simulate a tall textarea with lots of content
    const scrollMock = setupScrollableMock(messageInput, 500);

    // User has scrolled to middle of content (not at bottom)
    scrollMock.setScrollTop(100);

    // Simulate typing - dispatch input event
    messageInput.dispatchEvent(new Event('input', {bubbles: true}));

    vi.runAllTimers();

    // scrollTop should NOT have been forced to 500 (scrollHeight)
    // It should remain where it was, or browser would adjust to keep caret visible
    // (browser behavior not simulated in JSDOM, but at least we verify no forced jump)
    expect(scrollMock.getScrollTop()).not.toBe(500);
  });

  it('allows natural scroll position when editing in middle of text', async () => {
    const {messageInput} = await mountWebview();

    // Setup: long text, scrolled to middle
    messageInput.value = 'Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8\nLine9\nLine10';
    const scrollMock = setupScrollableMock(messageInput, 300);
    scrollMock.setScrollTop(50); // Viewing middle portion

    // User types in the middle
    messageInput.setSelectionRange(20, 20);
    messageInput.dispatchEvent(new Event('input', {bubbles: true}));

    vi.runAllTimers();

    // Scroll should not jump to bottom (300)
    expect(scrollMock.getScrollTop()).toBe(50);
  });

  it('textarea auto-resize still works (height adjustment)', async () => {
    // Verify that removing scroll manipulation didn't break auto-resize
    const {messageInput} = await mountWebview();

    // Set initial height
    messageInput.style.height = '50px';
    const initialHeight = messageInput.style.height;

    // Mock scrollHeight to simulate content growth
    Object.defineProperty(messageInput, 'scrollHeight', {
      get: () => 150,
      configurable: true,
    });

    // Trigger input event which should trigger auto-resize
    messageInput.dispatchEvent(new Event('input', {bubbles: true}));

    vi.runAllTimers();

    // Height should have been updated (auto-resize logic: height = scrollHeight + 'px')
    expect(messageInput.style.height).toBe('150px');
    expect(messageInput.style.height).not.toBe(initialHeight);
  });
});
