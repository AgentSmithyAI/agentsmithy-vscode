import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

interface CurrentDialogResponse { id: string | null }

interface ListDialogsResponse {
  items: Array<{ id: string; updated_at: string }>;
  current_dialog_id?: string;
}

export class AgentSmithyClient {
  private baseUrl: string;
  private abortController?: AbortController;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || this.getServerUrl();
  }

  async getCurrentDialog(): Promise<CurrentDialogResponse> {
    const url = `${this.baseUrl}/api/dialogs/current`;
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) {
        throw new Error(String(resp.status));
      }
      const data: unknown = await resp.json();
      if (data && typeof data === 'object' && 'id' in data) {
        const id = (data as { id: unknown }).id;
        return { id: typeof id === 'string' || id === null ? id : null };
      }
      return { id: null };
    } catch {
      return { id: null };
    }
  }

  async listDialogs(): Promise<ListDialogsResponse> {
    const url = `${this.baseUrl}/api/dialogs`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data: unknown = await resp.json();
    // Basic shape validation
    if (
      data &&
      typeof data === 'object' &&
      'items' in data &&
      Array.isArray((data as { items: unknown }).items)
    ) {
      const items = (data as { items: unknown }).items as unknown[];
      const normalizedItems: Array<{ id: string; updated_at: string }> = items
        .map((x) => (x && typeof x === 'object' ? x : undefined))
        .filter((x): x is { id: unknown; updated_at: unknown } => !!x)
        .map((x) => ({
          id: typeof x.id === 'string' ? x.id : '',
          updated_at: typeof x.updated_at === 'string' ? x.updated_at : '',
        }));
      const current_dialog_id =
        data && typeof data === 'object' && 'current_dialog_id' in data
          ? (data as { current_dialog_id?: unknown }).current_dialog_id
          : undefined;
      return {
        items: normalizedItems,
        current_dialog_id:
          typeof current_dialog_id === 'string' ? current_dialog_id : undefined,
      };
    }
    return { items: [] };
  }

  getServerUrl = (): string => {
    // Try to read from .agentsmithy/status.json in workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const statusPath = path.join(workspaceRoot, '.agentsmithy', 'status.json');

      try {
        if (fs.existsSync(statusPath)) {
          const statusContent = fs.readFileSync(statusPath, 'utf8');
          const status = JSON.parse(statusContent);
          if (status.port) {
            return `http://localhost:${status.port}`;
          }
        }
      } catch {
        // Silently fallback to config
      }
    }

    // Fallback to configuration or default
    const config = vscode.workspace.getConfiguration('agentsmithy');
    return config.get<string>('serverUrl', 'http://localhost:8765');
  };

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  normalizeEvent = (raw: unknown): SSEEvent | null => {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type : undefined;
    // Normalize patch/diff/file_edit to a unified file_edit event
    if (type === 'patch' || type === 'diff' || type === 'file_edit') {
      const fileVal = (obj.file ?? (obj).path ?? (obj).file_path);
      const diffVal = obj.diff ?? (obj).patch;
      const checkpointVal = obj.checkpoint;
      return {
        type: 'file_edit',
        file: typeof fileVal === 'string' ? fileVal : undefined,
        diff: typeof diffVal === 'string' ? diffVal : undefined,
        checkpoint: typeof checkpointVal === 'string' ? checkpointVal : undefined,
      };
    }
    // Pass through known types with minimal mapping
    switch (type) {
      case 'chat_start':
        return { type: 'chat_start' };
      case 'chat': {
        const content = obj.content;
        return { type: 'chat', content: typeof content === 'string' ? content : undefined };
      }
      case 'chat_end':
        return { type: 'chat_end' };
      case 'reasoning_start':
        return { type: 'reasoning_start' };
      case 'reasoning': {
        const content = obj.content;
        return { type: 'reasoning', content: typeof content === 'string' ? content : undefined };
      }
      case 'reasoning_end':
        return { type: 'reasoning_end' };
      case 'tool_call': {
        const name = obj.name;
        return { type: 'tool_call', name: typeof name === 'string' ? name : undefined, args: obj.args };
      }
      case 'error': {
        const err = typeof obj.error === 'string' ? obj.error : typeof (obj).message === 'string' ? (obj).message : undefined;
        return { type: 'error', error: err };
      }
      case 'done': {
        const dialog_id = typeof obj.dialog_id === 'string' ? obj.dialog_id : undefined;
        return { type: 'done', dialog_id };
      }
      default: {
        const content = (obj).content;
        if (typeof content === 'string' && !type) {
          return { type: 'chat', content };
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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({...request, stream: true}),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let eventLines: string[] = [];

    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          // Blank line indicates end of one SSE message
          if (line === '') {
            const dataPayload = eventLines
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trimStart())
              .join('\n');
            if (dataPayload) {
              try {
                const raw = JSON.parse(dataPayload);
                const event = this.normalizeEvent(raw);
                if (event) {
                  yield event;
                  if (event.type === 'done') {
                    // Don't return here - let the stream end naturally
                    // return;
                  }
                }
              } catch (_err) {
                // Skip invalid JSON
              }
            }
            eventLines = [];
            continue;
          }
          // Accumulate data lines; handle both 'data:' and 'data: '
          if (line.startsWith('data:')) {
            // Try to parse per-line JSON immediately (many servers send one JSON per line)
            const candidate = line.slice(5).trimStart();
            let emitted = false;
            if (candidate.startsWith('{') && candidate.endsWith('}')) {
              try {
                const raw = JSON.parse(candidate);
                const event = this.normalizeEvent(raw);
                if (event) {
                  yield event;
                  emitted = true;
                  if (event.type === 'done') {
                    // Don't return here - let the stream end naturally
                    // return;
                  }
                }
              } catch (_err) {
                /* noop */
              }
            }
            if (!emitted) {
              eventLines.push(line);
            }
          }
          // Ignore comments (lines starting with ':') and other fields for now
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
      // Clear abort controller when done
      if (this.abortController?.signal.aborted) {
        this.abortController = undefined;
      }
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

    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data: unknown = await resp.json();

    // Shape-validate history response and coerce to our HistoryResponse
    if (!data || typeof data !== 'object') {
      throw new Error('Malformed history response');
    }
    const obj = data as Record<string, unknown>;
    const eventsRaw = Array.isArray(obj.events) ? (obj.events as unknown[]) : [];
    const events: HistoryEvent[] = eventsRaw.map((e) => {
      if (!e || typeof e !== 'object') {return { type: 'chat' };}
      const ev = e as Record<string, unknown>;
      const type = typeof ev.type === 'string' ? ev.type : 'chat';
      const idx = typeof ev.idx === 'number' ? ev.idx : undefined;
      const content = typeof ev.content === 'string' ? ev.content : undefined;
      const name = typeof ev.name === 'string' ? ev.name : undefined;
      const file = typeof ev.file === 'string' ? ev.file : undefined;
      const diff = typeof ev.diff === 'string' ? ev.diff : undefined;
      const checkpoint = typeof ev.checkpoint === 'string' ? ev.checkpoint : undefined;
      const model_name = typeof ev.model_name === 'string' ? ev.model_name : undefined;
      return { type: type as HistoryEvent['type'], idx, content, name, args: ev.args, file, diff, checkpoint, model_name };
    });

    const dialog_id = typeof obj.dialog_id === 'string' ? obj.dialog_id : dialogId;
    const total_events = typeof obj.total_events === 'number' ? obj.total_events : events.length;
    const has_more = Boolean(obj.has_more);
    const first_idx = obj.first_idx === null || typeof obj.first_idx === 'number' ? (obj.first_idx) : null;
    const last_idx = obj.last_idx === null || typeof obj.last_idx === 'number' ? (obj.last_idx) : null;

    return { dialog_id, events, total_events, has_more, first_idx, last_idx };
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
