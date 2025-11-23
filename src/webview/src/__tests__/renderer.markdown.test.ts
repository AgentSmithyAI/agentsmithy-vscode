/**
 * @vitest-environment jsdom
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {MessageRenderer} from '../renderer';

describe('MessageRenderer - Markdown', () => {
  let renderer: MessageRenderer;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    renderer = new MessageRenderer(container, null, '/root');
  });

  it('renders basic markdown', () => {
    const input = '**bold** and *italic*';
    const output = renderer.renderMarkdown(input);
    expect(output).toContain('<strong>bold</strong>');
    expect(output).toContain('<em>italic</em>');
  });

  it('renders links', () => {
    const input = '[link](https://example.com)';
    const output = renderer.renderMarkdown(input);
    expect(output).toContain('<a href="https://example.com">link</a>');
  });

  it('handles undefined/null gracefully', () => {
    const output = renderer.renderMarkdown(undefined as any);
    expect(output).toBe('');
  });

  it('reuses markdown-it instance (performance check simulation)', () => {
    // This is hard to check explicitly without mocking MarkdownIt constructor
    // But we can check it basically works multiple times
    const out1 = renderer.renderMarkdown('test 1');
    const out2 = renderer.renderMarkdown('test 2');
    expect(out1).toContain('test 1');
    expect(out2).toContain('test 2');
  });
});
