// Config webview script

type VSCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare function acquireVsCodeApi(): VSCodeApi;

const vscode = acquireVsCodeApi();

// Message types
const CONFIG_IN_MSG = {
  READY: 'ready',
  LOAD_CONFIG: 'loadConfig',
  SAVE_CONFIG: 'saveConfig',
} as const;

const CONFIG_OUT_MSG = {
  CONFIG_LOADED: 'configLoaded',
  CONFIG_SAVED: 'configSaved',
  ERROR: 'error',
  LOADING: 'loading',
  VALIDATION_ERRORS: 'validationErrors',
} as const;

// State
let currentConfig: Record<string, unknown> = {};
let currentMetadata: Record<string, unknown> | null = null;
let availableProviders: Array<{name: string; type: string; has_api_key: boolean; model: string | null}> = [];
let availableWorkloads: Array<{name: string; provider: string; model: string}> = [];
let agentProviderSlots: Array<{path: string; provider?: string; workload?: string}> = [];
let providerTypes: string[] = [];
let modelCatalog: Record<string, Record<string, string[]>> = {};
let isDirty = false;
let suppressedSuccessMessages = 0;
// Tracks how many save operations are still awaiting CONFIG_SAVED/CONFIG_SAVED responses.
// Each successful save decrements and triggers a fresh load so the UI always reflects
// the server's persisted state, even when multiple auto-saves run back-to-back.
let pendingReloadAfterSaveCount = 0;
let pendingValidationErrors: string[] = [];
let highlightedFields: HTMLElement[] = [];
let highlightedItems: HTMLElement[] = [];

// DOM elements
let errorContainer: HTMLElement;
let successContainer: HTMLElement;
let loadingContainer: HTMLElement;
let configContainer: HTMLElement;
let validationSummary: HTMLElement;
let saveButton: HTMLButtonElement;
let reloadButton: HTMLButtonElement;

/**
 * Initialize the webview
 */
function init(): void {
  // Get DOM elements
  errorContainer = document.getElementById('errorContainer')!;
  successContainer = document.getElementById('successContainer')!;
  loadingContainer = document.getElementById('loadingContainer')!;
  configContainer = document.getElementById('configContainer')!;
  validationSummary = document.getElementById('validationSummary')!;
  saveButton = document.getElementById('saveButton') as HTMLButtonElement;
  reloadButton = document.getElementById('reloadButton') as HTMLButtonElement;

  // Set up event listeners
  saveButton.addEventListener('click', () => {
    saveConfig(false);
  });

  reloadButton.addEventListener('click', () => {
    loadConfig();
  });

  // Listen for messages from extension
  window.addEventListener('message', (event) => {
    const message = event.data;
    handleMessage(message);
  });

  // Notify extension that webview is ready
  vscode.postMessage({type: CONFIG_IN_MSG.READY});
}

/**
 * Handle messages from extension
 */
function handleMessage(message: {type: string; data?: unknown; message?: string; errors?: string[]}): void {
  switch (message.type) {
    case CONFIG_OUT_MSG.LOADING:
      showLoading();
      break;

    case CONFIG_OUT_MSG.CONFIG_LOADED:
      if (message.data && typeof message.data === 'object') {
        const data = message.data as {config: Record<string, unknown>; metadata: Record<string, unknown> | null};
        currentConfig = data.config;
        currentMetadata = data.metadata;

        // Extract provider info from metadata
        if (currentMetadata && Array.isArray(currentMetadata.providers)) {
          availableProviders = (currentMetadata.providers as unknown[])
            .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
            .map((p) => ({
              name: typeof p.name === 'string' ? p.name : '',
              type: typeof p.type === 'string' ? p.type : '',
              has_api_key: Boolean(p.has_api_key),
              model: p.model === null ? null : typeof p.model === 'string' ? p.model : null,
            }));
        }

        // Extract workloads
        if (currentMetadata && Array.isArray(currentMetadata.workloads)) {
          availableWorkloads = (currentMetadata.workloads as unknown[])
            .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null)
            .map((w) => ({
              name: typeof w.name === 'string' ? w.name : '',
              provider: typeof w.provider === 'string' ? w.provider : '',
              model: typeof w.model === 'string' ? w.model : '',
            }));
        }

        // Extract agent provider slots
        if (currentMetadata && Array.isArray(currentMetadata.agent_provider_slots)) {
          agentProviderSlots = (currentMetadata.agent_provider_slots as unknown[])
            .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
            .map((s) => ({
              path: typeof s.path === 'string' ? s.path : '',
              provider: typeof s.provider === 'string' ? s.provider : undefined,
              workload: typeof s.workload === 'string' ? s.workload : undefined,
            }));
        }

        if (currentMetadata && Array.isArray(currentMetadata.provider_types)) {
          providerTypes = (currentMetadata.provider_types as unknown[]).filter(
            (t): t is string => typeof t === 'string',
          );
        }

        // Extract model catalog
        if (currentMetadata?.model_catalog && typeof currentMetadata.model_catalog === 'object') {
          modelCatalog = currentMetadata.model_catalog as Record<string, Record<string, string[]>>;
        }

        renderConfig();
        hideLoading();
      }
      break;

    case CONFIG_OUT_MSG.CONFIG_SAVED:
      if (message.data && typeof message.data === 'object') {
        const data = message.data as {config: Record<string, unknown>};
        currentConfig = data.config;
        isDirty = false;
        saveButton.disabled = true;

        // Clear pending validation errors on successful save
        pendingValidationErrors = [];
        updateValidationSummary();
        applyValidationHighlights();

        if (suppressedSuccessMessages > 0) {
          suppressedSuccessMessages -= 1;
          successContainer.innerHTML = '';
        } else {
          showSuccess('Configuration saved successfully!');
        }

        if (pendingReloadAfterSaveCount > 0) {
          pendingReloadAfterSaveCount -= 1;
          loadConfig();
        } else {
          renderConfig();
        }
      }
      break;

    case CONFIG_OUT_MSG.ERROR:
      showError(message.message || 'An error occurred');
      hideLoading();
      break;

    case CONFIG_OUT_MSG.VALIDATION_ERRORS:
      pendingValidationErrors = Array.isArray(message.errors) ? message.errors : [];
      updateValidationSummary();
      applyValidationHighlights();
      break;
  }
}

/**
 * Show loading state
 */
function showLoading(): void {
  loadingContainer.classList.remove('hidden');
  configContainer.classList.add('hidden');
  errorContainer.innerHTML = '';
  successContainer.innerHTML = '';
}

/**
 * Hide loading state
 */
function hideLoading(): void {
  loadingContainer.classList.add('hidden');
  configContainer.classList.remove('hidden');
}

/**
 * Show error message
 */
function showError(message: string): void {
  errorContainer.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  successContainer.innerHTML = '';
}

/**
 * Show success message
 */
function showSuccess(message: string): void {
  successContainer.innerHTML = `<div class="success">${escapeHtml(message)}</div>`;
  errorContainer.innerHTML = '';

  // Auto-hide success message after 5 seconds
  setTimeout(() => {
    successContainer.innerHTML = '';
  }, 5000);
}

/**
 * Load configuration
 */
function loadConfig(): void {
  vscode.postMessage({type: CONFIG_IN_MSG.LOAD_CONFIG});
}

/**
 * Save configuration
 */
function saveConfig(auto = false): void {
  if (auto) {
    suppressedSuccessMessages += 1;
  }
  pendingReloadAfterSaveCount += 1;
  vscode.postMessage({
    type: CONFIG_IN_MSG.SAVE_CONFIG,
    config: currentConfig,
  });
}

/**
 * Render configuration form
 */
function renderConfig(): void {
  const html: string[] = [];

  // 1. Render providers section (credentials only, NO model field)
  if (currentConfig.providers && typeof currentConfig.providers === 'object') {
    html.push('<div class="section">');
    html.push('<h2 class="section-title">API Providers</h2>');
    html.push('<p class="setting-item-description" style="margin-bottom: 12px;">API credentials and endpoints</p>');

    html.push('<button class="add-provider-btn" id="addProviderBtn">+ Add Provider</button>');

    html.push('<div id="providerList">');
    const providers = currentConfig.providers as Record<string, unknown>;
    for (const [name, providerConfig] of Object.entries(providers)) {
      if (providerConfig && typeof providerConfig === 'object') {
        const providerMeta = availableProviders.find((p) => p.name === name);
        const hasApiKey = providerMeta?.has_api_key ?? false;
        html.push(renderProvider(name, providerConfig as Record<string, unknown>, hasApiKey));
      }
    }
    html.push('</div>');
    html.push('</div>');
  }

  // 2. Render workloads section (task bindings)
  if (currentConfig.workloads && typeof currentConfig.workloads === 'object') {
    html.push('<div class="section">');
    html.push('<h2 class="section-title">Workloads</h2>');
    html.push(
      '<p class="setting-item-description" style="margin-bottom: 12px;">Task-specific model configurations (reasoning, execution, embeddings, etc.)</p>',
    );

    html.push('<button class="add-provider-btn" id="addWorkloadBtn">+ Add Workload</button>');

    html.push('<div id="workloadList">');
    const workloads = currentConfig.workloads as Record<string, unknown>;
    for (const [name, workloadConfig] of Object.entries(workloads)) {
      if (workloadConfig && typeof workloadConfig === 'object') {
        html.push(renderWorkload(name, workloadConfig as Record<string, unknown>));
      }
    }
    html.push('</div>');
    html.push('</div>');
  }

  // Render models section using agent_provider_slots
  if (agentProviderSlots.length > 0) {
    html.push(renderModelsSection());
  }

  // Render other configuration fields (everything except providers and models)
  const excludedKeys = ['providers', 'workloads', 'models'];
  const otherConfig = Object.entries(currentConfig).filter(([key]) => !excludedKeys.includes(key));

  if (otherConfig.length > 0) {
    html.push('<div class="section">');
    html.push('<h2 class="section-title">Server Settings</h2>');

    for (const [key, value] of otherConfig) {
      html.push(renderSettingItem(key, value, ['config', key]));
    }

    html.push('</div>');
  }

  configContainer.innerHTML = html.join('');

  // Attach event listeners
  attachEventListeners();
  applyValidationHighlights();
}

/**
 * Render a collapsible provider
 */
function renderProvider(name: string, config: Record<string, unknown>, hasApiKey: boolean): string {
  const html: string[] = [];
  const providerId = `provider-${name}`;
  const warningClass = hasApiKey ? '' : ' provider-warning';

  html.push(`<div class="provider-item${warningClass}">`);
  html.push(
    `<div class="provider-header" data-provider="${name}" role="button" aria-expanded="false" aria-controls="${providerId}">`,
  );
  html.push('<span class="provider-chevron" aria-hidden="true">▶</span>');
  html.push(`<span class="provider-name">${escapeHtml(name)}</span>`);

  // Show type badge
  if (config.type && typeof config.type === 'string') {
    html.push(`<span class="provider-type-badge">${escapeHtml(config.type)}</span>`);
  }

  // Warning badge if no API key
  if (!hasApiKey) {
    html.push('<span class="provider-warning-badge" title="API key not configured">⚠</span>');
  }

  html.push(`<button class="provider-delete" data-provider="${name}" title="Delete provider">×</button>`);
  html.push('</div>');

  html.push(`<div class="provider-content" id="${providerId}">`);
  for (const [key, value] of Object.entries(config)) {
    if (key === 'type') {
      html.push(renderProviderTypeDropdown(value, ['config', 'providers', name, key]));
      continue;
    }
    if (key === 'model') {
      continue;
    }
    html.push(renderSettingItem(key, value, ['config', 'providers', name, key]));
  }
  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Render a collapsible workload
 */
function renderWorkload(name: string, config: Record<string, unknown>): string {
  const html: string[] = [];
  const workloadId = `workload-${name}`;

  html.push('<div class="provider-item">');
  html.push(
    `<div class="provider-header" data-workload="${name}" role="button" aria-expanded="false" aria-controls="${workloadId}">`,
  );
  html.push('<span class="provider-chevron" aria-hidden="true">▶</span>');
  html.push(`<span class="provider-name">${escapeHtml(name)}</span>`);

  // Show provider and model badges
  if (config.provider && typeof config.provider === 'string') {
    html.push(`<span class="provider-type-badge">${escapeHtml(config.provider)}</span>`);
  }
  if (config.model && typeof config.model === 'string') {
    html.push(
      `<span class="provider-type-badge" style="background-color: var(--vscode-badge-foreground); color: var(--vscode-badge-background);">${escapeHtml(config.model)}</span>`,
    );
  }

  html.push(`<button class="provider-delete" data-workload="${name}" title="Delete workload">×</button>`);
  html.push('</div>');

  html.push(`<div class="provider-content" id="${workloadId}">`);
  // Render workload fields
  for (const [key, value] of Object.entries(config)) {
    // Special handling for 'provider' field - dropdown with providers
    if (key === 'provider') {
      html.push(renderProviderSelectorDropdown(value, ['config', 'workloads', name, key]));
    }
    // Special handling for 'model' field - dropdown with catalog based on selected provider
    else if (key === 'model') {
      const providerName = typeof config.provider === 'string' ? config.provider : '';
      const providerMeta = availableProviders.find((p) => p.name === providerName);
      const providerType = providerMeta?.type || '';

      html.push(renderModelDropdown(providerType, value, ['config', 'workloads', name, key]));
    } else {
      html.push(renderSettingItem(key, value, ['config', 'workloads', name, key]));
    }
  }
  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Render models section using agent_provider_slots (schema-driven)
 */
function renderModelsSection(): string {
  const html: string[] = [];

  html.push('<div class="section">');
  html.push('<h2 class="section-title">Model Slot Bindings</h2>');
  html.push(
    '<p class="setting-item-description" style="margin-bottom: 12px;">Assign workloads to different model slots</p>',
  );

  // Group slots by category (models.agents.*, models.embeddings, etc.)
  const grouped: Record<string, Array<{path: string; provider?: string; workload?: string}>> = {};

  for (const slot of agentProviderSlots) {
    const parts = slot.path.split('.').filter(Boolean);
    const category = parts.length >= 2 ? parts[1] : 'other';

    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(slot);
  }

  // Render each category
  for (const [category, slots] of Object.entries(grouped)) {
    const categoryTitle = formatFieldName(category);
    html.push(
      `<h3 style="font-size: 14px; margin: 16px 0 8px; color: var(--vscode-descriptionForeground); font-weight: 600;">${categoryTitle}</h3>`,
    );

    for (const slot of slots) {
      const parts = slot.path.split('.').filter(Boolean);
      if (parts.length === 0) {
        continue;
      }
      const fieldName = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
      const lastPart = parts[parts.length - 1];
      const currentValue = getConfigValueAtPath(parts);
      const fallbackValue =
        typeof currentValue === 'string'
          ? currentValue
          : lastPart === 'workload'
            ? slot.workload || ''
            : slot.provider || '';

      // Render appropriate dropdown based on path ending
      if (lastPart === 'workload') {
        html.push(renderWorkloadDropdown(fieldName, fallbackValue, parts));
      } else if (lastPart === 'provider') {
        html.push(renderProviderDropdown(fieldName, fallbackValue, parts));
      }
    }
  }

  html.push('</div>');
  return html.join('');
}

/**
 * Render provider selector dropdown (for workload.provider field)
 */
function renderProviderSelectorDropdown(value: unknown, path: string[]): string {
  const html: string[] = [];
  const fieldId = path.join('_');
  const dataPath = JSON.stringify(path);
  const currentValue = typeof value === 'string' ? value : '';

  html.push('<div class="setting-item">');
  html.push('<div class="setting-item-label">');
  html.push('<span class="setting-item-label-text">Provider</span>');
  html.push('<span class="setting-item-description">Which API provider to use</span>');
  html.push('</div>');
  html.push('<div class="setting-item-control">');
  html.push(`<select id="${fieldId}" class="setting-select config-field" data-path='${dataPath}'>`);

  html.push(`<option value="">-- Select Provider --</option>`);

  // Add available providers
  for (const provider of availableProviders) {
    const selected = provider.name === currentValue ? 'selected' : '';
    const missingKeyBadge = !provider.has_api_key ? ' ⚠' : '';
    html.push(
      `<option value="${escapeHtml(provider.name)}" ${selected}>${escapeHtml(provider.name)} (${escapeHtml(provider.type)})${missingKeyBadge}</option>`,
    );
  }

  html.push('</select>');
  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Render provider type dropdown
 */
function renderProviderTypeDropdown(value: unknown, path: string[]): string {
  const html: string[] = [];
  const fieldId = path.join('_');
  const dataPath = JSON.stringify(path);
  const currentValue = typeof value === 'string' ? value : '';

  html.push('<div class="setting-item">');
  html.push('<div class="setting-item-label">');
  html.push('<span class="setting-item-label-text">Type</span>');
  html.push('<span class="setting-item-description">API provider type</span>');
  html.push('</div>');
  html.push('<div class="setting-item-control">');
  html.push(`<select id="${fieldId}" class="setting-select config-field" data-path='${dataPath}'>`);

  // Add provider types from metadata
  for (const type of providerTypes) {
    const selected = type === currentValue ? 'selected' : '';
    html.push(`<option value="${escapeHtml(type)}" ${selected}>${escapeHtml(type)}</option>`);
  }

  html.push('</select>');
  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Render model dropdown from catalog
 */
function renderModelDropdown(providerType: string, value: unknown, path: string[]): string {
  const html: string[] = [];
  const fieldId = path.join('_');
  const dataPath = JSON.stringify(path);
  const currentValue = typeof value === 'string' ? value : value === null ? '' : String(value);

  // Get available models for this provider type
  const models: string[] = [];
  if (providerType && modelCatalog[providerType]) {
    const catalog = modelCatalog[providerType];
    // Add chat models with label
    if (catalog.chat && Array.isArray(catalog.chat)) {
      const chatModels = catalog.chat.filter((m) => typeof m === 'string');
      models.push(...chatModels);
    }
    // Add embeddings models with label
    if (catalog.embeddings && Array.isArray(catalog.embeddings)) {
      const embeddingModels = catalog.embeddings.filter((m) => typeof m === 'string');
      models.push(...embeddingModels);
    }
  }

  // Deduplicate models
  const uniqueModels = Array.from(new Set(models));

  html.push('<div class="setting-item">');
  html.push('<div class="setting-item-label">');
  html.push('<span class="setting-item-label-text">Model</span>');

  if (models.length > 0) {
    html.push('<span class="setting-item-description">Select default model for this provider</span>');
  } else {
    html.push(
      '<span class="setting-item-description">Enter model name (catalog not available for this provider type)</span>',
    );
  }

  html.push('</div>');
  html.push('<div class="setting-item-control">');

  if (uniqueModels.length > 0) {
    // Render as dropdown
    html.push(`<select id="${fieldId}" class="setting-select config-field" data-path='${dataPath}'>`);
    html.push(`<option value="">-- None (use provider default) --</option>`);

    for (const model of uniqueModels) {
      const selected = model === currentValue ? 'selected' : '';
      html.push(`<option value="${escapeHtml(model)}" ${selected}>${escapeHtml(model)}</option>`);
    }

    html.push('</select>');
  } else {
    // Fallback to text input if no catalog
    html.push(
      `<input type="text" id="${fieldId}" class="setting-input config-field" data-path='${dataPath}' value="${escapeHtml(currentValue)}" placeholder="e.g., gpt-4">`,
    );
  }

  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Render workload dropdown for model slot configuration
 */
function renderWorkloadDropdown(fieldName: string, currentWorkload: string, pathParts: string[]): string {
  const html: string[] = [];
  const pathString = pathParts.join('.');
  const pathArray = ['config', ...pathParts];
  const fieldId = pathArray.join('_');

  html.push('<div class="setting-item">');
  html.push('<div class="setting-item-label">');
  html.push(`<span class="setting-item-label-text">${escapeHtml(formatFieldName(fieldName))}</span>`);
  html.push(`<span class="setting-item-description">${escapeHtml(pathString)}</span>`);
  html.push('</div>');
  html.push('<div class="setting-item-control">');
  html.push(`<select id="${fieldId}" class="setting-select config-field" data-path='${JSON.stringify(pathArray)}'>`);

  html.push(`<option value="">-- Select Workload --</option>`);

  // Add workloads from config.workloads, enrich with metadata for display
  if (currentConfig.workloads && typeof currentConfig.workloads === 'object') {
    const workloads = currentConfig.workloads as Record<string, unknown>;

    for (const [workloadName, _] of Object.entries(workloads)) {
      const selected = workloadName === currentWorkload ? 'selected' : '';

      // Find workload info from metadata for display
      const workloadMeta = availableWorkloads.find((w) => w.name === workloadName);
      const displayInfo = workloadMeta ? ` (${workloadMeta.provider} → ${workloadMeta.model})` : '';

      html.push(
        `<option value="${escapeHtml(workloadName)}" ${selected}>${escapeHtml(workloadName)}${displayInfo}</option>`,
      );
    }
  }

  html.push('</select>');
  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Render provider dropdown for model slot configuration (legacy paths)
 */
function renderProviderDropdown(fieldName: string, currentProvider: string, pathParts: string[]): string {
  const html: string[] = [];
  const pathString = pathParts.join('.');
  const pathArray = ['config', ...pathParts];
  const fieldId = pathArray.join('_');

  html.push('<div class="setting-item">');
  html.push('<div class="setting-item-label">');
  html.push(`<span class="setting-item-label-text">${escapeHtml(formatFieldName(fieldName))}</span>`);
  html.push(`<span class="setting-item-description">${escapeHtml(pathString)}</span>`);
  html.push('</div>');
  html.push('<div class="setting-item-control">');
  html.push(`<select id="${fieldId}" class="setting-select config-field" data-path='${JSON.stringify(pathArray)}'>`);

  html.push(`<option value="">-- Select Provider --</option>`);

  // Add available providers
  for (const provider of availableProviders) {
    const selected = provider.name === currentProvider ? 'selected' : '';
    const missingKeyBadge = !provider.has_api_key ? ' ⚠' : '';
    html.push(
      `<option value="${escapeHtml(provider.name)}" ${selected}>${escapeHtml(provider.name)} (${escapeHtml(provider.type)})${missingKeyBadge}</option>`,
    );
  }

  html.push('</select>');
  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Render a setting item in VSCode settings style
 */
function renderSettingItem(key: string, value: unknown, path: string[]): string {
  const html: string[] = [];
  const fieldId = path.join('_');
  const dataPath = JSON.stringify(path);

  html.push('<div class="setting-item">');
  html.push('<div class="setting-item-label">');
  html.push(`<span class="setting-item-label-text">${escapeHtml(formatFieldName(key))}</span>`);
  html.push('</div>');
  html.push('<div class="setting-item-control">');

  if (typeof value === 'boolean') {
    const checked = value ? 'checked' : '';
    html.push('<div class="setting-checkbox-container">');
    html.push(
      `<label class="setting-checkbox-label">
        <input type="checkbox" id="${fieldId}" class="setting-checkbox config-field" data-path='${dataPath}' ${checked} aria-label="${escapeHtml(formatFieldName(key))}">
        <span class="visually-hidden">${escapeHtml(formatFieldName(key))}</span>
      </label>`,
    );
    html.push('</div>');
  } else if (typeof value === 'number') {
    html.push(
      `<input type="number" id="${fieldId}" class="setting-input config-field" data-path='${dataPath}' value="${value}">`,
    );
  } else if (typeof value === 'string') {
    // Check if it's likely an API key (mask it)
    const isSecret = key.toLowerCase().includes('key') || key.toLowerCase().includes('token');
    const displayValue = isSecret && value ? '••••••••' : value;
    const inputType = isSecret ? 'password' : 'text';

    if (value.includes('\n') || value.length > 100) {
      html.push(
        `<textarea id="${fieldId}" class="setting-textarea config-field" data-path='${dataPath}'>${escapeHtml(value)}</textarea>`,
      );
    } else {
      html.push(
        `<input type="${inputType}" id="${fieldId}" class="setting-input config-field" data-path='${dataPath}' value="${escapeHtml(displayValue)}" placeholder="${isSecret ? 'Enter to update' : ''}">`,
      );
    }
  } else if (value === null) {
    html.push(
      `<input type="text" id="${fieldId}" class="setting-input config-field" data-path='${dataPath}' value="" placeholder="null">`,
    );
  } else if (typeof value === 'object') {
    // Render nested object as JSON
    html.push(
      `<textarea id="${fieldId}" class="setting-textarea config-field" data-path='${dataPath}'>${escapeHtml(JSON.stringify(value, null, 2))}</textarea>`,
    );
  } else {
    html.push(
      `<input type="text" id="${fieldId}" class="setting-input config-field" data-path='${dataPath}' value="${escapeHtml(String(value))}">`,
    );
  }

  html.push('</div>');
  html.push('</div>');

  return html.join('');
}

/**
 * Attach event listeners to config fields and buttons
 */
function attachEventListeners(): void {
  // Config field changes
  const fields = document.querySelectorAll('.config-field');
  for (const field of fields) {
    const element = field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const pathStr = element.getAttribute('data-path');

    if (!pathStr) continue;

    const path = JSON.parse(pathStr) as string[];

    const handleChange = () => {
      removeHighlightFromField(element);
      updateConfigValue(path, element);
      markDirty();
    };

    // For text-like inputs we rely on 'input' for real-time updates.
    element.addEventListener('input', handleChange);

    // For selects/checkboxes some browsers only fire 'change', so add it as fallback.
    if (element.tagName === 'SELECT' || element.type === 'checkbox' || element.type === 'radio') {
      element.addEventListener('change', handleChange);
    }
  }

  // Provider header clicks (expand/collapse)
  const providerHeaders = document.querySelectorAll('.provider-header');
  for (const header of providerHeaders) {
    header.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Don't toggle if clicking delete button
      if (target.classList.contains('provider-delete')) {
        return;
      }

      const providerName = (header as HTMLElement).getAttribute('data-provider');
      const workloadName = (header as HTMLElement).getAttribute('data-workload');

      if (providerName) {
        toggleProvider(providerName);
      } else if (workloadName) {
        toggleWorkload(workloadName);
      }
    });
  }

  // Provider/Workload delete buttons
  const deleteButtons = document.querySelectorAll('.provider-delete');
  for (const button of deleteButtons) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const providerName = (button as HTMLElement).getAttribute('data-provider');
      const workloadName = (button as HTMLElement).getAttribute('data-workload');

      if (providerName) {
        deleteProvider(providerName);
      } else if (workloadName) {
        deleteWorkload(workloadName);
      }
    });
  }

  // Add provider button
  const addProviderBtn = document.getElementById('addProviderBtn');
  if (addProviderBtn) {
    addProviderBtn.addEventListener('click', () => {
      addProvider();
    });
  }

  // Add workload button
  const addWorkloadBtn = document.getElementById('addWorkloadBtn');
  if (addWorkloadBtn) {
    addWorkloadBtn.addEventListener('click', () => {
      addWorkload();
    });
  }
}

/**
 * Toggle provider expand/collapse
 */
function toggleProvider(providerName: string): void {
  const content = document.getElementById(`provider-${providerName}`);
  if (!content) {
    return;
  }
  const shouldExpand = !content.classList.contains('expanded');
  setProviderExpanded(providerName, shouldExpand);
}

/**
 * Toggle workload expand/collapse
 */
function toggleWorkload(workloadName: string): void {
  const content = document.getElementById(`workload-${workloadName}`);
  if (!content) {
    return;
  }
  const shouldExpand = !content.classList.contains('expanded');
  setWorkloadExpanded(workloadName, shouldExpand);
}

function setProviderExpanded(providerName: string, expanded: boolean): void {
  const content = document.getElementById(`provider-${providerName}`);
  const header = document.querySelector(`[data-provider="${providerName}"]`);
  if (!content || !header) {
    return;
  }

  const chevron = header.querySelector('.provider-chevron');
  if (expanded) {
    content.classList.add('expanded');
    chevron?.classList.add('expanded');
    header.setAttribute('aria-expanded', 'true');
  } else {
    content.classList.remove('expanded');
    chevron?.classList.remove('expanded');
    header.setAttribute('aria-expanded', 'false');
  }
}

function setWorkloadExpanded(workloadName: string, expanded: boolean): void {
  const content = document.getElementById(`workload-${workloadName}`);
  const header = document.querySelector(`[data-workload="${workloadName}"]`);
  if (!content || !header) {
    return;
  }

  const chevron = header.querySelector('.provider-chevron');
  if (expanded) {
    content.classList.add('expanded');
    chevron?.classList.add('expanded');
    header.setAttribute('aria-expanded', 'true');
  } else {
    content.classList.remove('expanded');
    chevron?.classList.remove('expanded');
    header.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Add new provider
 */
function addProvider(): void {
  const name = prompt('Enter provider name:');
  if (!name || name.trim() === '') {
    return;
  }

  const trimmedName = name.trim();

  // Check if provider already exists
  if (currentConfig.providers && typeof currentConfig.providers === 'object') {
    const providers = currentConfig.providers as Record<string, unknown>;
    if (trimmedName in providers) {
      alert('Provider with this name already exists!');
      return;
    }
  }

  // Select provider type
  let type = 'openai';
  if (providerTypes.length > 0) {
    const typeChoice = prompt(`Enter provider type (${providerTypes.join(', ')}):`, providerTypes[0]);
    if (typeChoice && providerTypes.includes(typeChoice)) {
      type = typeChoice;
    }
  }

  // Add new provider to config
  if (!currentConfig.providers) {
    currentConfig.providers = {};
  }

  const providers = currentConfig.providers as Record<string, unknown>;
  providers[trimmedName] = {
    type,
    api_key: '',
    base_url: '',
    options: {},
  };

  markDirty();
  renderConfig();
  saveConfig(true);

  // Expand the newly added provider
  setTimeout(() => {
    toggleProvider(trimmedName);
  }, 100);
}

/**
 * Add new workload
 */
function addWorkload(): void {
  const name = prompt('Enter workload name (e.g., reasoning, execution):');
  if (!name || name.trim() === '') {
    return;
  }

  const trimmedName = name.trim();

  // Check if workload already exists
  if (currentConfig.workloads && typeof currentConfig.workloads === 'object') {
    const workloads = currentConfig.workloads as Record<string, unknown>;
    if (trimmedName in workloads) {
      alert('Workload with this name already exists!');
      return;
    }
  }

  // Add new workload to config
  if (!currentConfig.workloads) {
    currentConfig.workloads = {};
  }

  const workloads = currentConfig.workloads as Record<string, unknown>;
  workloads[trimmedName] = {
    provider: '',
    model: '',
    options: {},
  };

  markDirty();
  renderConfig();
  saveConfig(true);

  // Expand the newly added workload
  setTimeout(() => {
    toggleWorkload(trimmedName);
  }, 100);
}

/**
 * Delete provider
 */
function deleteProvider(providerName: string): void {
  if (!confirm(`Are you sure you want to delete provider "${providerName}"?`)) {
    return;
  }

  if (currentConfig.providers && typeof currentConfig.providers === 'object') {
    const providers = currentConfig.providers as Record<string, unknown>;
    delete providers[providerName];
    markDirty();
    renderConfig();
    saveConfig(true);
  }
}

/**
 * Delete workload
 */
function deleteWorkload(workloadName: string): void {
  if (!confirm(`Are you sure you want to delete workload "${workloadName}"?`)) {
    return;
  }

  if (currentConfig.workloads && typeof currentConfig.workloads === 'object') {
    const workloads = currentConfig.workloads as Record<string, unknown>;
    delete workloads[workloadName];
    markDirty();
    renderConfig();
    saveConfig(true);
  }
}

/**
 * Update config value from form field
 */
function updateConfigValue(path: string[], element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  let value: unknown;

  if (element.type === 'checkbox') {
    value = (element as HTMLInputElement).checked;
  } else if (element.type === 'number') {
    value = parseFloat(element.value);
  } else if (element.classList.contains('setting-textarea') && element.value.trim().startsWith('{')) {
    // Try to parse as JSON
    try {
      value = JSON.parse(element.value);
    } catch {
      value = element.value;
    }
  } else if (element.value === '' || element.value === 'null') {
    value = null;
  } else if (element.type === 'password' && element.value === '••••••••') {
    // Don't update if password placeholder hasn't changed
    return;
  } else {
    value = element.value;
  }

  // Navigate to the correct position in config and update
  const normalizedPath = path[0] === 'config' ? path.slice(1) : path.slice();
  if (normalizedPath.length === 0) {
    return;
  }

  let current: Record<string, unknown> = currentConfig;
  for (let i = 0; i < normalizedPath.length - 1; i++) {
    const key = normalizedPath[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = normalizedPath[normalizedPath.length - 1];
  current[lastKey] = value;
}

/**
 * Safely read a value from currentConfig using dot-separated path parts
 */
function getConfigValueAtPath(pathParts: string[]): unknown {
  let current: unknown = currentConfig;
  for (const key of pathParts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Mark configuration as dirty
 */
function markDirty(): void {
  if (!isDirty) {
    isDirty = true;
    saveButton.disabled = false;
  }
}

/**
 * Show or hide validation summary banner
 */
function updateValidationSummary(): void {
  if (!validationSummary) {
    return;
  }

  const implicitHints = getImplicitValidationHints();

  if (!pendingValidationErrors.length && implicitHints.length === 0) {
    validationSummary.classList.add('hidden');
    validationSummary.innerHTML = '';
    return;
  }

  const listItems = [
    ...pendingValidationErrors.map((error) => `<li>${escapeHtml(error)}</li>`),
    ...implicitHints.map((hint) => `<li>${escapeHtml(hint.message)}</li>`),
  ].join('');

  validationSummary.innerHTML = `
    <div class="validation-summary-title">Configuration issues detected</div>
    <ul>${listItems}</ul>
  `;
  validationSummary.classList.remove('hidden');
}

type ParsedValidationHint = {message: string; path?: string[]};

function applyValidationHighlights(): void {
  clearValidationHighlights();

  if (!pendingValidationErrors.length) {
    return;
  }

  const parsedHints = [
    ...pendingValidationErrors
      .map((error) => parseValidationError(error))
      .filter((hint): hint is ParsedValidationHint => Boolean(hint)),
    ...getImplicitValidationHints(),
  ];

  const hintsWithPath = parsedHints.filter((hint) => Array.isArray(hint.path));
  if (hintsWithPath.length === 0) {
    return;
  }

  let firstField: HTMLElement | null = null;

  for (const hint of hintsWithPath) {
    if (!hint.path) continue;
    ensureSectionExpandedForPath(hint.path);
    const field = findFieldByPath(hint.path);
    if (field) {
      highlightField(field);
      if (!firstField) {
        firstField = field;
      }
    }
  }

  if (firstField) {
    requestAnimationFrame(() => {
      firstField.scrollIntoView({behavior: 'smooth', block: 'center'});
      try {
        (firstField as HTMLElement).focus();
      } catch {
        // ignore focus errors
      }
    });
  }
}

function clearValidationHighlights(): void {
  for (const field of highlightedFields) {
    field.classList.remove('config-field-error');
  }
  for (const item of highlightedItems) {
    item.classList.remove('error-highlight');
  }
  highlightedFields = [];
  highlightedItems = [];
}

function highlightField(field: Element): void {
  const element = field as HTMLElement;
  element.classList.add('config-field-error');
  highlightedFields.push(element);
  const settingItem = element.closest('.setting-item') as HTMLElement | null;
  if (settingItem) {
    settingItem.classList.add('error-highlight');
    highlightedItems.push(settingItem);
  }
}

function removeHighlightFromField(field: Element): void {
  const element = field as HTMLElement;
  element.classList.remove('config-field-error');
  highlightedFields = highlightedFields.filter((item) => item !== element);
  const settingItem = element.closest('.setting-item') as HTMLElement | null;
  if (settingItem) {
    settingItem.classList.remove('error-highlight');
    highlightedItems = highlightedItems.filter((item) => item !== settingItem);
  }
}

function findFieldByPath(path: string[]): HTMLElement | null {
  const fields = document.querySelectorAll('.config-field');
  for (const field of Array.from(fields)) {
    const attr = field.getAttribute('data-path');
    if (!attr) continue;
    try {
      const parsed = JSON.parse(attr) as string[];
      if (arraysEqual(parsed, path)) {
        return field as HTMLElement;
      }
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function ensureSectionExpandedForPath(path: string[]): void {
  if (path.length < 3) {
    return;
  }
  const section = path[1];
  const entry = path[2];
  if (section === 'providers' && entry) {
    setProviderExpanded(entry, true);
  } else if (section === 'workloads' && entry) {
    setWorkloadExpanded(entry, true);
  }
}

function parseValidationError(error: string): ParsedValidationHint | null {
  if (typeof error !== 'string') {
    return null;
  }
  const trimmed = error.trim();
  if (!trimmed) {
    return null;
  }

  const pathMatch = trimmed.match(/(config\.[\w.-]+|providers\.[\w.-]+|workloads\.[\w.-]+|models\.[\w.-]+)/);
  if (!pathMatch) {
    return {message: trimmed};
  }

  let rawPath = pathMatch[0];
  if (!rawPath.startsWith('config.')) {
    rawPath = `config.${rawPath}`;
  }
  const segments = rawPath.split('.').filter(Boolean);
  if (segments.length === 0) {
    return {message: trimmed};
  }

  return {
    message: trimmed,
    path: segments,
  };
}

function getImplicitValidationHints(): ParsedValidationHint[] {
  if (!pendingValidationErrors.length) {
    return [];
  }

  const hints: ParsedValidationHint[] = [];

  for (const provider of availableProviders) {
    if (!provider.has_api_key) {
      hints.push({
        message: `Provider "${provider.name}" is missing an API key.`,
        path: ['config', 'providers', provider.name, 'api_key'],
      });
    }
  }

  return hints;
}

/**
 * Format field name for display
 */
function formatFieldName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Escape HTML
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
