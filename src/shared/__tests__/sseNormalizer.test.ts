import {normalizeSSEEvent} from '../sseNormalizer';

describe('normalizeSSEEvent', () => {
  it('returns null for non-object', () => {
    expect(normalizeSSEEvent(null)).toBeNull();
    // @ts-expect-error
    expect(normalizeSSEEvent(undefined)).toBeNull();
    // @ts-expect-error
    expect(normalizeSSEEvent(123)).toBeNull();
  });

  it('normalizes file_edit variants', () => {
    expect(normalizeSSEEvent({type: 'patch', path: 'a.ts', patch: 'diff', checkpoint: 'c1'})).toEqual({
      type: 'file_edit',
      file: 'a.ts',
      diff: 'diff',
      checkpoint: 'c1',
    });

    expect(normalizeSSEEvent({type: 'diff', file_path: 'b.ts', diff: 'd'})).toEqual({
      type: 'file_edit',
      file: 'b.ts',
      diff: 'd',
      checkpoint: undefined,
    });

    expect(normalizeSSEEvent({type: 'file_edit', file: 'c.ts', diff: 'd2'})).toEqual({
      type: 'file_edit',
      file: 'c.ts',
      diff: 'd2',
      checkpoint: undefined,
    });
  });

  it('maps chat events', () => {
    expect(normalizeSSEEvent({type: 'chat_start'})).toEqual({type: 'chat_start'});
    expect(normalizeSSEEvent({type: 'chat', content: 'hi'})).toEqual({type: 'chat', content: 'hi'});
    expect(normalizeSSEEvent({type: 'chat', content: 1})).toEqual({type: 'chat', content: ''});
    expect(normalizeSSEEvent({type: 'chat_end'})).toEqual({type: 'chat_end'});
  });

  it('maps reasoning events', () => {
    expect(normalizeSSEEvent({type: 'reasoning_start'})).toEqual({type: 'reasoning_start'});
    expect(normalizeSSEEvent({type: 'reasoning', content: 'think'})).toEqual({
      type: 'reasoning',
      content: 'think',
    });
    expect(normalizeSSEEvent({type: 'reasoning', content: 0})).toEqual({type: 'reasoning', content: ''});
    expect(normalizeSSEEvent({type: 'reasoning_end'})).toEqual({type: 'reasoning_end'});
  });

  it('maps tool_call', () => {
    expect(normalizeSSEEvent({type: 'tool_call', name: 'edit', args: {a: 1}})).toEqual({
      type: 'tool_call',
      name: 'edit',
      args: {a: 1},
    });
    expect(normalizeSSEEvent({type: 'tool_call'})).toEqual({type: 'tool_call', name: '', args: undefined});
  });

  it('maps error', () => {
    expect(normalizeSSEEvent({type: 'error', error: 'bad'})).toEqual({type: 'error', error: 'bad'});
    expect(normalizeSSEEvent({type: 'error', message: 'oops'})).toEqual({type: 'error', error: 'oops'});
    expect(normalizeSSEEvent({type: 'error'})).toEqual({type: 'error', error: 'Unknown error'});
  });

  it('maps done', () => {
    expect(normalizeSSEEvent({type: 'done', dialog_id: 'd1'})).toEqual({type: 'done', dialog_id: 'd1'});
    expect(normalizeSSEEvent({type: 'done'})).toEqual({type: 'done', dialog_id: undefined});
  });

  it('fallbacks to chat when content present but no type', () => {
    expect(normalizeSSEEvent({content: 'hello'})).toEqual({type: 'chat', content: 'hello'});
    expect(normalizeSSEEvent({content: 1})).toBeNull();
  });
});
