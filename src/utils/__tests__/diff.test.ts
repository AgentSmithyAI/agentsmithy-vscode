import {describe, it, expect} from 'vitest';
import {applyUnifiedPatchSafe, buildPairFromUnifiedDiff} from '../diff';

// Helper to join lines with \n and ensure trailing newline where intended
const j = (lines: string[]) => lines.join('\n');

describe('applyUnifiedPatchSafe', () => {
  it('applies a simple line modification (strict unified diff)', () => {
    const base = j(['line1', 'line2', 'line3']) + '\n';
    const diff = ['--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' line1', '-line2', '+line2-changed', ' line3', ''].join(
      '\n',
    );

    const out = applyUnifiedPatchSafe(base, diff);
    expect(out).toBe(j(['line1', 'line2-changed', 'line3']) + '\n');
  });

  it('returns null when hunk does not match base strictly', () => {
    const base = j(['a', 'b', 'c']) + '\n';
    // The hunk claims to replace `NOPE` which is not in base -> should fail strictly
    const badDiff = ['--- a/y', '+++ b/y', '@@ -2,1 +2,1 @@', '-NOPE', '+bb', ''].join('\n');

    const out = applyUnifiedPatchSafe(base, badDiff);
    expect(out).toBeNull();
  });

  it('supports insertion of a new line', () => {
    const base = j(['a', 'b', 'c']) + '\n';
    const diff = ['--- a/z', '+++ b/z', '@@ -1,3 +1,4 @@', ' a', ' b', '+b.5', ' c', ''].join('\n');

    const out = applyUnifiedPatchSafe(base, diff);
    expect(out).toBe(j(['a', 'b', 'b.5', 'c']) + '\n');
  });
});
describe('buildPairFromUnifiedDiff', () => {
  it('returns original/modified pair for valid diff (diff-only)', () => {
    const diff = ['--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', '-x', '+xx', ' y', ''].join('\n');

    const pair = buildPairFromUnifiedDiff(diff);
    expect(pair).not.toBeNull();
    expect(pair!.original).toBe(j(['x', 'y']) + '\n');
    expect(pair!.modified).toBe(j(['xx', 'y']) + '\n');
  });

  it('produces pair from diff lines; null for noop', () => {
    // Hunk with explicit changes
    const bad = ['--- a/f', '+++ b/f', '@@ -1,1 +1,1 @@', '-bar', '+baz', ''].join('\n');

    const pair1 = buildPairFromUnifiedDiff(bad);
    expect(pair1).not.toBeNull();
    expect(pair1!.original).toBe('bar\n');
    expect(pair1!.modified).toBe('baz\n');

    // No-op diff (context only) -> nothing to synthesize
    const noop = ['--- a/f', '+++ b/f', '@@ -1,1 +1,1 @@', ' foo', ''].join('\n');
    expect(buildPairFromUnifiedDiff(noop)).toBeNull();
  });
});
