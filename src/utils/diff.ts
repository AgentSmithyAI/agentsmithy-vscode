import {applyPatch} from 'diff';

// Normalize EOLs to LF
const toLF = (s: string) => s.replace(/\r\n/g, '\n');

// Remove git prelude (diff --git / index / file mode) leaving from first ---/+++ or @@
const stripGitPrelude = (d: string): string => {
  const lines = d.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('--- ') || line.startsWith('@@ ')) {
      break;
    }
    if (line.startsWith('+++ ')) {
      break;
    }
    i++;
  }
  return i > 0 ? lines.slice(i).join('\n') : d;
};

// Ensure unified diff has minimal headers before first hunk
const ensureHeaders = (d: string): string => {
  const hasDash = /\n---\s/.test(`\n${d}`) || d.startsWith('--- ');
  const hasPlus = /\n\+\+\+\s/.test(`\n${d}`) || d.startsWith('+++ ');
  if (hasDash && hasPlus) {
    return d;
  }
  const idx = d.indexOf('\n@@');
  const startAt = d.startsWith('@@') ? 0 : idx >= 0 ? idx + 1 : -1;
  if (startAt === -1) {
    return d;
  }
  const header = '--- a/unknown\n+++ b/unknown\n';
  if (d.startsWith('@@')) {
    return header + d;
  }
  const pos = d.lastIndexOf('\n@@', startAt - 1);
  const insertPos = pos >= 0 ? pos + 1 : 0;
  return d.slice(0, insertPos) + header + d.slice(insertPos);
};

// Ensure trailing newline for patch text
const ensureTrailingNL = (d: string) => (d.length && d[d.length - 1] !== '\n' ? `${d}\n` : d);

/**
 * Parse unified diff and reconstruct synthetic original/modified contents
 * using only hunk bodies (context + additions/deletions). This does not depend on disk base.
 */
export const buildPairFromUnifiedDiff = (unifiedDiff: string): {original: string; modified: string} | null => {
  const lines = toLF(unifiedDiff).split('\n');
  const outOrig: string[] = [];
  const outMod: string[] = [];

  let inHunk = false;
  let changeSeen = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('@@')) {
      inHunk = true;
      // separate hunks by a blank line if not first
      if (outOrig.length > 0 || outMod.length > 0) {
        outOrig.push('');
        outMod.push('');
      }
      continue;
    }
    if (!inHunk) {
      // skip file headers and prelude
      if (l.startsWith('---') || l.startsWith('+++') || l.startsWith('diff ') || l.startsWith('index ')) {
        continue;
      }
      continue;
    }
    if (l.startsWith(' ')) {
      outOrig.push(l.slice(1));
      outMod.push(l.slice(1));
    } else if (l.startsWith('+')) {
      outMod.push(l.slice(1));
      changeSeen = true;
    } else if (l.startsWith('-')) {
      outOrig.push(l.slice(1));
      changeSeen = true;
    } else if (l.startsWith('\\ No newline at end of file')) {
      // ignore
    } else if (l.length === 0) {
      // keep explicit blank line inside hunk
      outOrig.push('');
      outMod.push('');
    } else if (l.startsWith('@@')) {
      // will be handled on next loop iteration
      inHunk = true;
    } else {
      // unknown marker inside hunk -> be conservative and stop
      continue;
    }
  }

  if ((outOrig.length === 0 && outMod.length === 0) || !changeSeen) {
    return null;
  }
  const orig = ensureTrailingNL(outOrig.join('\n'));
  const mod = ensureTrailingNL(outMod.join('\n'));
  return {original: orig, modified: mod};
};
/**
 * Safely apply a unified diff to a base string with strict matching.
 * Tries a few format-normalization variants (no fuzz):
 *  - as-is
 *  - without git prelude
 *  - with minimal ---/+++ headers
 */
export const applyUnifiedPatchSafe = (base: string, unifiedDiff: string): string | null => {
  try {
    const lfBase = toLF(base);
    const raw = ensureTrailingNL(toLF(unifiedDiff));
    const stripped = ensureTrailingNL(stripGitPrelude(raw));
    const withHeaders = ensureTrailingNL(ensureHeaders(stripped));
    const variants = [raw, stripped, withHeaders].filter((v, i, arr) => v && arr.indexOf(v) === i);

    for (const v of variants) {
      const out = applyPatch(lfBase, v, {fuzzFactor: 0});
      if (typeof out === 'string') {
        return out;
      }
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Build an (original, modified) pair by trying to apply the patch to the base.
 * If strict application fails, fall back to constructing pair from diff hunks only.
 */
