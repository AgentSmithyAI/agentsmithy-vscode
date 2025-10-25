import type {SSEEvent} from '../api/StreamService';
import {SSE_EVENT_TYPES as E} from '../constants';

/**
 * Normalize raw server-sent event payloads into internal SSEEvent format.
 */
export const normalizeSSEEvent = (raw: unknown): SSEEvent | null => {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const get = (k: string): unknown => obj[k];
  const getString = (k: string): string | undefined => (typeof obj[k] === 'string' ? obj[k] : undefined);
  const type = getString('type');

  // Normalize file edits (supports legacy aliases)
  const FILE_EDIT_ALIASES = new Set<string>(['patch', 'diff', E.FILE_EDIT]);
  if (type && FILE_EDIT_ALIASES.has(type)) {
    const fileVal = get('file') ?? get('path') ?? get('file_path');
    const diffVal = get('diff') ?? get('patch');
    const checkpointVal = get('checkpoint');
    return {
      type: E.FILE_EDIT,
      file: typeof fileVal === 'string' ? fileVal : undefined,
      diff: typeof diffVal === 'string' ? diffVal : undefined,
      checkpoint: typeof checkpointVal === 'string' ? checkpointVal : undefined,
    } as const;
  }

  switch (type) {
    case E.USER: {
      const content = getString('content') ?? '';
      const checkpoint = getString('checkpoint');
      const dialog_id = getString('dialog_id');
      return {type: E.USER, content, checkpoint, dialog_id} as const;
    }
    case E.CHAT_START:
      return {type: E.CHAT_START} as const;
    case E.CHAT: {
      const content = getString('content') ?? '';
      return {type: E.CHAT, content} as const;
    }
    case E.CHAT_END:
      return {type: E.CHAT_END} as const;
    case E.REASONING_START:
      return {type: E.REASONING_START} as const;
    case E.REASONING: {
      const content = getString('content') ?? '';
      return {type: E.REASONING, content} as const;
    }
    case E.REASONING_END:
      return {type: E.REASONING_END} as const;
    case E.TOOL_CALL: {
      const name = getString('name') ?? '';
      const args = get('args');
      return {type: E.TOOL_CALL, name, args} as const;
    }
    case E.ERROR: {
      const err = getString('error') ?? getString('message') ?? 'Unknown error';
      return {type: E.ERROR, error: err} as const;
    }
    case E.DONE: {
      const dialog_id = getString('dialog_id');
      return {type: E.DONE, dialog_id} as const;
    }
    default: {
      const content = getString('content');
      if (content && !type) {
        return {type: E.CHAT, content} as const;
      }
      return null;
    }
  }
};
