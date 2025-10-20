/**
 * VSCode API acquired in webview context
 */
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../shared/messages';

export interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * Messages sent from webview to extension
 */
export type WebviewInMessage =
  | {type: typeof WEBVIEW_IN_MSG.SEND_MESSAGE; text?: string}
  | {type: typeof WEBVIEW_IN_MSG.OPEN_FILE; file?: string}
  | {type: typeof WEBVIEW_IN_MSG.STOP_PROCESSING}
  | {type: typeof WEBVIEW_IN_MSG.READY}
  | {type: typeof WEBVIEW_IN_MSG.LOAD_MORE_HISTORY}
  | {type: typeof WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX; idx?: number};

/**
 * Messages sent from extension to webview
 */
export type WebviewOutMessage =
  | {type: typeof WEBVIEW_OUT_MSG.ADD_MESSAGE; message: {role: 'user' | 'assistant'; content: string}}
  | {type: typeof WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT; content: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_ASSISTANT_MESSAGE}
  | {type: typeof WEBVIEW_OUT_MSG.START_REASONING}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_REASONING; content: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_REASONING}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_TOOL_CALL; tool?: string; args?: unknown}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_FILE_EDIT; file: string; diff?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_ERROR; error: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_INFO; message: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_STREAM}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_VISIBLE; visible: boolean}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED; enabled: boolean}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS; events: HistoryEvent[]}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL; events: HistoryEvent[]}
  | {type: typeof WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM}
  | {type: typeof WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX};

export interface HistoryEvent {
  type: 'user' | 'chat' | 'reasoning' | 'tool_call' | 'file_edit';
  content?: string;
  name?: string;
  args?: unknown;
  file?: string;
  diff?: string;
  checkpoint?: string;
  idx?: number;
  model_name?: string;
}

export interface ReasoningBlock {
  block: HTMLElement;
  content: HTMLElement;
  header: HTMLElement;
}
