/**
 * @vitest-environment jsdom
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MessageRenderer} from '../renderer';

// Mock marked library
interface MarkedMock {
  parse: (text: string, options?: {breaks?: boolean; gfm?: boolean}) => string;
  Renderer: new () => unknown;
  setOptions: (options: unknown) => void;
}

global.marked = {
  parse: (text: string) => `<p>${text}</p>`,
  Renderer: function () {
    return {};
  },
  setOptions: vi.fn(),
} as unknown as MarkedMock;

describe('MessageRenderer with smart auto-scroll', () => {
  let messagesContainer: HTMLElement;
  let renderer: MessageRenderer;
  let mockScrollManager: {isAtBottom: () => boolean};

  beforeEach(() => {
    // Create DOM elements
    messagesContainer = document.createElement('div');
    document.body.appendChild(messagesContainer);

    // Create renderer
    renderer = new MessageRenderer(messagesContainer, null, '/test/workspace');

    // Create mock scroll manager
    mockScrollManager = {
      isAtBottom: vi.fn(() => true), // Default: user is at bottom
    };

    // Connect scroll manager to renderer
    renderer.setScrollManager(mockScrollManager);
  });

  afterEach(() => {
    document.body.removeChild(messagesContainer);
  });

  describe('addMessage', () => {
    it('should auto-scroll when user is at bottom', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => true);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 0;

      renderer.addMessage('assistant', 'Test message');

      // Wait for double rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should have scrolled to bottom
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should NOT auto-scroll when user is scrolled up', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => false);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 100;

      renderer.addMessage('assistant', 'Test message');

      // Wait for potential rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should NOT have scrolled
      expect(messagesContainer.scrollTop).toBe(100);
    });
  });

  describe('createReasoningBlock', () => {
    it('should auto-scroll when user is at bottom', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => true);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 0;

      renderer.createReasoningBlock();

      // Wait for double rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should have scrolled to bottom
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should NOT auto-scroll when user is scrolled up', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => false);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 100;

      renderer.createReasoningBlock();

      // Wait for potential rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should NOT have scrolled
      expect(messagesContainer.scrollTop).toBe(100);
    });

    it('collapsing reasoning near bottom snaps to bottom (prevents drift)', async () => {
      // Mock isAtBottom to true so auto-scroll is allowed
      const handleContentShrink = vi.fn();
      mockScrollManager = {
        isAtBottom: vi.fn(() => true),
        // @ts-expect-error - optional hook used by renderer
        handleContentShrink,
      };
      renderer.setScrollManager(mockScrollManager);

      // Prepare scroll container
      Object.defineProperty(messagesContainer, 'scrollHeight', {value: 1200, configurable: true});
      messagesContainer.scrollTop = 700; // not relevant; auto-scroll will move to bottom

      const rb = renderer.createReasoningBlock();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Collapse the block
      rb.header.click();

      expect(handleContentShrink).toHaveBeenCalledTimes(1);
    });
  });

  describe('showError', () => {
    it('should auto-scroll when user is at bottom', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => true);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 0;

      const initialChildCount = messagesContainer.children.length;

      renderer.showError('Test error');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);
      const errorElement = messagesContainer.lastChild as HTMLElement;
      expect(errorElement.className).toBe('error');

      // Wait for double rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should have scrolled to bottom
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should NOT auto-scroll when user is scrolled up', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => false);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 100;

      const initialChildCount = messagesContainer.children.length;
      renderer.showError('Test error');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);

      // Wait for potential rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should NOT have scrolled
      expect(messagesContainer.scrollTop).toBe(100);
    });
  });

  describe('showInfo', () => {
    it('should auto-scroll when user is at bottom', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => true);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 0;

      const initialChildCount = messagesContainer.children.length;
      renderer.showInfo('Test info');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);
      const infoElement = messagesContainer.lastChild as HTMLElement;
      expect(infoElement.className).toBe('info');

      // Wait for double rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should have scrolled to bottom
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should NOT auto-scroll when user is scrolled up', async () => {
      mockScrollManager.isAtBottom = vi.fn(() => false);

      // Mock scrollHeight as readonly property
      Object.defineProperty(messagesContainer, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });

      // Set initial scroll position
      messagesContainer.scrollTop = 100;

      const initialChildCount = messagesContainer.children.length;
      renderer.showInfo('Test info');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);

      // Wait for potential rAF
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Should NOT have scrolled
      expect(messagesContainer.scrollTop).toBe(100);
    });
  });

  describe('suppressAutoScroll mode', () => {
    it('should NOT auto-scroll even when at bottom if suppressed', () => {
      const scrollIntoViewSpy = vi.fn();

      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag);
        element.scrollIntoView = scrollIntoViewSpy;
        return element;
      });

      mockScrollManager.isAtBottom = vi.fn(() => true);
      renderer.setSuppressAutoScroll(true);

      renderer.addMessage('assistant', 'Test message');

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it('should preserve scroll position when adding user message while scrolled up', () => {
      const scrollIntoViewSpy = vi.fn();

      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag);
        element.scrollIntoView = scrollIntoViewSpy;
        return element;
      });

      // User is NOT at bottom (scrolled up reading history)
      mockScrollManager.isAtBottom = vi.fn(() => false);
      renderer.setSuppressAutoScroll(true);

      // Add user message (like when sending a new message)
      renderer.addMessage('user', 'New question while reading history');

      // Should NOT scroll
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      renderer.setSuppressAutoScroll(false);
      vi.restoreAllMocks();
    });
  });

  describe('scrollManager not set', () => {
    it('should handle missing scrollManager gracefully', () => {
      // Create renderer without scroll manager
      const rendererWithoutScroll = new MessageRenderer(messagesContainer, null, '/test/workspace');

      // Should not throw
      expect(() => {
        rendererWithoutScroll.addMessage('assistant', 'Test');
      }).not.toThrow();
    });
  });
});
