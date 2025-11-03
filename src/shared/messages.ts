export const WEBVIEW_IN_MSG = {
  SEND_MESSAGE: 'sendMessage',
  OPEN_FILE: 'openFile',
  STOP_PROCESSING: 'stopProcessing',
  READY: 'ready',
  LOAD_MORE_HISTORY: 'loadMoreHistory',
  VISIBLE_FIRST_IDX: 'visibleFirstIdx',
  CREATE_DIALOG: 'createDialog',
  SWITCH_DIALOG: 'switchDialog',
  RENAME_DIALOG: 'renameDialog',
  DELETE_DIALOG: 'deleteDialog',
  DELETE_DIALOG_CONFIRM: 'deleteDialogConfirm',
  LOAD_DIALOGS: 'loadDialogs',
  RESTORE_CHECKPOINT: 'restoreCheckpoint',
  APPROVE_SESSION: 'approveSession',
  RESET_TO_APPROVED: 'resetToApproved',
  OPEN_SETTINGS: 'openSettings',
} as const;

export type WebviewInMessageType = (typeof WEBVIEW_IN_MSG)[keyof typeof WEBVIEW_IN_MSG];

export const WEBVIEW_OUT_MSG = {
  ADD_MESSAGE: 'addMessage',
  START_ASSISTANT_MESSAGE: 'startAssistantMessage',
  APPEND_TO_ASSISTANT: 'appendToAssistant',
  END_ASSISTANT_MESSAGE: 'endAssistantMessage',
  START_REASONING: 'startReasoning',
  APPEND_TO_REASONING: 'appendToReasoning',
  END_REASONING: 'endReasoning',
  SHOW_TOOL_CALL: 'showToolCall',
  SHOW_FILE_EDIT: 'showFileEdit',
  SHOW_ERROR: 'showError',
  SHOW_INFO: 'showInfo',
  END_STREAM: 'endStream',
  HISTORY_SET_CAN_LOAD: 'historySetCanLoad',
  HISTORY_PREPEND_EVENTS: 'historyPrependEvents',
  HISTORY_REPLACE_ALL: 'historyReplaceAll',
  SCROLL_TO_BOTTOM: 'scrollToBottom',
  GET_VISIBLE_FIRST_IDX: 'getVisibleFirstIdx',
  DIALOGS_UPDATE: 'dialogsUpdate',
  DIALOGS_LOADING: 'dialogsLoading',
  DIALOGS_ERROR: 'dialogsError',
  DIALOG_SWITCHED: 'dialogSwitched',
  SESSION_STATUS_UPDATE: 'sessionStatusUpdate',
  SESSION_OPERATION_CANCELLED: 'sessionOperationCancelled',
  FOCUS_INPUT: 'focusInput',
} as const;

export type WebviewOutMessageType = (typeof WEBVIEW_OUT_MSG)[keyof typeof WEBVIEW_OUT_MSG];
