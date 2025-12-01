/**
 * Pure functions and testable logic extracted from config-webview.ts
 */

// Message types - exported for testing
export const CONFIG_IN_MSG = {
  READY: 'ready',
  LOAD_CONFIG: 'loadConfig',
  SAVE_CONFIG: 'saveConfig',
  RENAME_CONFIG: 'renameConfig',
  SHOW_INPUT_BOX: 'showInputBox',
  SHOW_QUICK_PICK: 'showQuickPick',
  SHOW_CONFIRM: 'showConfirm',
} as const;

export const CONFIG_OUT_MSG = {
  CONFIG_LOADED: 'configLoaded',
  CONFIG_SAVED: 'configSaved',
  CONFIG_RENAMED: 'configRenamed',
  ERROR: 'error',
  LOADING: 'loading',
  VALIDATION_ERRORS: 'validationErrors',
  INPUT_RESULT: 'inputResult',
  QUICK_PICK_RESULT: 'quickPickResult',
  CONFIRM_RESULT: 'confirmResult',
} as const;

// Types
export interface ProviderMeta {
  name: string;
  type: string;
  has_api_key: boolean;
  model: string | null;
}

export interface WorkloadMeta {
  name: string;
  provider: string;
  model: string;
  kind: string | null;
}

export interface AgentProviderSlot {
  path: string;
  provider?: string;
  workload?: string;
}

/**
 * Parse providers metadata from raw data
 */
export function parseProvidersMeta(data: unknown): ProviderMeta[] {
  if (!Array.isArray(data)) return [];

  return data
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      name: typeof p.name === 'string' ? p.name : '',
      type: typeof p.type === 'string' ? p.type : '',
      has_api_key: typeof p.has_api_key === 'boolean' ? p.has_api_key : false,
      model: typeof p.model === 'string' ? p.model : null,
    }));
}

/**
 * Parse workloads metadata from raw data
 */
export function parseWorkloadsMeta(data: unknown): WorkloadMeta[] {
  if (!Array.isArray(data)) return [];

  return data
    .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null)
    .map((w) => ({
      name: typeof w.name === 'string' ? w.name : '',
      provider: typeof w.provider === 'string' ? w.provider : '',
      model: typeof w.model === 'string' ? w.model : '',
      kind: typeof w.kind === 'string' ? w.kind : null, // null is valid for legacy workloads without kind
    }));
}

/**
 * Parse agent provider slots from raw data
 */
export function parseAgentProviderSlots(data: unknown): AgentProviderSlot[] {
  if (!Array.isArray(data)) return [];

  return data
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      path: typeof s.path === 'string' ? s.path : '',
      provider: typeof s.provider === 'string' ? s.provider : undefined,
      workload: typeof s.workload === 'string' ? s.workload : undefined,
    }));
}

/**
 * Parse string array from raw data
 */
export function parseStringArray(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is string => typeof item === 'string');
}

/**
 * Parse model catalog from raw data
 */
export function parseModelCatalog(data: unknown): Record<string, Record<string, string[]>> {
  if (typeof data !== 'object' || data === null) return {};

  const result: Record<string, Record<string, string[]>> = {};
  const catalog = data as Record<string, unknown>;

  for (const [providerType, categories] of Object.entries(catalog)) {
    if (typeof categories === 'object' && categories !== null) {
      result[providerType] = {};
      const cats = categories as Record<string, unknown>;
      for (const [category, models] of Object.entries(cats)) {
        if (Array.isArray(models)) {
          result[providerType][category] = models.filter((m): m is string => typeof m === 'string');
        }
      }
    }
  }

  return result;
}

/**
 * State manager for expanded items
 */
export class ExpandedStateManager {
  private expandedProviders = new Set<string>();
  private expandedWorkloads = new Set<string>();

  setProviderExpanded(name: string, expanded: boolean): void {
    if (expanded) {
      this.expandedProviders.add(name);
    } else {
      this.expandedProviders.delete(name);
    }
  }

  setWorkloadExpanded(name: string, expanded: boolean): void {
    if (expanded) {
      this.expandedWorkloads.add(name);
    } else {
      this.expandedWorkloads.delete(name);
    }
  }

  isProviderExpanded(name: string): boolean {
    return this.expandedProviders.has(name);
  }

  isWorkloadExpanded(name: string): boolean {
    return this.expandedWorkloads.has(name);
  }

  getExpandedProviders(): string[] {
    return Array.from(this.expandedProviders);
  }

  getExpandedWorkloads(): string[] {
    return Array.from(this.expandedWorkloads);
  }

  renameProvider(oldName: string, newName: string): void {
    if (this.expandedProviders.has(oldName)) {
      this.expandedProviders.delete(oldName);
      this.expandedProviders.add(newName);
    }
  }

  renameWorkload(oldName: string, newName: string): void {
    if (this.expandedWorkloads.has(oldName)) {
      this.expandedWorkloads.delete(oldName);
      this.expandedWorkloads.add(newName);
    }
  }

  deleteProvider(name: string): void {
    this.expandedProviders.delete(name);
  }

  deleteWorkload(name: string): void {
    this.expandedWorkloads.delete(name);
  }

  clear(): void {
    this.expandedProviders.clear();
    this.expandedWorkloads.clear();
  }
}

/**
 * Scroll position manager
 */
export class ScrollPositionManager {
  private savedScrollTop = 0;

  save(currentScrollTop: number): void {
    if (currentScrollTop > 0 || this.savedScrollTop === 0) {
      this.savedScrollTop = currentScrollTop;
    }
  }

  get(): number {
    return this.savedScrollTop;
  }

  reset(): void {
    this.savedScrollTop = 0;
  }
}

/**
 * Update nested config value at path
 */
export function updateConfigAtPath(
  config: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) return config;

  const result = {...config};
  let current: Record<string, unknown> = result;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    } else {
      current[key] = {...(current[key] as Record<string, unknown>)};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = path[path.length - 1];
  current[lastKey] = value;

  return result;
}

/**
 * Get nested config value at path
 */
export function getConfigAtPath(config: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = config;

  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Check if a value exists in model catalog
 */
export function isValueInCatalog(
  value: string,
  catalog: Record<string, Record<string, string[]>>,
  providerType: string,
): boolean {
  if (!value || !providerType || !catalog[providerType]) return false;

  const providerCatalog = catalog[providerType];
  for (const models of Object.values(providerCatalog)) {
    if (models.includes(value)) return true;
  }

  return false;
}

/**
 * Get models from catalog for a provider type
 */
export function getModelsFromCatalog(
  catalog: Record<string, Record<string, string[]>>,
  providerType: string,
  category: string = 'chat',
): string[] {
  if (!providerType || !catalog[providerType]) return [];

  const providerCatalog = catalog[providerType];
  if (!providerCatalog[category]) return [];

  return providerCatalog[category];
}

/**
 * Validate provider name (non-empty, no duplicates)
 */
export function validateProviderName(
  name: string,
  existingProviders: Record<string, unknown>,
): {valid: boolean; error?: string} {
  const trimmed = name.trim();

  if (!trimmed) {
    return {valid: false, error: 'Provider name cannot be empty'};
  }

  if (trimmed in existingProviders) {
    return {valid: false, error: 'Provider with this name already exists!'};
  }

  return {valid: true};
}

/**
 * Validate workload name (non-empty, no duplicates)
 */
export function validateWorkloadName(
  name: string,
  existingWorkloads: Record<string, unknown>,
): {valid: boolean; error?: string} {
  const trimmed = name.trim();

  if (!trimmed) {
    return {valid: false, error: 'Workload name cannot be empty'};
  }

  if (trimmed in existingWorkloads) {
    return {valid: false, error: 'Workload with this name already exists!'};
  }

  return {valid: true};
}

/**
 * Create deletion payload for provider
 */
export function createProviderDeletionPayload(providerName: string): Record<string, unknown> {
  return {
    providers: {
      [providerName]: null,
    },
  };
}

/**
 * Create deletion payload for workload
 */
export function createWorkloadDeletionPayload(workloadName: string): Record<string, unknown> {
  return {
    workloads: {
      [workloadName]: null,
    },
  };
}

/**
 * Parse field value from form element
 */
export function parseFieldValue(
  value: string,
  type: 'text' | 'number' | 'checkbox' | 'json',
  checked?: boolean,
): unknown {
  switch (type) {
    case 'checkbox':
      return checked ?? false;
    case 'number':
      return parseFloat(value) || 0;
    case 'json':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value === '' || value === 'null' ? null : value;
  }
}
