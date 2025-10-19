import {SSE_EVENT_TYPES as E} from '../../constants';
import {normalizeSSEEvent} from '../../shared/sseNormalizer';
import {SSEStreamReader} from '../SSEStreamReader';

describe('SSEStreamReader', () => {
  let reader: SSEStreamReader;

  beforeEach(() => {
    reader = new SSEStreamReader(normalizeSSEEvent);
  });

  it('processes single-line data events', () => {
    const chunk = 'data: {"type":"chat","content":"hello"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'hello'});
  });

  it('processes multiple events in one chunk', () => {
    const chunk = 'data: {"type":"chat_start"}\n\ndata: {"type":"chat","content":"hi"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({type: E.CHAT_START});
    expect(events[1]).toEqual({type: E.CHAT, content: 'hi'});
  });

  it('handles multi-line data events', () => {
    const chunk = 'data: {"type":"chat",\ndata: "content":"multi"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'multi'});
  });

  it('buffers incomplete events', () => {
    const chunk1 = 'data: {"type":"chat"';
    const chunk2 = ',"content":"split"}\n\n';

    let events = Array.from(reader.processChunk(chunk1));
    expect(events).toHaveLength(0);

    events = Array.from(reader.processChunk(chunk2));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'split'});
  });

  it('handles events split across chunks', () => {
    const chunk1 = 'data: {"type":"cha';
    const chunk2 = 't","content":"test"}\n\n';

    Array.from(reader.processChunk(chunk1));
    const events = Array.from(reader.processChunk(chunk2));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'test'});
  });

  it('stops processing after done event', () => {
    const chunk =
      'data: {"type":"chat","content":"hi"}\n\ndata: {"type":"done"}\n\ndata: {"type":"chat","content":"ignored"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({type: E.CHAT, content: 'hi'});
    expect(events[1]).toEqual({type: E.DONE, dialog_id: undefined});
  });

  it('ignores invalid JSON', () => {
    const chunk = 'data: invalid json\n\ndata: {"type":"chat","content":"ok"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'ok'});
  });

  it('handles empty lines correctly', () => {
    const chunk = 'data: {"type":"chat","content":"test"}\n\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'test'});
  });

  it('processes tool_call events', () => {
    const chunk = 'data: {"type":"tool_call","name":"read_file","args":{"path":"test.ts"}}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: E.TOOL_CALL,
      name: 'read_file',
      args: {path: 'test.ts'},
    });
  });

  it('processes error events', () => {
    const chunk = 'data: {"type":"error","error":"Something went wrong"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.ERROR, error: 'Something went wrong'});
  });

  it('handles Windows-style line endings', () => {
    const chunk = 'data: {"type":"chat","content":"win"}\r\n\r\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'win'});
  });

  it('resets state correctly', () => {
    const chunk = 'data: {"type":"chat"';
    Array.from(reader.processChunk(chunk));

    reader.reset();

    const chunk2 = 'data: {"type":"chat","content":"new"}\n\n';
    const events = Array.from(reader.processChunk(chunk2));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({type: E.CHAT, content: 'new'});
  });

  it('handles reasoning events', () => {
    const chunk =
      'data: {"type":"reasoning_start"}\n\ndata: {"type":"reasoning","content":"thinking..."}\n\ndata: {"type":"reasoning_end"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({type: E.REASONING_START});
    expect(events[1]).toEqual({type: E.REASONING, content: 'thinking...'});
    expect(events[2]).toEqual({type: E.REASONING_END});
  });

  it('processes file_edit events with legacy aliases', () => {
    const chunk = 'data: {"type":"patch","path":"test.ts","patch":"diff content","checkpoint":"c1"}\n\n';
    const events = Array.from(reader.processChunk(chunk));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: E.FILE_EDIT,
      file: 'test.ts',
      diff: 'diff content',
      checkpoint: 'c1',
    });
  });
});
