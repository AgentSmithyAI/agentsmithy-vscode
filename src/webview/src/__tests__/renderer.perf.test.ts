/**
 * @vitest-environment jsdom
 */
import {describe, it, expect, vi} from 'vitest';

// Track constructor calls
const markdownItConstructorSpy = vi.fn();

vi.mock('markdown-it', () => {
  return {
    default: class {
      constructor(options?: any) {
        markdownItConstructorSpy(options);
      }
      render(text: string) {
        return text;
      }
    },
  };
});

import {MessageRenderer} from '../renderer';

describe('MessageRenderer Performance', () => {
  it('should reuse MarkdownIt instance', () => {
    const container = document.createElement('div');

    // Reset spy before test to ensure clean state
    markdownItConstructorSpy.mockClear();

    const renderer = new MessageRenderer(container, null, '/root');

    // Should be called once on instantiation
    expect(markdownItConstructorSpy).toHaveBeenCalledTimes(1);

    // Render multiple times
    renderer.renderMarkdown('test 1');
    renderer.renderMarkdown('test 2');
    renderer.renderMarkdown('test 3');

    // Should still be called only once (reused)
    expect(markdownItConstructorSpy).toHaveBeenCalledTimes(1);
  });
});
