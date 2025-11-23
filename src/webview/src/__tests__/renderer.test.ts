/**
 * @vitest-environment jsdom
 */
// Mock markdown-it BEFORE imports
import {vi} from 'vitest';
vi.mock('markdown-it', () => ({
  default: class {
    renderer = {
      rules: {
        fence: null,
      },
    };
    constructor(options?: any) {}
    render(text: string) {
      return text ? `<p>${text}</p>` : '';
    }
  },
}));

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {MessageRenderer} from '../renderer';

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

  describe('code block copy functionality', () => {
    beforeEach(() => {
      // Mock clipboard API
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn(() => Promise.resolve()),
        },
      });
    });

    it('should copy code when copy button is clicked', async () => {
      // Render a message with a code block
      messagesContainer.innerHTML = `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <span class="code-language">python</span>
            <button class="copy-code-btn">
              <i class="codicon codicon-copy"></i>
            </button>
          </div>
          <pre><code class="hljs">print("Hello, World!")</code></pre>
        </div>
      `;

      const copyBtn = messagesContainer.querySelector('.copy-code-btn') as HTMLElement;
      expect(copyBtn).toBeTruthy();

      // Simulate click
      copyBtn.click();

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify clipboard was called with correct text
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('print("Hello, World!")');
    });

    it('should change icon to check mark after successful copy', async () => {
      messagesContainer.innerHTML = `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <button class="copy-code-btn">
              <i class="codicon codicon-copy"></i>
            </button>
          </div>
          <pre><code class="hljs">test code</code></pre>
        </div>
      `;

      const copyBtn = messagesContainer.querySelector('.copy-code-btn') as HTMLElement;
      const icon = copyBtn.querySelector('.codicon') as HTMLElement;

      expect(icon.classList.contains('codicon-copy')).toBe(true);

      copyBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Icon should change to check
      expect(icon.classList.contains('codicon-check')).toBe(true);
      expect(icon.classList.contains('codicon-copy')).toBe(false);
    });

    it('should copy inline code when clicked', async () => {
      messagesContainer.innerHTML = `
        <div class="assistant-message">
          <p>Use <code>npm install</code> to install packages.</p>
        </div>
      `;

      const inlineCode = messagesContainer.querySelector('code') as HTMLElement;
      expect(inlineCode).toBeTruthy();

      inlineCode.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npm install');
    });

    it('should not copy code inside code-block-wrapper when clicked directly', async () => {
      messagesContainer.innerHTML = `
        <div class="code-block-wrapper">
          <pre><code class="hljs">block code</code></pre>
        </div>
      `;

      const codeElement = messagesContainer.querySelector('code') as HTMLElement;
      
      // Reset mock
      (navigator.clipboard.writeText as any).mockClear();

      codeElement.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should NOT copy when clicking code inside code-block-wrapper
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('should handle copy failure gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock clipboard to fail
      (navigator.clipboard.writeText as any).mockRejectedValueOnce(new Error('Clipboard error'));

      messagesContainer.innerHTML = `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <button class="copy-code-btn">
              <i class="codicon codicon-copy"></i>
            </button>
          </div>
          <pre><code class="hljs">test</code></pre>
        </div>
      `;

      const copyBtn = messagesContainer.querySelector('.copy-code-btn') as HTMLElement;
      
      // Should not throw
      expect(() => copyBtn.click()).not.toThrow();
      
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalled();
      
      consoleErrorSpy.mockRestore();
    });
  });
});
