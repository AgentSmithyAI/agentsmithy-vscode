import { isRecord } from '../utils/typeGuards';

interface CurrentDialogResponse {
  id: string | null;
}

interface ListDialogsResponse {
  items: Array<{id: string; updated_at: string}>;
  current_dialog_id?: string;
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
  first_idx: number | null;
  last_idx: number | null;
}

/**
 * Service for REST API calls to AgentSmithy server
 */
export class ApiService {
  // Private endpoints - not exposed as constants
  private readonly endpoints = {
    currentDialog: '/api/dialogs/current',
    dialogs: '/api/dialogs',
    history: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}/history`,
  };

  constructor(private readonly baseUrl: string) {}

  /**
   * Get current dialog ID
   */
  async getCurrentDialog(): Promise<CurrentDialogResponse> {
    const url = `${this.baseUrl}${this.endpoints.currentDialog}`;
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

  /**
   * List all dialogs
   */
  async listDialogs(): Promise<ListDialogsResponse> {
    const url = `${this.baseUrl}${this.endpoints.dialogs}`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data: unknown = await resp.json();

    if (isRecord(data) && 'items' in data && Array.isArray(data.items)) {
      const items = data.items as unknown[];
      const normalizedItems: Array<{id: string; updated_at: string}> = items
        .filter((x): x is Record<string, unknown> => isRecord(x))
        .map((x) => ({
          id: typeof x.id === 'string' ? x.id : '',
          updated_at: typeof x.updated_at === 'string' ? x.updated_at : '',
        }));
      const current_dialog_id = isRecord(data) && 'current_dialog_id' in data ? data.current_dialog_id : undefined;
      return {
        items: normalizedItems,
        current_dialog_id: typeof current_dialog_id === 'string' ? current_dialog_id : undefined,
      };
    }
    return {items: []};
  }

  /**
   * Load dialog history with optional pagination
   */
  async loadHistory(dialogId: string, limit?: number | null, before?: number | null): Promise<HistoryResponse> {
    const params = new URLSearchParams();
    if (typeof limit === 'number' && limit > 0) {
      params.set('limit', String(limit));
    }
    if (typeof before === 'number') {
      params.set('before', String(before));
    }
    const url = `${this.baseUrl}${this.endpoints.history(dialogId)}${params.toString() ? `?${params.toString()}` : ''}`;

    const resp = await fetch(url, {headers: {Accept: 'application/json'}});
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data: unknown = await resp.json();

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
}
