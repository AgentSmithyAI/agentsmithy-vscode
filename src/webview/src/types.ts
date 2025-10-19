/**
 * VSCode API acquired in webview context
 */
export interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * Messages sent from webview to extension
 */
export type WebviewInMessage =
  | {type: 'sendMessage'; text?: string}
  | {type: 'openFile'; file?: string}
  | {type: 'stopProcessing'}
  | {type: 'ready'}
  | {type: 'loadMoreHistory'};

/**
 * Messages sent from extension to webview
 */
export type WebviewOutMessage =
  | {type: 'addMessage'; message: {role: 'user' | 'assistant'; content: string}}
  | {type: 'startAssistantMessage'}
  | {type: 'appendToAssistant'; content: string}
  | {type: 'endAssistantMessage'}
  | {type: 'startReasoning'}
  | {type: 'appendToReasoning'; content: string}
  | {type: 'endReasoning'}
  | {type: 'showToolCall'; tool?: string; args?: unknown}
  | {type: 'showFileEdit'; file: string; diff?: string}
  | {type: 'showError'; error: string}
  | {type: 'showInfo'; message: string}
  | {type: 'endStream'}
  | {type: 'historySetLoadMoreVisible'; visible: boolean}
  | {type: 'historySetLoadMoreEnabled'; enabled: boolean}
  | {type: 'historyPrependEvents'; events: unknown[]}
  | {type: 'historyReplaceAll'; events: unknown[]}
  | {type: 'scrollToBottom'};

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

