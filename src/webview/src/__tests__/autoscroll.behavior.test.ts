/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ScrollManager} from '../scroll/ScrollManager';
import type {VSCodeAPI} from '../types';

function makeContainer({
  clientHeight = 600,
  scrollHeight = 2000,
  scrollTop,
}: {clientHeight?: number; scrollHeight?: number; scrollTop?: number} = {}) {
  const el = document.createElement('div') as HTMLElement & {
    _scrollTop: number;
    _clientHeight: number;
    _scrollHeight: number;
  };
  Object.defineProperties(el, {
    scrollTop: {
      get() {
        return (el as any)._scrollTop ?? 0;
      },
      set(v: number) {
        (el as any)._scrollTop = Math.max(0, Math.min(v, (el as any)._scrollHeight - (el as any)._clientHeight));
      },
      configurable: true,
    },
    clientHeight: {
      get() {
        return (el as any)._clientHeight;
      },
      configurable: true,
    },
    scrollHeight: {
      get() {
        return (el as any)._scrollHeight;
      },
      configurable: true,
    },
  });
  (el as any)._clientHeight = clientHeight;
  (el as any)._scrollHeight = scrollHeight;
  (el as any)._scrollTop = scrollTop ?? scrollHeight - clientHeight; // start at bottom
  document.body.appendChild(el);
  return el;
}

describe('ScrollManager autoscroll user-intent behavior', () => {
  let container: HTMLElement & any;
  let vscode: VSCodeAPI;
  let sm: ScrollManager;

  beforeEach(() => {
    // real timers but stub rAF to run immediately twice
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1 as any;
    });

    container = makeContainer();
    vscode = {postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn()} as any;
    // Minimal renderer mock
    const renderer: any = {pruneByIdx: vi.fn()};
    sm = new ScrollManager(container, vscode, renderer);
  });

  it('does not lock on programmatic upward scrolls (no user interaction)', () => {
    // At bottom
    expect(sm.isAtBottom()).toBe(true);

    // Programmatic scroll up without wheel/mouse events
    container.scrollTop -= 300;
    container.dispatchEvent(new Event('scroll'));

    // Lock should not be set; returning near bottom should re-enable auto-scroll
    container.scrollTop = container.scrollHeight - container.clientHeight - 20; // within auto-threshold
    container.dispatchEvent(new Event('scroll'));
    expect(sm.isAtBottom()).toBe(true);
  });

  it('locks when user scrolls up (wheel), unlocks when back near bottom', () => {
    // Simulate user wheel up, moving away from bottom
    container.dispatchEvent(new WheelEvent('wheel', {deltaY: -200}));
    container.scrollTop -= 200;
    container.dispatchEvent(new Event('scroll'));

    // Now grow content (streaming) and ensure it does not auto-scroll
    const prevTop = container.scrollTop;
    (container as any)._scrollHeight += 400;
    container.dispatchEvent(new Event('scroll'));
    expect(container.scrollTop).toBe(prevTop);

    // User returns to bottom
    container.dispatchEvent(new WheelEvent('wheel', {deltaY: 9999}));
    container.scrollTop = container.scrollHeight - container.clientHeight;
    container.dispatchEvent(new Event('scroll'));
    expect(sm.isAtBottom()).toBe(true);
  });

  it('stays glued to bottom during streaming when user is at bottom', async () => {
    // Start at bottom
    expect(sm.isAtBottom()).toBe(true);

    // Content grows (append during streaming)
    (container as any)._scrollHeight += 300;
    // Simulate ScrollManager-driven snap by calling scrollIntoViewIfAtBottom
    sm.scrollIntoViewIfAtBottom(document.createElement('div'));

    // Wait for double rAF used inside scrollToBottom
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Should be at absolute bottom
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight);
  });
});
