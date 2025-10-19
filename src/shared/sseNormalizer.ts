import type {SSEEvent} from '../api/StreamService';

/**
 * Normalize raw server-sent event payloads into internal SSEEvent format.
 */
export const normalizeSSEEvent = (raw: unknown): SSEEvent | null => {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const get = (k: string): unknown => obj[k];
  const type = typeof get('type') === 'string' ? (get('type') as string) : undefined;

  // Normalize patch/diff/file_edit
  if (type === 'patch' || type === 'diff' || type === 'file_edit') {
    const fileVal = get('file') ?? get('path') ?? get('file_path');
    const diffVal = get('diff') ?? get('patch');
    const checkpointVal = get('checkpoint');
    return {
      type: 'file_edit',
      file: typeof fileVal === 'string' ? fileVal : undefined,
      diff: typeof diffVal === 'string' ? diffVal : undefined,
      checkpoint: typeof checkpointVal === 'string' ? checkpointVal : undefined,
    } as const;
  }

  switch (type) {
    case 'chat_start':
      return {type: 'chat_start'} as const;
    case 'chat': {
      const c = get('content');
      return {type: 'chat', content: typeof c === 'string' ? c : ''} as const;
    }
    case 'chat_end':
      return {type: 'chat_end'} as const;
    case 'reasoning_start':
      return {type: 'reasoning_start'} as const;
    case 'reasoning': {
      const c = get('content');
      return {type: 'reasoning', content: typeof c === 'string' ? c : ''} as const;
    }
    case 'reasoning_end':
      return {type: 'reasoning_end'} as const;
    case 'tool_call': {
      const name = get('name');
      const args = get('args');
      return {
        type: 'tool_call',
        name: typeof name === 'string' ? name : '',
        args: args,
      } as const;
    }
    case 'error': {
      const errVal = get('error');
      const msgVal = get('message');
      const err = typeof errVal === 'string' ? errVal : typeof msgVal === 'string' ? msgVal : 'Unknown error';
      return {type: 'error', error: err} as const;
    }
    case 'done': {
      const did = get('dialog_id');
      const dialog_id = typeof did === 'string' ? did : undefined;
      return {type: 'done', dialog_id} as const;
    }
    default: {
      const c = get('content');
      const content = typeof c === 'string' ? c : undefined;
      if (content && !type) {
        return {type: 'chat', content} as const;
      }
      return null;
    }
  }
};
