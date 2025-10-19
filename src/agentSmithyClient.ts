import * as vscode from 'vscode';
import { ApiService, HistoryResponse } from './api/ApiService';
import { ChatContext, ChatRequest, SSEEvent, StreamService } from './api/StreamService';
import { asString, isRecord } from './utils/typeGuards';

export type { HistoryEvent, HistoryResponse } from './api/ApiService';
export type { AgentSmithyMessage, ChatContext, ChatRequest, SSEEvent } from './api/StreamService';

/**
 * Main client for AgentSmithy server
 * Coordinates API and streaming services
 */
export class AgentSmithyClient {
  private readonly apiService: ApiService;
  private readonly streamService: StreamService;

  constructor(baseUrl: string) {
    this.apiService = new ApiService(baseUrl);
    this.streamService = new StreamService(baseUrl, this.normalizeEvent);
  }

  /**
   * Abort current stream
   */
  abort(): void {
    this.streamService.abort();
  }

  /**
   * Stream chat responses
   */
  async *streamChat(request: ChatRequest): AsyncGenerator<SSEEvent> {
    yield* this.streamService.streamChat(request);
  }

  /**
   * Get current dialog ID
   */
  async getCurrentDialog(): Promise<{id: string | null}> {
    return this.apiService.getCurrentDialog();
  }

  /**
   * List all dialogs
   */
  async listDialogs(): Promise<{items: Array<{id: string; updated_at: string}>; current_dialog_id?: string}> {
    return this.apiService.listDialogs();
  }

  /**
   * Load dialog history
   */
  async loadHistory(dialogId: string, limit?: number | null, before?: number | null): Promise<HistoryResponse> {
    return this.apiService.loadHistory(dialogId, limit, before);
  }

  /**
   * Get current file context from active editor
   */
  getCurrentFileContext = (): ChatContext | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const document = editor.document;
    const selection = editor.selection;

    return {
      current_file: {
        path: document.fileName,
        language: document.languageId,
        content: document.getText(),
        selection: !selection.isEmpty ? document.getText(selection) : undefined,
      },
    };
  };

  /**
   * Normalize raw SSE event to typed SSEEvent
   */
  private normalizeEvent = (raw: unknown): SSEEvent | null => {
    if (!isRecord(raw)) {
      return null;
    }
    const obj = raw;
    const type = asString(obj.type);

    // Normalize patch/diff/file_edit to unified file_edit event
    if (type === 'patch' || type === 'diff' || type === 'file_edit') {
      return this.normalizeFileEdit(obj);
    }

    // Pass through known types with minimal mapping
    switch (type) {
      case 'chat_start':
        return {type: 'chat_start'};
      case 'chat': {
        return {type: 'chat', content: asString(obj.content)};
      }
      case 'chat_end':
        return {type: 'chat_end'};
      case 'reasoning_start':
        return {type: 'reasoning_start'};
      case 'reasoning': {
        return {type: 'reasoning', content: asString(obj.content)};
      }
      case 'reasoning_end':
        return {type: 'reasoning_end'};
      case 'tool_call': {
        return {type: 'tool_call', name: asString(obj.name), args: obj.args};
      }
      case 'error': {
        const err = asString(obj.error) ?? asString(obj.message);
        return {type: 'error', error: err};
      }
      case 'done': {
        const dialog_id = asString(obj.dialog_id);
        return {type: 'done', dialog_id};
      }
      default: {
        const content = asString(obj.content);
        if (content && !type) {
          return {type: 'chat', content};
        }
        return null;
      }
    }
  };

  private normalizeFileEdit = (obj: Record<string, unknown>): SSEEvent => {
    const fileVal = obj.file ?? obj.path ?? obj.file_path;
    const diffVal = obj.diff ?? obj.patch;
    const checkpointVal = obj.checkpoint;
    return {
      type: 'file_edit',
      file: asString(fileVal),
      diff: asString(diffVal),
      checkpoint: asString(checkpointVal),
    };
  };
}
