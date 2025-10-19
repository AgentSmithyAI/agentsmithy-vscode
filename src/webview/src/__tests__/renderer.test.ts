/**
 * @vitest-environment jsdom
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MessageRenderer} from '../renderer';

// Mock marked library
global.marked = {
  parse: (text: string) => `<p>${text}</p>`,
  Renderer: function () {
    return {};
  },
  setOptions: vi.fn(),
} as unknown as typeof marked;

describe('MessageRenderer with smart auto-scroll', () => {
  let messagesContainer: HTMLElement;
  let renderer: MessageRenderer;
  let mockScrollManager: {isAtBottom: () => boolean};

  beforeEach(() => {
    // Create DOM elements
    messagesContainer = document.createElement('div');
    document.body.appendChild(messagesContainer);

    // Create renderer
    renderer = new MessageRenderer(messagesContainer, null, null, '/test/workspace');

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
    it('should auto-scroll when user is at bottom', () => {
      const scrollIntoViewSpy = vi.fn();

      // Mock scrollIntoView on the element that will be created
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag);
        element.scrollIntoView = scrollIntoViewSpy;
        return element;
      });

      mockScrollManager.isAtBottom = vi.fn(() => true);

      renderer.addMessage('assistant', 'Test message');

      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      });

      vi.restoreAllMocks();
    });

    it('should NOT auto-scroll when user is scrolled up', () => {
      const scrollIntoViewSpy = vi.fn();

      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag);
        element.scrollIntoView = scrollIntoViewSpy;
        return element;
      });

      mockScrollManager.isAtBottom = vi.fn(() => false);

      renderer.addMessage('assistant', 'Test message');

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });

  describe('createReasoningBlock', () => {
    it('should auto-scroll when user is at bottom', () => {
      const scrollIntoViewSpy = vi.fn();

      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag);
        element.scrollIntoView = scrollIntoViewSpy;
        return element;
      });

      mockScrollManager.isAtBottom = vi.fn(() => true);

      renderer.createReasoningBlock();

      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      });

      vi.restoreAllMocks();
    });

    it('should NOT auto-scroll when user is scrolled up', () => {
      const scrollIntoViewSpy = vi.fn();

      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag);
        element.scrollIntoView = scrollIntoViewSpy;
        return element;
      });

      mockScrollManager.isAtBottom = vi.fn(() => false);

      renderer.createReasoningBlock();

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });

  describe('showError', () => {
    it('should auto-scroll when user is at bottom', () => {
      mockScrollManager.isAtBottom = vi.fn(() => true);

      const initialChildCount = messagesContainer.children.length;

      // Mock scrollIntoView for elements created in showError
      const scrollIntoViewSpy = vi.fn();
      const originalAppendChild = messagesContainer.appendChild.bind(messagesContainer);
      vi.spyOn(messagesContainer, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLElement) {
          node.scrollIntoView = scrollIntoViewSpy;
        }
        return originalAppendChild(node);
      });

      renderer.showError('Test error');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);
      const errorElement = messagesContainer.lastChild as HTMLElement;
      expect(errorElement.className).toBe('error');
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      });

      vi.restoreAllMocks();
    });

    it('should NOT auto-scroll when user is scrolled up', () => {
      mockScrollManager.isAtBottom = vi.fn(() => false);

      const scrollIntoViewSpy = vi.fn();
      const originalAppendChild = messagesContainer.appendChild.bind(messagesContainer);
      vi.spyOn(messagesContainer, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLElement) {
          node.scrollIntoView = scrollIntoViewSpy;
        }
        return originalAppendChild(node);
      });

      const initialChildCount = messagesContainer.children.length;
      renderer.showError('Test error');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });

  describe('showInfo', () => {
    it('should auto-scroll when user is at bottom', () => {
      mockScrollManager.isAtBottom = vi.fn(() => true);

      const scrollIntoViewSpy = vi.fn();
      const originalAppendChild = messagesContainer.appendChild.bind(messagesContainer);
      vi.spyOn(messagesContainer, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLElement) {
          node.scrollIntoView = scrollIntoViewSpy;
        }
        return originalAppendChild(node);
      });

      const initialChildCount = messagesContainer.children.length;
      renderer.showInfo('Test info');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);
      const infoElement = messagesContainer.lastChild as HTMLElement;
      expect(infoElement.className).toBe('info');
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      });

      vi.restoreAllMocks();
    });

    it('should NOT auto-scroll when user is scrolled up', () => {
      mockScrollManager.isAtBottom = vi.fn(() => false);

      const scrollIntoViewSpy = vi.fn();
      const originalAppendChild = messagesContainer.appendChild.bind(messagesContainer);
      vi.spyOn(messagesContainer, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLElement) {
          node.scrollIntoView = scrollIntoViewSpy;
        }
        return originalAppendChild(node);
      });

      const initialChildCount = messagesContainer.children.length;
      renderer.showInfo('Test info');

      expect(messagesContainer.children.length).toBe(initialChildCount + 1);
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      vi.restoreAllMocks();
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
      const rendererWithoutScroll = new MessageRenderer(messagesContainer, null, null, '/test/workspace');

      // Should not throw
      expect(() => {
        rendererWithoutScroll.addMessage('assistant', 'Test');
      }).not.toThrow();
    });
  });
});
