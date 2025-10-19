/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ScrollManager} from '../ScrollManager';
import {MessageRenderer} from '../renderer';
import {VSCodeAPI} from '../types';

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
      // scrollHeight - scrollTop - clientHeight < 200
      // 1000 - 350 - 500 = 150 < 200 ✓
      messagesContainer.scrollTop = 350;
      expect(scrollManager.isAtBottom()).toBe(true);
    });

    it('should return true when exactly at the bottom', () => {
      // 1000 - 500 - 500 = 0 < 200 ✓
      messagesContainer.scrollTop = 500;
      expect(scrollManager.isAtBottom()).toBe(true);
    });

    it('should return false when scrolled up beyond threshold', () => {
      // 1000 - 0 - 500 = 500 > 200 ✗
      messagesContainer.scrollTop = 0;
      expect(scrollManager.isAtBottom()).toBe(false);
    });

    it('should return false when in the middle', () => {
      // 1000 - 250 - 500 = 250 > 200 ✗
      messagesContainer.scrollTop = 250;
      expect(scrollManager.isAtBottom()).toBe(false);
    });

    it('should handle edge case at threshold boundary', () => {
      // Exactly at threshold: 1000 - 300 - 500 = 200
      messagesContainer.scrollTop = 300;
      expect(scrollManager.isAtBottom()).toBe(false);

      // Just inside threshold: 1000 - 301 - 500 = 199 < 200 ✓
      messagesContainer.scrollTop = 301;
      expect(scrollManager.isAtBottom()).toBe(true);
    });
  });

  describe('scrollIntoViewIfAtBottom', () => {
    let testElement: HTMLElement;

    beforeEach(() => {
      testElement = document.createElement('div');
      testElement.scrollIntoView = vi.fn();
    });

    it('should scroll element into view when at bottom', () => {
      // Position at bottom
      messagesContainer.scrollTop = 500;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      expect(testElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      });
    });

    it('should NOT scroll element into view when scrolled up', () => {
      // Position at top
      messagesContainer.scrollTop = 0;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      expect(testElement.scrollIntoView).not.toHaveBeenCalled();
    });

    it('should scroll when within bottom threshold', () => {
      // Just within threshold
      messagesContainer.scrollTop = 350;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      expect(testElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      });
    });

    it('should NOT scroll when just outside threshold', () => {
      // Just outside threshold: 1000 - 250 - 500 = 250 > 200
      messagesContainer.scrollTop = 250;

      scrollManager.scrollIntoViewIfAtBottom(testElement);

      expect(testElement.scrollIntoView).not.toHaveBeenCalled();
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
  });
});
