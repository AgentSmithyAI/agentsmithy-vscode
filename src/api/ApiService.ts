import {isRecord} from '../utils/typeGuards';

interface CurrentDialogResponse {
  id: string | null;
}

export interface Dialog {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ListDialogsResponse {
  dialogs: Dialog[];
  current_dialog_id?: string;
}

interface CreateDialogResponse {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface UpdateDialogResponse {
  id: string;
  title: string | null;
  updated_at: string;
}

export interface Checkpoint {
  commit_id: string;
  message: string;
}

interface ListCheckpointsResponse {
  dialog_id: string;
  checkpoints: Checkpoint[];
  initial_checkpoint: string | null;
}

interface RestoreCheckpointResponse {
  restored_to: string;
  new_checkpoint: string;
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted';

export interface ChangedFile {
  path: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  diff: string | null;
  base_content: string | null;
  is_binary: boolean;
  is_too_large: boolean;
}

export interface SessionStatus {
  active_session: string | null;
  session_ref: string | null;
  has_unapproved: boolean;
  last_approved_at: string | null;
  changed_files: ChangedFile[];
}

interface ApproveSessionResponse {
  approved_commit: string;
  new_session: string;
  commits_approved: number;
}

interface ResetToApprovedResponse {
  reset_to: string;
  new_session: string;
}

import {SSE_EVENT_TYPES as E} from '../constants';

export interface HistoryEvent {
  type: 'user' | typeof E.CHAT | typeof E.REASONING | typeof E.TOOL_CALL | typeof E.FILE_EDIT;
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

export interface HealthResponse {
  server_status: string;
  port: number | null;
  config_valid: boolean;
  config_errors: string[];
}

export interface ConfigResponse {
  config: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

export interface UpdateConfigResponse {
  success: boolean;
  message: string;
  config: Record<string, unknown>;
}

/**
 * Service for REST API calls to AgentSmithy server
 */
export class ApiService {
  // Private endpoints - not exposed as constants
  private readonly endpoints = {
    currentDialog: '/api/dialogs/current',
    dialogs: '/api/dialogs',
    dialog: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}`,
    history: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}/history`,
    checkpoints: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}/checkpoints`,
    restore: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}/restore`,
    session: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}/session`,
    approve: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}/approve`,
    reset: (dialogId: string) => `/api/dialogs/${encodeURIComponent(dialogId)}/reset`,
  };

  constructor(private readonly baseUrlOrGetter: string | (() => string)) {}

  private getBaseUrl(): string {
    return typeof this.baseUrlOrGetter === 'function' ? this.baseUrlOrGetter() : this.baseUrlOrGetter;
  }

  /**
   * Get current dialog ID
   */
  async getCurrentDialog(): Promise<CurrentDialogResponse> {
    const url = `${this.getBaseUrl()}${this.endpoints.currentDialog}`;
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
    const url = `${this.getBaseUrl()}${this.endpoints.dialogs}`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data: unknown = await resp.json();

    if (isRecord(data) && 'dialogs' in data && Array.isArray(data.dialogs)) {
      const dialogs = data.dialogs as unknown[];
      const normalizedItems: Dialog[] = dialogs
        .filter((x): x is Record<string, unknown> => isRecord(x))
        .map((x) => ({
          id: typeof x.id === 'string' ? x.id : '',
          title: typeof x.title === 'string' ? x.title : null,
          created_at: typeof x.created_at === 'string' ? x.created_at : '',
          updated_at: typeof x.updated_at === 'string' ? x.updated_at : '',
        }));
      const current_dialog_id = isRecord(data) && 'current_dialog_id' in data ? data.current_dialog_id : undefined;
      return {
        dialogs: normalizedItems,
        current_dialog_id: typeof current_dialog_id === 'string' ? current_dialog_id : undefined,
      };
    }
    return {dialogs: []};
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
    const queryString = params.toString();
    const suffix = queryString ? `?${queryString}` : '';
    const url = `${this.getBaseUrl()}${this.endpoints.history(dialogId)}${suffix}`;

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
        return {type: E.CHAT as HistoryEvent['type']};
      }
      const ev = e as Record<string, unknown>;
      const type = typeof ev.type === 'string' ? (ev.type as HistoryEvent['type']) : (E.CHAT as HistoryEvent['type']);
      const idx = typeof ev.idx === 'number' ? ev.idx : undefined;
      const content = typeof ev.content === 'string' ? ev.content : undefined;
      const name = typeof ev.name === 'string' ? ev.name : undefined;
      const file = typeof ev.file === 'string' ? ev.file : undefined;
      const diff = typeof ev.diff === 'string' ? ev.diff : undefined;
      const checkpoint = typeof ev.checkpoint === 'string' ? ev.checkpoint : undefined;
      const model_name = typeof ev.model_name === 'string' ? ev.model_name : undefined;
      return {
        type,
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

  /**
   * Create a new dialog
   */
  async createDialog(title?: string): Promise<CreateDialogResponse> {
    const url = `${this.getBaseUrl()}${this.endpoints.dialogs}`;
    const body = title ? {title} : {};
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed create dialog response');
    }

    return {
      id: typeof data.id === 'string' ? data.id : '',
      title: typeof data.title === 'string' ? data.title : null,
      created_at: typeof data.created_at === 'string' ? data.created_at : '',
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : '',
    };
  }

  /**
   * Set current active dialog
   */
  async setCurrentDialog(dialogId: string): Promise<void> {
    const url = `${this.getBaseUrl()}${this.endpoints.currentDialog}?id=${encodeURIComponent(dialogId)}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {Accept: 'application/json'},
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
  }

  /**
   * Get dialog metadata
   */
  async getDialog(dialogId: string): Promise<Dialog> {
    const url = `${this.getBaseUrl()}${this.endpoints.dialog(dialogId)}`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed dialog response');
    }

    return {
      id: typeof data.id === 'string' ? data.id : '',
      title: typeof data.title === 'string' ? data.title : null,
      created_at: typeof data.created_at === 'string' ? data.created_at : '',
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : '',
    };
  }

  /**
   * Update dialog (e.g., change title)
   */
  async updateDialog(dialogId: string, updates: {title?: string}): Promise<UpdateDialogResponse> {
    const url = `${this.getBaseUrl()}${this.endpoints.dialog(dialogId)}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed update dialog response');
    }

    return {
      id: typeof data.id === 'string' ? data.id : '',
      title: typeof data.title === 'string' ? data.title : null,
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : '',
    };
  }

  /**
   * Delete a dialog
   */
  async deleteDialog(dialogId: string): Promise<void> {
    const url = `${this.getBaseUrl()}${this.endpoints.dialog(dialogId)}`;
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: {Accept: 'application/json'},
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
  }

  /**
   * List all checkpoints for a dialog
   */
  async listCheckpoints(dialogId: string): Promise<ListCheckpointsResponse> {
    const url = `${this.getBaseUrl()}${this.endpoints.checkpoints(dialogId)}`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed checkpoints response');
    }

    const checkpoints = Array.isArray(data.checkpoints) ? data.checkpoints : [];
    const normalizedCheckpoints: Checkpoint[] = checkpoints
      .filter((x): x is Record<string, unknown> => isRecord(x))
      .map((x) => ({
        commit_id: typeof x.commit_id === 'string' ? x.commit_id : '',
        message: typeof x.message === 'string' ? x.message : '',
      }));

    return {
      dialog_id: typeof data.dialog_id === 'string' ? data.dialog_id : dialogId,
      checkpoints: normalizedCheckpoints,
      initial_checkpoint: typeof data.initial_checkpoint === 'string' ? data.initial_checkpoint : null,
    };
  }

  /**
   * Restore dialog to a specific checkpoint
   */
  async restoreCheckpoint(dialogId: string, checkpointId: string): Promise<RestoreCheckpointResponse> {
    const url = `${this.getBaseUrl()}${this.endpoints.restore(dialogId)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({checkpoint_id: checkpointId}),
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed restore response');
    }

    return {
      restored_to: typeof data.restored_to === 'string' ? data.restored_to : '',
      new_checkpoint: typeof data.new_checkpoint === 'string' ? data.new_checkpoint : '',
    };
  }

  /**
   * Get session status for a dialog
   */
  async getSessionStatus(dialogId: string): Promise<SessionStatus> {
    const url = `${this.getBaseUrl()}${this.endpoints.session(dialogId)}`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed session status response');
    }

    const changedRaw = Array.isArray(data.changed_files) ? (data.changed_files as unknown[]) : [];
    const changed_files: ChangedFile[] = changedRaw
      .filter((x): x is Record<string, unknown> => isRecord(x))
      .map((x) => ({
        path: typeof x.path === 'string' ? x.path : '',
        status: (typeof x.status === 'string' ? x.status : 'modified') as FileChangeStatus,
        additions: typeof x.additions === 'number' ? x.additions : 0,
        deletions: typeof x.deletions === 'number' ? x.deletions : 0,
        diff: typeof x.diff === 'string' ? x.diff : null,
        base_content: typeof x.base_content === 'string' ? x.base_content : null,
        is_binary: Boolean(x.is_binary),
        is_too_large: Boolean(x.is_too_large),
      }));

    return {
      active_session: typeof data.active_session === 'string' ? data.active_session : null,
      session_ref: typeof data.session_ref === 'string' ? data.session_ref : null,
      has_unapproved: Boolean(data.has_unapproved),
      last_approved_at: typeof data.last_approved_at === 'string' ? data.last_approved_at : null,
      changed_files,
    };
  }

  /**
   * Approve current session
   */
  async approveSession(dialogId: string): Promise<ApproveSessionResponse> {
    const url = `${this.getBaseUrl()}${this.endpoints.approve(dialogId)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {Accept: 'application/json'},
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed approve response');
    }

    return {
      approved_commit: typeof data.approved_commit === 'string' ? data.approved_commit : '',
      new_session: typeof data.new_session === 'string' ? data.new_session : '',
      commits_approved: typeof data.commits_approved === 'number' ? data.commits_approved : 0,
    };
  }

  /**
   * Reset to approved state (discard current session)
   */
  async resetToApproved(dialogId: string): Promise<ResetToApprovedResponse> {
    const url = `${this.getBaseUrl()}${this.endpoints.reset(dialogId)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {Accept: 'application/json'},
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed reset response');
    }

    return {
      reset_to: typeof data.reset_to === 'string' ? data.reset_to : '',
      new_session: typeof data.new_session === 'string' ? data.new_session : '',
    };
  }

  /**
   * Get server health status
   */
  async getHealth(): Promise<HealthResponse> {
    const url = `${this.getBaseUrl()}/health`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed health response');
    }

    let config_errors: string[] = [];
    if (Array.isArray(data.config_errors)) {
      const rawErrors = data.config_errors as unknown[];
      config_errors = rawErrors.filter((x): x is string => typeof x === 'string');
      if (config_errors.length !== rawErrors.length) {
        // Important diagnostic: API returned malformed data
        // eslint-disable-next-line no-console
        console.warn('[ApiService] health response contained non-string config_errors entries');
      }
    }

    return {
      server_status: typeof data.server_status === 'string' ? data.server_status : 'unknown',
      port: typeof data.port === 'number' ? data.port : null,
      config_valid: Boolean(data.config_valid),
      config_errors,
    };
  }

  /**
   * Get configuration
   */
  async getConfig(): Promise<ConfigResponse> {
    const url = `${this.getBaseUrl()}/api/config`;
    const resp = await fetch(url, {headers: {Accept: 'application/json'}});

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();

    if (!isRecord(data)) {
      throw new Error('Malformed config response');
    }

    return {
      config: isRecord(data.config) ? data.config : {},
      metadata: isRecord(data.metadata) ? data.metadata : null,
    };
  }

  /**
   * Update configuration
   */
  async updateConfig(config: Record<string, unknown>): Promise<UpdateConfigResponse> {
    const url = `${this.getBaseUrl()}/api/config`;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({config}),
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data: unknown = await resp.json();
    if (!isRecord(data)) {
      throw new Error('Malformed update config response');
    }

    return {
      success: Boolean(data.success),
      message: typeof data.message === 'string' ? data.message : '',
      config: isRecord(data.config) ? data.config : {},
    };
  }
}
