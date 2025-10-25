/**
 * VSCode API acquired in webview context
 */
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../shared/messages';

/**
 * Maximum number of indexed messages to keep in DOM before pruning older ones
 */
export const MAX_MESSAGES_IN_DOM = 20;

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
  | {type: typeof WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX; idx?: number}
  | {type: typeof WEBVIEW_IN_MSG.CREATE_DIALOG}
  | {type: typeof WEBVIEW_IN_MSG.SWITCH_DIALOG; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.RENAME_DIALOG; dialogId: string; title: string}
  | {type: typeof WEBVIEW_IN_MSG.DELETE_DIALOG; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.DELETE_DIALOG_CONFIRM; dialogId: string; title: string}
  | {type: typeof WEBVIEW_IN_MSG.LOAD_DIALOGS}
  | {type: typeof WEBVIEW_IN_MSG.RESTORE_CHECKPOINT; dialogId: string; checkpointId: string}
  | {type: typeof WEBVIEW_IN_MSG.APPROVE_SESSION; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.RESET_TO_APPROVED; dialogId: string}
  | {type: typeof WEBVIEW_IN_MSG.OPEN_SETTINGS};

/**
 * Messages sent from extension to webview
 */
export type WebviewOutMessage =
  | {
      type: typeof WEBVIEW_OUT_MSG.ADD_MESSAGE;
      message: {role: 'user' | 'assistant'; content: string};
      checkpoint?: string;
      dialogId?: string;
    }
  | {type: typeof WEBVIEW_OUT_MSG.START_ASSISTANT_MESSAGE; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_ASSISTANT; content: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_ASSISTANT_MESSAGE; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.START_REASONING; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.APPEND_TO_REASONING; content: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_REASONING; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_TOOL_CALL; tool?: string; args?: unknown; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_FILE_EDIT; file: string; diff?: string; checkpoint?: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_ERROR; error: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SHOW_INFO; message: string; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.END_STREAM; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_VISIBLE; visible: boolean; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_SET_LOAD_MORE_ENABLED; enabled: boolean; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_PREPEND_EVENTS; events: HistoryEvent[]; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.HISTORY_REPLACE_ALL; events: HistoryEvent[]; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.SCROLL_TO_BOTTOM; dialogId?: string}
  | {type: typeof WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX}
  | {
      type: typeof WEBVIEW_OUT_MSG.DIALOGS_UPDATE;
      dialogs: Array<{id: string; title: string | null; updated_at: string}>;
      currentDialogId: string | null;
    }
  | {type: typeof WEBVIEW_OUT_MSG.DIALOGS_LOADING}
  | {type: typeof WEBVIEW_OUT_MSG.DIALOGS_ERROR; error: string}
  | {type: typeof WEBVIEW_OUT_MSG.DIALOG_SWITCHED; dialogId: string | null; title: string}
  | {type: typeof WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE; hasUnapproved: boolean};

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
