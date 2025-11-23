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

  describe('code blocks with syntax highlighting', () => {
    it('renders code block with language label', () => {
      const input = '```python\nprint("hello")\n```';
      const output = renderer.renderMarkdown(input);
      
      // Should contain wrapper
      expect(output).toContain('code-block-wrapper');
      
      // Should contain language label
      expect(output).toContain('code-language');
      expect(output).toContain('python');
      
      // Should contain copy button
      expect(output).toContain('copy-code-btn');
      expect(output).toContain('codicon-copy');
    });

    it('renders code block without language', () => {
      const input = '```\nplain code\n```';
      const output = renderer.renderMarkdown(input);
      
      // Should still have wrapper and copy button
      expect(output).toContain('code-block-wrapper');
      expect(output).toContain('copy-code-btn');
      
      // Should have code content
      expect(output).toContain('plain code');
    });

    it('applies syntax highlighting for supported languages', () => {
      const input = '```javascript\nconst x = 42;\n```';
      const output = renderer.renderMarkdown(input);
      
      // Should have language class
      expect(output).toContain('language-javascript');
      
      // Should have hljs class
      expect(output).toContain('hljs');
    });

    it('renders inline code without copy button', () => {
      const input = 'Use `npm install` command';
      const output = renderer.renderMarkdown(input);
      
      // Should contain code tag
      expect(output).toContain('<code>');
      expect(output).toContain('npm install');
      
      // Should NOT contain copy button (only for code blocks)
      expect(output).not.toContain('copy-code-btn');
    });

    it('escapes HTML in code blocks', () => {
      const input = '```html\n<script>alert("xss")</script>\n```';
      const output = renderer.renderMarkdown(input);
      
      // highlight.js wraps HTML tags in spans, but they should still be escaped
      // Check that the actual script tag is not executable
      expect(output).toContain('&lt;');
      expect(output).toContain('&gt;');
      
      // Most importantly: raw <script> should not appear unescaped
      // (highlight.js may wrap it in spans, but the angle brackets should be entities)
      const hasRawScriptTag = output.includes('<script>alert');
      expect(hasRawScriptTag).toBe(false);
    });

    it('handles multiple code blocks in same message', () => {
      const input = 'First:\n```python\nprint(1)\n```\n\nSecond:\n```js\nconsole.log(2)\n```';
      const output = renderer.renderMarkdown(input);
      
      // Should have two wrappers
      const wrapperCount = (output.match(/code-block-wrapper/g) || []).length;
      expect(wrapperCount).toBe(2);
      
      // Should have both languages
      expect(output).toContain('python');
      expect(output).toContain('js');
    });
  });
});
