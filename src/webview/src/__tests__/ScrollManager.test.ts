/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ScrollManager} from '../scroll/ScrollManager';
import {MessageRenderer} from '../renderer';
import {VSCodeAPI} from '../types';
import {WEBVIEW_IN_MSG} from '../../../shared/messages';

describe('ScrollManager', () => {
  let messagesContainer: HTMLElement;
  let mockVscode: VSCodeAPI;
  let mockRenderer: MessageRenderer;
  let scrollManager: ScrollManager;

  beforeEach(() => {
    // Create a mock messages container
    messagesContainer = document.createElement('div');
    Object.defineProperties(messagesContainer, {
      scrollTop: {value: 0, writable: true},
      scrollHeight: {value: 1000, writable: true, configurable: true},
      clientHeight: {value: 500, writable: true, configurable: true},
    });

    describe('user intent lock and auto-scroll behavior', () => {
      it('locks auto-scroll when user scrolls up away from bottom', async () => {
        // Start near bottom, then simulate user scroll up
        messagesContainer.scrollTop = 460; // within auto-scroll threshold initially
        // First scroll event establishes lastScrollTop
        messagesContainer.dispatchEvent(new Event('scroll'));

        // User scrolls up to middle (far from bottom)
        messagesContainer.scrollTop = 200;
        messagesContainer.dispatchEvent(new Event('scroll'));

        // Now locked; scrollIntoViewIfAtBottom should not scroll
        scrollManager.scrollIntoViewIfAtBottom(document.createElement('div'));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        expect(messagesContainer.scrollTop).toBe(200);
      });

      it('unlocks when user returns near bottom', () => {
        // Lock first by scrolling up away from bottom
        messagesContainer.scrollTop = 200;
        messagesContainer.dispatchEvent(new Event('scroll'));

        // Return near bottom within threshold
        messagesContainer.scrollTop = 460; // within 40px of bottom
        messagesContainer.dispatchEvent(new Event('scroll'));

        // isAtBottom should be true now
        expect(scrollManager.isAtBottom()).toBe(true);
      });

      it('scrollToBottom clears lock and scrolls to bottom', async () => {
        // Lock by scrolling up
        messagesContainer.scrollTop = 200;
        messagesContainer.dispatchEvent(new Event('scroll'));

        // Explicit scroll to bottom should clear lock and move to bottom
        scrollManager.scrollToBottom();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        expect(messagesContainer.scrollTop).toBe(1000);
        expect(scrollManager.isAtBottom()).toBe(true);
      });
    });

    describe('pruning vs auto-scroll thresholds', () => {
      it('prunes when near bottom for prune but does not auto-scroll if outside auto threshold', () => {
        // Place within prune threshold (<=200) but outside auto-scroll (>
        // 1000 - x - 500 <= 200 and > 40 -> choose x = 330 gives 170 distance
        messagesContainer.scrollTop = 330;
        const spy = vi.spyOn(mockRenderer, 'pruneByIdx');

        messagesContainer.dispatchEvent(new Event('scroll'));

        expect(spy).toHaveBeenCalled();
        // isAtBottom should be false because distance is 170 > 40
        expect(scrollManager.isAtBottom()).toBe(false);
      });
    });

    describe('top trigger arming and history loading', () => {
      it('loads more history when scrolling up near top and armed', () => {
        const postSpy = vi.spyOn(mockVscode, 'postMessage');

        // Move away to rearm (>300)
        messagesContainer.scrollTop = 400;
        messagesContainer.dispatchEvent(new Event('scroll'));

        // Now scroll up near top within 100px
        messagesContainer.scrollTop = 80;
        messagesContainer.dispatchEvent(new Event('scroll'));

        expect(postSpy).toHaveBeenCalledWith({type: WEBVIEW_IN_MSG.LOAD_MORE_HISTORY});
      });

      it('does not trigger load immediately again until re-armed', () => {
        const postSpy = vi.spyOn(mockVscode, 'postMessage');

        // Rearm
        messagesContainer.scrollTop = 400;
        messagesContainer.dispatchEvent(new Event('scroll'));

        // Trigger once
        messagesContainer.scrollTop = 80;
        messagesContainer.dispatchEvent(new Event('scroll'));
        const callsAfterFirst = postSpy.mock.calls.length;

        // Still near top, scrolling up again should not trigger until rearmed
        messagesContainer.scrollTop = 60;
        messagesContainer.dispatchEvent(new Event('scroll'));
        expect(postSpy.mock.calls.length).toBe(callsAfterFirst);

        // Move away > 300 to rearm and trigger again
        messagesContainer.scrollTop = 500;
        messagesContainer.dispatchEvent(new Event('scroll'));
        messagesContainer.scrollTop = 90;
        messagesContainer.dispatchEvent(new Event('scroll'));

        expect(postSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
      });

      it('finishHistoryLoad disarms top trigger to avoid immediate retrigger', () => {
        const postSpy = vi.spyOn(mockVscode, 'postMessage');

        // Rearm and trigger once
        messagesContainer.scrollTop = 400;
        messagesContainer.dispatchEvent(new Event('scroll'));
        messagesContainer.scrollTop = 80;
        messagesContainer.dispatchEvent(new Event('scroll'));

        // Simulate provider finished loading; this disarms
        scrollManager.finishHistoryLoad();

        // Still near top; another scroll should not trigger immediately
        messagesContainer.scrollTop = 70;
        messagesContainer.dispatchEvent(new Event('scroll'));
        const calls = postSpy.mock.calls.filter((c) => c[0]?.type === WEBVIEW_IN_MSG.LOAD_MORE_HISTORY).length;
        expect(calls).toBe(1);
      });

      it('setCanLoadMore(false) prevents new loads and clears loading flag', () => {
        const postSpy = vi.spyOn(mockVscode, 'postMessage');

        scrollManager.setCanLoadMore(false);

        // Try to trigger load
        messagesContainer.scrollTop = 80;
        messagesContainer.dispatchEvent(new Event('scroll'));

        // No new load should be requested
        const calls = postSpy.mock.calls.filter((c) => c[0]?.type === WEBVIEW_IN_MSG.LOAD_MORE_HISTORY).length;
        expect(calls).toBe(0);
      });
    });

    // Mock VSCode API
    mockVscode = {
      postMessage: vi.fn(),
      getState: vi.fn(),
      setState: vi.fn(),
    };

    // Mock renderer
    mockRenderer = {
      pruneByIdx: vi.fn(),
    } as unknown as MessageRenderer;

    scrollManager = new ScrollManager(messagesContainer, mockVscode, mockRenderer);
  });

  describe('isAtBottom', () => {
    it('should return true when at the bottom (within threshold)', () => {
      // scrollHeight - scrollTop - clientHeight <= 40
      // 1000 - 460 - 500 = 40 ✓
      messagesContainer.scrollTop = 460;
      expect(scrollManager.isAtBottom()).toBe(true);
    });

    it('should return true when exactly at the bottom', () => {
      // 1000 - 500 - 500 = 0 ✓
      messagesContainer.scrollTop = 500;
      expect(scrollManager.isAtBottom()).toBe(true);
    });

    it('should return false when scrolled up beyond threshold', () => {
      // 1000 - 0 - 500 = 500 ✗
      messagesContainer.scrollTop = 0;
      expect(scrollManager.isAtBottom()).toBe(false);
    });

    it('should return false when in the middle', () => {
      // 1000 - 250 - 500 = 250 ✗
      messagesContainer.scrollTop = 250;
      expect(scrollManager.isAtBottom()).toBe(false);
    });

    it('should handle edge case at threshold boundary', () => {
      // Exactly at threshold: 1000 - 460 - 500 = 40 ✓
      messagesContainer.scrollTop = 460;
      expect(scrollManager.isAtBottom()).toBe(true);

      // Just outside threshold: 1000 - 459 - 500 = 41 ✗
      messagesContainer.scrollTop = 459;
      expect(scrollManager.isAtBottom()).toBe(false);
    });
  });

  describe('scrollIntoViewIfAtBottom', () => {
    let testElement: HTMLElement;

    beforeEach(() => {
      testElement = document.createElement('div');
    });

    it('should scroll element into view when at bottom', async () => {
      // Position at bottom
      messagesContainer.scrollTop = 500;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      // Wait for double rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should scroll to bottom
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should NOT scroll element into view when scrolled up', async () => {
      // Position at top
      messagesContainer.scrollTop = 0;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      // Wait for potential rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      expect(messagesContainer.scrollTop).toBe(0);
    });

    it('should scroll when within bottom threshold', async () => {
      // Just within auto-scroll threshold: 1000 - 460 - 500 = 40
      messagesContainer.scrollTop = 460;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      // Wait for double rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should scroll to bottom
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should NOT scroll when just outside threshold', async () => {
      // Just outside auto-scroll threshold: 1000 - 459 - 500 = 41
      messagesContainer.scrollTop = 459;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      // Wait for potential rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      expect(messagesContainer.scrollTop).toBe(459);
    });
  });

  describe('integration with dynamic content height', () => {
    it('should correctly detect bottom position after content grows', () => {
      // Initial position at bottom
      messagesContainer.scrollTop = 500;
      expect(scrollManager.isAtBottom()).toBe(true);

      // Content grows
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1500,
        writable: true,
        configurable: true,
      });

      // Now we're not at bottom anymore
      // 1500 - 500 - 500 = 500 > 200
      expect(scrollManager.isAtBottom()).toBe(false);
    });

    it('should detect bottom after scrolling to new bottom', () => {
      // Content grows
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1500,
        writable: true,
        configurable: true,
      });

      // Scroll to new bottom
      messagesContainer.scrollTop = 1000;

      // Should be at bottom now: 1500 - 1000 - 500 = 0 < 200
      expect(scrollManager.isAtBottom()).toBe(true);
    });

    it('handleContentShrink unlocks and snaps to bottom when near bottom', async () => {
      // Place near bottom within auto-scroll threshold
      messagesContainer.scrollTop = 460; // 1000 - 460 - 500 = 40

      // Simulate content shrink by reducing scrollHeight
      Object.defineProperty(messagesContainer, 'scrollHeight', {value: 900, configurable: true});

      // Call shrink handler
      scrollManager.handleContentShrink();

      // Wait for double rAF used in scrollToBottom
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Should snap to bottom of new height
      expect(messagesContainer.scrollTop).toBe(900);
    });
  });

  describe('re-arming trigger after pruning', () => {
    it('prunes and reports new first index when history chunk is removed', async () => {
      const pruneSpy = vi.spyOn(mockRenderer, 'pruneByIdx');
      const postSpy = vi.spyOn(mockVscode, 'postMessage');

      // Populate container with more messages than MAX_MESSAGES_IN_DOM
      for (let i = 0; i < 25; i++) {
        const el = document.createElement('div');
        el.dataset.idx = String(100 + i);
        messagesContainer.appendChild(el);
      }

      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1500,
        writable: true,
        configurable: true,
      });
      messagesContainer.scrollTop = 800; // within prune threshold (1500 - 800 - 500 = 200)

      messagesContainer.dispatchEvent(new Event('scroll'));

      expect(pruneSpy).toHaveBeenCalled();

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({type: 'visibleFirstIdx'}));
    });

    it('re-arms trigger after pruning so user can load history again', () => {
      const postSpy = mockVscode.postMessage as ReturnType<typeof vi.fn>;
      postSpy.mockClear();

      // Initialize lastScrollTop
      messagesContainer.scrollTop = 400;
      messagesContainer.dispatchEvent(new Event('scroll'));
      postSpy.mockClear();

      // Step 1: Scroll back and trigger history load
      messagesContainer.scrollTop = 50;
      messagesContainer.dispatchEvent(new Event('scroll'));
      let loadCalls = postSpy.mock.calls.filter((c) => c[0]?.type === WEBVIEW_IN_MSG.LOAD_MORE_HISTORY);
      expect(loadCalls.length).toBe(1);

      // Step 2: Finish loading, trigger disarms
      scrollManager.finishHistoryLoad();

      // Step 3: Trigger pruning by scrolling near bottom
      Object.defineProperty(messagesContainer, 'scrollHeight', {value: 1500, writable: true, configurable: true});
      messagesContainer.scrollTop = 800; // 1500 - 800 - 500 = 200 (triggers prune)
      messagesContainer.dispatchEvent(new Event('scroll'));
      expect(mockRenderer.pruneByIdx).toHaveBeenCalled();

      // Step 4: After pruning, scrollHeight decreases
      Object.defineProperty(messagesContainer, 'scrollHeight', {value: 900, writable: true, configurable: true});
      messagesContainer.scrollTop = 250;

      // Step 5: Scroll back again - should trigger because prune re-armed
      postSpy.mockClear();
      messagesContainer.scrollTop = 80;
      messagesContainer.dispatchEvent(new Event('scroll'));

      loadCalls = postSpy.mock.calls.filter((c) => c[0]?.type === WEBVIEW_IN_MSG.LOAD_MORE_HISTORY);
      expect(loadCalls.length).toBe(1);
    });

    it('reproduces the bug scenario: back-forward-back scroll cycle', () => {
      const postSpy = mockVscode.postMessage as ReturnType<typeof vi.fn>;

      // Initialize scroll position
      messagesContainer.scrollTop = 400;
      messagesContainer.dispatchEvent(new Event('scroll'));
      postSpy.mockClear();

      // User scrolls back -> history loads
      messagesContainer.scrollTop = 50;
      messagesContainer.dispatchEvent(new Event('scroll'));
      expect(postSpy.mock.calls.some((c) => c[0]?.type === WEBVIEW_IN_MSG.LOAD_MORE_HISTORY)).toBe(true);

      scrollManager.finishHistoryLoad();

      // User scrolls forward -> pruning happens
      Object.defineProperty(messagesContainer, 'scrollHeight', {value: 1500, writable: true, configurable: true});
      messagesContainer.scrollTop = 800;
      messagesContainer.dispatchEvent(new Event('scroll'));

      // After pruning, scrollHeight decreases
      Object.defineProperty(messagesContainer, 'scrollHeight', {value: 900, writable: true, configurable: true});
      messagesContainer.scrollTop = 250;

      // User scrolls back again
      postSpy.mockClear();
      messagesContainer.scrollTop = 80;
      messagesContainer.dispatchEvent(new Event('scroll'));

      // With fix: trigger is re-armed after prune, so history loads
      // Without fix: trigger not re-armed, no history request
      const loadCalls = postSpy.mock.calls.filter((c) => c[0]?.type === WEBVIEW_IN_MSG.LOAD_MORE_HISTORY);
      expect(loadCalls.length).toBe(1);
    });
  });
});
