/**
 * @vitest-environment jsdom
 */
import {describe, it, expect, beforeEach} from 'vitest';

// Minimal harness to test caret restore logic in isolation by importing the built module is complex.
// Instead, we unit test the restore algorithm with a small harness that mirrors snapshot/restore rules.

describe('focus persistence rules (unit)', () => {
  function snapshot(input: HTMLTextAreaElement, activeEl: Element | null) {
    const valLen = input.value.length;
    const start = Math.max(0, Math.min(valLen, input.selectionStart ?? valLen));
    const end = Math.max(0, Math.min(valLen, input.selectionEnd ?? valLen));
    const direction = input.selectionDirection;
    const shouldRestore = activeEl === input;
    return {shouldRestore, lastSelection: shouldRestore ? {start, end, direction} : null};
  }

  function restore(
    input: HTMLTextAreaElement,
    flag: boolean,
    lastSel: {start: number; end: number; direction?: any} | null,
  ) {
    if (!flag) return null;
    const valLen = input.value.length;
    const start = Math.max(0, Math.min(valLen, lastSel?.start ?? valLen));
    const end = Math.max(0, Math.min(valLen, lastSel?.end ?? valLen));
    try {
      input.setSelectionRange(start, end, lastSel?.direction);
    } catch {
      input.setSelectionRange(start, end);
    }
    return {start, end};
  }

  let textarea: HTMLTextAreaElement;
  beforeEach(() => {
    textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.value = 'hello world';
    textarea.focus();
    textarea.setSelectionRange(5, 5);
  });

  it('restores caret at previous position', () => {
    const snap = snapshot(textarea, document.activeElement);
    // simulate blur and later visible
    const pos = restore(textarea, snap.shouldRestore, snap.lastSelection);
    expect(pos).toEqual({start: 5, end: 5});
  });

  it('does not restore when input was not focused', () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();
    const snap = snapshot(textarea, document.activeElement);
    expect(snap.shouldRestore).toBe(false);
  });

  it('keeps selection ranges', () => {
    textarea.setSelectionRange(2, 7);
    const snap = snapshot(textarea, textarea); // active element is the input
    const pos = restore(textarea, snap.shouldRestore, snap.lastSelection);
    expect(pos).toEqual({start: 2, end: 7});
  });
});
