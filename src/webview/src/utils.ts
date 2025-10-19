/**
 * Utility functions for webview
 */

export const escapeHtml = (str: unknown): string => {
  const s = str === undefined || str === null ? '' : String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const linkifyUrls = (text: string): string => {
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^[\]`]+)/g;
  return text.replace(/\n/g, '<br>').replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
};

export const stripProjectPrefix = (filePath: string, workspaceRoot: string): string => {
  if (!filePath || !workspaceRoot) {
    return filePath;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/');

  if (normalizedPath.startsWith(normalizedRoot)) {
    let relative = normalizedPath.substring(normalizedRoot.length);
    if (relative.startsWith('/')) {
      relative = relative.substring(1);
    }
    return relative || '.';
  }

  return filePath;
};

export const formatDiff = (diff: string): string => {
  const esc = escapeHtml;
  const lines = String(diff || '').split('\n');
  return lines
    .map((line) => {
      let cls = '';
      if (line.startsWith('@@')) {
        cls = 'hunk';
      } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff')) {
        cls = 'meta';
      } else if (line.startsWith('+')) {
        cls = 'added';
      } else if (line.startsWith('-')) {
        cls = 'removed';
      }
      return '<span class="diff-line ' + cls + '">' + esc(line) + '</span>';
    })
    .join('');
};
