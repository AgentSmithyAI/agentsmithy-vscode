import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SSEStreamReader } from './api/SSEStreamReader';
import { CONFIG_KEYS, DEFAULT_SERVER_URL, STATUS_FILE_PATH } from './constants';
import { asString, isRecord, safeJsonParse } from './utils/typeGuards';

export interface AgentSmithyMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  current_file?: {
    path: string;
    language: string;
    content: string;
    selection?: string;
  };
}

export interface ChatRequest {
  messages: AgentSmithyMessage[];
  context?: ChatContext;
  stream: boolean;
  dialog_id?: string;
}

export interface SSEEvent {
  type:
    | 'chat_start'
    | 'chat'
    | 'chat_end'
    | 'reasoning_start'
    | 'reasoning'
    | 'reasoning_end'
    | 'tool_call'
    | 'file_edit'
    | 'error'
    | 'done';
  content?: string;
  dialog_id?: string;
  error?: string;
  done?: boolean;
  name?: string;
  args?: unknown;
  file?: string;
  diff?: string;
  checkpoint?: string;
}

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

export interface HistoryResponse {
  dialog_id: string;
  events: HistoryEvent[];
  total_events: number;
  has_more: boolean;
  first_idx: number | null; // may be null when no user/chat messages are present
  last_idx: number | null;
}

interface CurrentDialogResponse {
  id: string | null;
}

interface ListDialogsResponse {
  items: Array<{id: string; updated_at: string}>;
  current_dialog_id?: string;
}

export class AgentSmithyClient {
  private baseUrl: string;
  private abortController?: AbortController;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || this.getServerUrl();
  }

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

  async getCurrentDialog(): Promise<CurrentDialogResponse> {
    const url = `${this.baseUrl}/api/dialogs/current`;
    try {
      const resp = await fetch(url, {headers: {Accept: 'application/json'}});
      if (!resp.ok) {
        throw new Error(String(resp.status));
      }
      const data: unknown = await resp.json();
      if (data !== null && typeof data === 'object' && 'id' in data) {
        const id = (data as {id: unknown}).id;
        return {id: typeof id === 'string' || id === null ? id : null};
      }
      return {id: null};
    } catch {
      return {id: null};
    }
  }

  async listDialogs(): Promise<ListDialogsResponse> {
    const url = `${this.baseUrl}/api/dialogs`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data: unknown = await resp.json();
    // Basic shape validation
    if (
      data !== null &&
      typeof data === 'object' &&
      'items' in data &&
      Array.isArray((data as {items: unknown}).items)
    ) {
      const items = (data as {items: unknown}).items as unknown[];
      const normalizedItems: Array<{id: string; updated_at: string}> = items
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x) => ({
          id: typeof x.id === 'string' ? x.id : '',
          updated_at: typeof x.updated_at === 'string' ? x.updated_at : '',
        }));
      const current_dialog_id =
        'current_dialog_id' in (data as Record<string, unknown>)
          ? (data as {current_dialog_id?: unknown}).current_dialog_id
          : undefined;
      return {
        items: normalizedItems,
        current_dialog_id: typeof current_dialog_id === 'string' ? current_dialog_id : undefined,
      };
    }
    return {items: []};
  }

  getServerUrl = (): string => {
    // Try to read from .agentsmithy/status.json in workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (Array.isArray(workspaceFolders) && workspaceFolders.length > 0) {
      const workspaceRoot: string = String(workspaceFolders[0]?.uri.fsPath ?? '');
      const statusPath = path.join(workspaceRoot, STATUS_FILE_PATH);

      try {
        if (fs.existsSync(statusPath)) {
          const statusContent = fs.readFileSync(statusPath, 'utf8');
          const parsed = safeJsonParse<{port?: unknown}>(statusContent);
          if (parsed && typeof parsed.port !== 'undefined') {
            const port = parsed.port;
            if (typeof port === 'number' || (typeof port === 'string' && String(port).trim().length > 0)) {
              return `http://localhost:${String(port)}`;
            }
          }
        }
      } catch {
        // Silently fallback to config
      }
    }

    // Fallback to configuration or default
    const config = vscode.workspace.getConfiguration('agentsmithy');
    return config.get<string>(CONFIG_KEYS.SERVER_URL, DEFAULT_SERVER_URL);
  };

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  normalizeEvent = (raw: unknown): SSEEvent | null => {
    if (!isRecord(raw)) {
      return null;
    }
    const obj = raw;
    const type = asString(obj.type);

    // Normalize patch/diff/file_edit to a unified file_edit event
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

  async *streamChat(request: ChatRequest): AsyncGenerator<SSEEvent> {
    // Cancel any previous request
    this.abort();

    // Create new abort controller for this request
    this.abortController = new AbortController();

    const response = await this.createChatRequest(request);
    const reader = this.getResponseReader(response);
    const sseReader = new SSEStreamReader(this.normalizeEvent);
    const decoder = new TextDecoder();

    try {
      for await (const chunk of this.readStream(reader, decoder)) {
        for (const event of sseReader.processChunk(chunk)) {
          yield event;
          if (event.type === 'done') {
            return;
          }
        }
      }
    } catch (error) {
      // Re-throw abort errors to be handled by caller
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      throw error;
    } finally {
      reader.releaseLock();
      this.abortController = undefined;
    }
  }

  private async createChatRequest(request: ChatRequest): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({...request, stream: true}),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  private getResponseReader = (response: Response): ReadableStreamDefaultReader<Uint8Array> => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }
    return reader;
  };

  private async *readStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: {decode: (input?: Uint8Array, options?: {stream?: boolean}) => string},
  ): AsyncGenerator<string> {
    for (;;) {
      const readResult = await reader.read();
      const done: boolean = Boolean((readResult as {done?: boolean}).done);
      const value: Uint8Array | undefined = (readResult as {value?: Uint8Array}).value;

      if (done) {
        break;
      }

      yield decoder.decode(value ?? new Uint8Array(), {stream: true});
    }
  }

  async loadHistory(dialogId: string, limit?: number | null, before?: number | null): Promise<HistoryResponse> {
    const params = new URLSearchParams();
    if (typeof limit === 'number' && limit > 0) {
      params.set('limit', String(limit));
    }
    if (typeof before === 'number') {
      params.set('before', String(before));
    }
    const url = `${this.baseUrl}/api/dialogs/${encodeURIComponent(dialogId)}/history${params.toString() ? `?${params.toString()}` : ''}`;

    const resp = await fetch(url, {headers: {Accept: 'application/json'}});
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data: unknown = await resp.json();

    // Shape-validate history response and coerce to our HistoryResponse
    if (data === null || typeof data !== 'object') {
      throw new Error('Malformed history response');
    }
    const obj = data as Record<string, unknown>;
    const eventsRaw = Array.isArray(obj.events) ? (obj.events as unknown[]) : [];
    const events: HistoryEvent[] = eventsRaw.map((e) => {
      if (e === null || typeof e !== 'object') {
        return {type: 'chat'};
      }
      const ev = e as Record<string, unknown>;
      const type = typeof ev.type === 'string' ? ev.type : 'chat';
      const idx = typeof ev.idx === 'number' ? ev.idx : undefined;
      const content = typeof ev.content === 'string' ? ev.content : undefined;
      const name = typeof ev.name === 'string' ? ev.name : undefined;
      const file = typeof ev.file === 'string' ? ev.file : undefined;
      const diff = typeof ev.diff === 'string' ? ev.diff : undefined;
      const checkpoint = typeof ev.checkpoint === 'string' ? ev.checkpoint : undefined;
      const model_name = typeof ev.model_name === 'string' ? ev.model_name : undefined;
      return {
        type: type as HistoryEvent['type'],
        idx,
        content,
        name,
        args: ev.args,
        file,
        diff,
        checkpoint,
        model_name,
      };
    });

    const dialog_id = typeof obj.dialog_id === 'string' ? obj.dialog_id : dialogId;
    const total_events = typeof obj.total_events === 'number' ? obj.total_events : events.length;
    const has_more = Boolean(obj.has_more);
    const first_idx = obj.first_idx === null || typeof obj.first_idx === 'number' ? obj.first_idx : null;
    const last_idx = obj.last_idx === null || typeof obj.last_idx === 'number' ? obj.last_idx : null;

    return {dialog_id, events, total_events, has_more, first_idx, last_idx};
  }

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
}
