import { escapeHtml, formatDiff, linkifyUrls, stripProjectPrefix } from '../utils';

describe('webview utils', () => {
  describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escapeHtml('a & b')).toBe('a &amp; b');
      expect(escapeHtml("it's a test")).toBe('it&#39;s a test');
    });

    it('handles all special characters', () => {
      expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('handles null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('converts non-string values to strings', () => {
      expect(escapeHtml(123)).toBe('123');
      expect(escapeHtml(true)).toBe('true');
    });

    it('handles empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('linkifyUrls', () => {
    it('converts URLs to clickable links', () => {
      const text = 'Check this out: https://example.com';
      const result = linkifyUrls(text);
      expect(result).toBe(
        'Check this out: <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>',
      );
    });

    it('handles http and https URLs', () => {
      const text = 'http://test.com and https://secure.test.com';
      const result = linkifyUrls(text);
      expect(result).toContain('<a href="http://test.com"');
      expect(result).toContain('<a href="https://secure.test.com"');
    });

    it('handles multiple URLs in one text', () => {
      const text = 'Visit https://first.com and https://second.com';
      const result = linkifyUrls(text);
      const linkCount = (result.match(/<a href=/g) || []).length;
      expect(linkCount).toBe(2);
    });

    it('converts newlines to br tags', () => {
      const text = 'line1\nline2\nline3';
      const result = linkifyUrls(text);
      expect(result).toBe('line1<br>line2<br>line3');
    });

    it('handles URLs with paths and query params', () => {
      const text = 'https://example.com/path?param=value&other=123';
      const result = linkifyUrls(text);
      expect(result).toContain('<a href="https://example.com/path?param=value&other=123"');
    });

    it('does not linkify URLs in angle brackets or quotes', () => {
      const text = 'Normal url https://example.com works';
      const result = linkifyUrls(text);
      expect(result).toContain('<a href="https://example.com"');
    });
  });

  describe('stripProjectPrefix', () => {
    it('strips workspace root from absolute paths', () => {
      const result = stripProjectPrefix('/home/user/project/src/file.ts', '/home/user/project');
      expect(result).toBe('src/file.ts');
    });

    it('handles trailing slashes in workspace root', () => {
      const result = stripProjectPrefix('/home/user/project/src/file.ts', '/home/user/project/');
      expect(result).toBe('src/file.ts');
    });

    it('returns original path if not under workspace', () => {
      const result = stripProjectPrefix('/other/path/file.ts', '/home/user/project');
      expect(result).toBe('/other/path/file.ts');
    });

    it('handles Windows-style paths', () => {
      const result = stripProjectPrefix('C:\\Users\\test\\project\\src\\file.ts', 'C:\\Users\\test\\project');
      expect(result).toBe('src/file.ts');
    });

    it('returns dot for workspace root itself', () => {
      const result = stripProjectPrefix('/home/user/project', '/home/user/project');
      expect(result).toBe('.');
    });

    it('handles empty inputs', () => {
      expect(stripProjectPrefix('', '/home/user/project')).toBe('');
      expect(stripProjectPrefix('/home/user/project/file.ts', '')).toBe('/home/user/project/file.ts');
    });

    it('normalizes mixed slashes', () => {
      const result = stripProjectPrefix('/home/user/project\\src\\file.ts', '/home/user/project');
      expect(result).toBe('src/file.ts');
    });
  });

  describe('formatDiff', () => {
    it('formats diff hunks with hunk class', () => {
      const diff = '@@ -1,3 +1,4 @@';
      const result = formatDiff(diff);
      expect(result).toContain('class="diff-line hunk"');
      expect(result).toContain('@@ -1,3 +1,4 @@');
    });

    it('formats added lines with added class', () => {
      const diff = '+new line';
      const result = formatDiff(diff);
      expect(result).toContain('class="diff-line added"');
      expect(result).toContain('+new line');
    });

    it('formats removed lines with removed class', () => {
      const diff = '-old line';
      const result = formatDiff(diff);
      expect(result).toContain('class="diff-line removed"');
      expect(result).toContain('-old line');
    });

    it('formats metadata lines with meta class', () => {
      const diff = '--- a/file.ts\n+++ b/file.ts\ndiff --git';
      const result = formatDiff(diff);
      expect(result).toContain('class="diff-line meta"');
    });

    it('handles multi-line diffs', () => {
      const diff = '@@ -1,3 +1,4 @@\n-old\n+new\n unchanged';
      const result = formatDiff(diff);
      expect(result).toContain('class="diff-line hunk"');
      expect(result).toContain('class="diff-line removed"');
      expect(result).toContain('class="diff-line added"');
      expect(result).toContain('class="diff-line "');
    });

    it('escapes HTML in diff content', () => {
      const diff = '+<script>alert("xss")</script>';
      const result = formatDiff(diff);
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });

    it('handles empty diff', () => {
      expect(formatDiff('')).toBe('<span class="diff-line "></span>');
    });

    it('handles null and undefined', () => {
      // @ts-expect-error testing runtime behavior
      expect(formatDiff(null)).toContain('span');
      // @ts-expect-error testing runtime behavior
      expect(formatDiff(undefined)).toContain('span');
    });
  });
});

