# Configuration Management

This document describes the configuration management system implemented in the AgentSmithy VSCode extension.

## Overview

The extension supports loading and managing dynamic server configuration through a custom webview panel. The configuration follows a three-tier architecture: **Providers → Workloads → Model Slots**.

> **Legacy configs:** older setups stored models directly under `config.providers` (e.g., `providers.gpt5`). The extension now auto-migrates those entries so credentials live in `providers.<vendor>`, models live in `workloads.<task>`, and model slots reference workloads.

## Architecture

### Three-Tier Configuration

```
┌─────────────────────────────────────────┐
│ 1. PROVIDERS (credentials)              │
│    openai: {type, api_key, base_url}    │
├─────────────────────────────────────────┤
│ 2. WORKLOADS (task bindings)            │
│    reasoning: {provider, model, options}│
├─────────────────────────────────────────┤
│ 3. MODEL SLOTS (assignments)            │
│    models.agents.writer: {workload}     │
└─────────────────────────────────────────┘
```

**Benefits:**

- Configure API credentials once in Providers
- Define task-specific models in Workloads
- Assign workloads to different slots
- Change model without touching credentials

### Example Flow

1. **Add Provider:** Configure OpenAI credentials once

   ```json
   "providers": {
     "openai": {
       "type": "openai",
       "api_key": "sk-...",
       "base_url": "https://api.openai.com/v1"
     }
   }
   ```

2. **Define Workloads:** Create task-specific configurations

   ```json
   "workloads": {
     "reasoning": {"provider": "openai", "model": "gpt-5"},
     "execution": {"provider": "openai", "model": "gpt-5-mini"}
   }
   ```

3. **Assign Slots:** Point model slots to workloads
   ```json
   "models": {
     "agents": {
       "writer": {"workload": "reasoning"}
     }
   }
   ```

## Features

### 1. Health Check Integration

- After server startup, extension checks `/health` endpoint
- If `config_valid` is `false`, displays warning notification
- Option to open configuration panel automatically
- Configuration errors are passed directly to the panel for display

### 2. Configuration Webview

Custom webview panel in main editor area (not sidebar) for dynamic configuration.

**Sections:**

**API Providers** (collapsible)

- Credentials and endpoints
- Type dropdown: openai, anthropic, xai, deepseek, other
- API Key (masked input)
- Base URL
- Options (JSON)
- ⚠ Warning badge if API key missing
- Add/Delete providers dynamically

**Workloads** (collapsible)

- Task-specific model configurations
- Provider dropdown (from available providers)
- Model dropdown (from model catalog based on provider type)
- Options (JSON)
- Add/Delete workloads dynamically

**Model Slot Bindings**

- Schema-driven from `metadata.agent_provider_slots`
- Detects `.provider` or `.workload` path ending
- Workload dropdown shows: "reasoning (openai → gpt-5)"
- Provider dropdown shows: "openai (openai) ⚠" if no key

**Server Settings**

- All other server configuration (ports, logging, etc.)

### 3. Validation & Highlights

The configuration panel features real-time validation feedback:

- **Validation Banner:** Displays a summary of all configuration errors at the top of the panel
- **Field Highlighting:** Invalid fields (e.g., missing API keys) are highlighted with a red border
- **Auto-Expansion:** Sections containing errors are automatically expanded when the panel opens
- **Focus:** The panel automatically scrolls to and focuses the first invalid field
- **Real-time Clearance:** Highlights disappear immediately when the user edits the field
- **Implicit Hints:** Automatically detects and flags providers missing API keys, even if not explicitly reported by the server

### 4. Schema-Driven UI

The UI automatically adapts to server configuration:

**metadata fields:**

- `provider_types` → Type dropdown options
- `providers` → Available providers list + API key status
- `workloads` → Available workloads with resolved provider/model
- `agent_provider_slots` → Which fields need dropdowns (`.provider` or `.workload`)
- `model_catalog` → Available models per provider type (chat/embeddings)

**Benefits:**

- No hard-coded schemas in client
- Automatically adapts to new providers/workloads
- Server defines what UI should render

### 5. Model Catalog Integration

Models are loaded from `metadata.model_catalog`:

```json
"model_catalog": {
  "openai": {
    "chat": ["gpt-5", "gpt-5-mini"],
    "embeddings": ["text-embedding-3-small", "text-embedding-3-large"]
  }
}
```

**Workload Model field:**

- Dropdown if catalog available for provider type
- Text input as fallback
- Combines chat + embeddings models
- Deduplicates model list

### 6. Dynamic API Service URL

ApiService now uses a getter function instead of static URL:

- Reads port from `.agentsmithy/status.json` dynamically
- Automatically adapts when server restarts on different port
- No need to recreate service instances

## Commands

**AgentSmithy: Open Configuration**

- Opens configuration panel in main editor
- Available in Command Palette
- Automatically opened when config invalid

## Usage

### Opening Configuration Panel

**Via Command Palette:**

1. `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Type "AgentSmithy: Open Configuration"
3. Press Enter

**Automatic Prompt:**

- Server starts with invalid configuration
- Notification appears with "Open Settings" button
- Click to open panel

### Configuring API Providers

1. Open configuration panel
2. Navigate to "API Providers" section
3. Click "+ Add Provider" or expand existing
4. Set Type (dropdown: openai, anthropic, etc.)
5. Enter API Key (masked)
6. Set Base URL
7. Click "Save Configuration"

### Creating Workloads

1. Navigate to "Workloads" section
2. Click "+ Add Workload"
3. Enter name (e.g., "reasoning", "execution")
4. Select Provider from dropdown
5. Select Model from dropdown (based on provider type)
6. Click "Save Configuration"

### Assigning Model Slots

1. Navigate to "Model Slot Bindings" section
2. Find the slot (e.g., "Writer" under "Agents")
3. Select Workload from dropdown
4. Workload dropdown shows: "reasoning (openai → gpt-5)"
5. Click "Save Configuration"

## Configuration File Location

Configuration is saved on the server side:

- **Linux**: `~/.config/agentsmithy/config.json` (respects `XDG_CONFIG_HOME`)
- **macOS**: `~/Library/Application Support/AgentSmithy/config.json`
- **Windows**: `%APPDATA%\AgentSmithy\config.json`

**Per-project overrides:** `<workspace>/.agentsmithy/config.json` (read-only, merged on top)

Changes apply immediately via hot reload - no server restart required.

## API Endpoints

### GET /health

```json
{
  "server_status": "ready",
  "config_valid": false,
  "config_errors": ["API key not configured"]
}
```

Possible `server_status` values:

- `starting` – server is booting and not ready for requests yet
- `ready` – server is listening and healthy
- `stopping` / `stopped` – server is shutting down or already offline
- `error` – startup/validation failure
- `crashed` – process died unexpectedly

### GET /api/config

```json
{
  "config": {
    "providers": {...},
    "workloads": {...},
    "models": {...}
  },
  "metadata": {
    "provider_types": ["openai", "anthropic", ...],
    "providers": [{name, type, has_api_key, model}],
    "workloads": [{name, provider, model}],
    "agent_provider_slots": [{path, provider/workload}],
    "model_catalog": {
      "openai": {
        "chat": [...],
        "embeddings": [...]
      }
    }
  }
}
```

### PUT /api/config

```json
{
  "config": {
    "providers": {...},
    "workloads": {...}
  }
}
```

## Technical Details

### Build System

Configuration webview built separately:

- Source: `src/webview/src/config-webview.ts`
- Output: `dist/config-webview.js`
- Build tool: esbuild (IIFE format)

### Component Structure

**ConfigWebviewProvider** (`src/configWebviewProvider.ts`)

- Manages webview panel lifecycle
- Handles extension ↔ webview communication
- Loads/saves configuration via ApiService
- Manages validation error state and highlighting

**Config Webview Script** (`src/webview/src/config-webview.ts`)

- Client-side rendering logic
- Form generation from server schema
- Event handling (expand/collapse, add/delete)
- Validation UI (banners, highlights, scrolling)

### Message Protocol

**Extension → Webview:**

```typescript
{type: 'loading'}
{type: 'configLoaded', data: {config, metadata}}
{type: 'configSaved', data: {success, message, config}}
{type: 'error', message: string}
{type: 'validationErrors', errors: string[]}
```

**Webview → Extension:**

```typescript
{type: 'ready'}
{type: 'loadConfig'}
{type: 'saveConfig', config: {...}}
```

### Rendering Functions

**Providers:**

- `renderProvider()` - Collapsible provider UI
- `renderProviderTypeDropdown()` - Type selector

**Workloads:**

- `renderWorkload()` - Collapsible workload UI
- `renderProviderSelectorDropdown()` - Provider selector
- `renderModelDropdown()` - Model selector with catalog

**Model Slots:**

- `renderModelsSection()` - Schema-driven slots
- `renderWorkloadDropdown()` - Workload selector
- `renderProviderDropdown()` - Provider selector (legacy)

### CSS Styling

Uses native VSCode CSS variables:

```css
--vscode-settings-headerForeground
--vscode-settings-textInputBackground
--vscode-settings-textInputForeground
--vscode-list-hoverBackground
--vscode-focusBorder
--vscode-inputValidation-errorBorder
--vscode-inputValidation-errorBackground
```

**Theme Support:**

- Automatically adapts to all VSCode themes
- No manual theme switching code needed
- Dark/Light themes work out of the box

### Security

- Sensitive fields (API keys) masked with password input
- Content Security Policy enforced
- No logging of credentials
- Webview sandboxing

## Testing

**Unit Tests:** `src/api/__tests__/ApiService.config.test.ts`

- Tests config parsing
- Tests metadata extraction
- Tests model catalog handling

**Integration Test:** `src/api/__tests__/ApiService.config-integration.test.ts`

- Tests with real server
- Validates full response structure

Run tests: `npm test`

## Troubleshooting

### Dropdown shows text input instead

**Issue:** Model field shows text input instead of dropdown

**Cause:** `model_catalog` not loaded from server

**Fix:**

1. Check server response: `curl http://localhost:8766/api/config | jq '.metadata.model_catalog'`
2. Ensure server version supports model_catalog
3. Check browser console for errors
4. Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"

### Configuration not saving

**Issue:** Changes don't persist after clicking "Save"

**Cause:** Server port mismatch or network error

**Fix:**

1. Check server is running: `curl http://localhost:8766/health`
2. Verify port in `.agentsmithy/status.json`
3. Check output channel for errors
4. Ensure server has write permissions to config file

### Validation errors persist after fix

**Issue:** Red validation banner remains after entering correct key

**Cause:** Webview state not cleared

**Fix:**

1. The extension should auto-clear errors on save
2. Click "Reload" button at bottom of panel
3. If persistent, check server logs for rejection reasons

### Provider/Workload not expanding

**Issue:** Click on header doesn't expand provider/workload

**Cause:** JavaScript event listeners not attached

**Fix:**

1. Open browser DevTools: `Help` → `Toggle Developer Tools`
2. Check Console for JavaScript errors
3. Reload window
4. Report errors in issue tracker

## Migration from Old Architecture

**Old (direct provider reference):**

```json
"models": {
  "agents": {
    "universal": {"provider": "gpt5"}
  }
}
```

**New (workload-based):**

```json
"providers": {
  "openai": {"type": "openai", "api_key": "..."}
}
"workloads": {
  "reasoning": {"provider": "openai", "model": "gpt-5"}
}
"models": {
  "agents": {
    "universal": {"workload": "reasoning"}
  }
}
```

**UI shows both:**

- `.provider` paths → Provider dropdown
- `.workload` paths → Workload dropdown

Server determines which format to use via `metadata.agent_provider_slots`.
