/**
 * Tests for config-webview logic
 * These tests import and test REAL code from config-webview-logic.ts
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {
  CONFIG_IN_MSG,
  CONFIG_OUT_MSG,
  parseProvidersMeta,
  parseWorkloadsMeta,
  parseAgentProviderSlots,
  parseStringArray,
  parseModelCatalog,
  ExpandedStateManager,
  ScrollPositionManager,
  updateConfigAtPath,
  getConfigAtPath,
  isValueInCatalog,
  getModelsFromCatalog,
  validateProviderName,
  validateWorkloadName,
  createProviderDeletionPayload,
  createWorkloadDeletionPayload,
  parseFieldValue,
} from '../config-webview-logic';

describe('CONFIG_IN_MSG constants', () => {
  it('has correct message types', () => {
    expect(CONFIG_IN_MSG.READY).toBe('ready');
    expect(CONFIG_IN_MSG.LOAD_CONFIG).toBe('loadConfig');
    expect(CONFIG_IN_MSG.SAVE_CONFIG).toBe('saveConfig');
    expect(CONFIG_IN_MSG.RENAME_CONFIG).toBe('renameConfig');
    expect(CONFIG_IN_MSG.SHOW_INPUT_BOX).toBe('showInputBox');
    expect(CONFIG_IN_MSG.SHOW_QUICK_PICK).toBe('showQuickPick');
    expect(CONFIG_IN_MSG.SHOW_CONFIRM).toBe('showConfirm');
  });
});

describe('CONFIG_OUT_MSG constants', () => {
  it('has correct message types', () => {
    expect(CONFIG_OUT_MSG.CONFIG_LOADED).toBe('configLoaded');
    expect(CONFIG_OUT_MSG.CONFIG_SAVED).toBe('configSaved');
    expect(CONFIG_OUT_MSG.CONFIG_RENAMED).toBe('configRenamed');
    expect(CONFIG_OUT_MSG.ERROR).toBe('error');
    expect(CONFIG_OUT_MSG.LOADING).toBe('loading');
    expect(CONFIG_OUT_MSG.VALIDATION_ERRORS).toBe('validationErrors');
    expect(CONFIG_OUT_MSG.INPUT_RESULT).toBe('inputResult');
    expect(CONFIG_OUT_MSG.QUICK_PICK_RESULT).toBe('quickPickResult');
    expect(CONFIG_OUT_MSG.CONFIRM_RESULT).toBe('confirmResult');
  });
});

describe('parseProvidersMeta', () => {
  it('parses valid providers array', () => {
    const data = [
      {name: 'openai', type: 'openai', has_api_key: true, model: 'gpt-4'},
      {name: 'anthropic', type: 'anthropic', has_api_key: false, model: null},
    ];

    const result = parseProvidersMeta(data);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({name: 'openai', type: 'openai', has_api_key: true, model: 'gpt-4'});
    expect(result[1]).toEqual({name: 'anthropic', type: 'anthropic', has_api_key: false, model: null});
  });

  it('returns empty array for non-array input', () => {
    expect(parseProvidersMeta(null)).toEqual([]);
    expect(parseProvidersMeta(undefined)).toEqual([]);
    expect(parseProvidersMeta('string')).toEqual([]);
    expect(parseProvidersMeta({})).toEqual([]);
  });

  it('filters out non-object items', () => {
    const data = [{name: 'openai', type: 'openai', has_api_key: true, model: null}, null, 'string', 123];

    const result = parseProvidersMeta(data);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('openai');
  });

  it('provides defaults for missing fields', () => {
    const data = [{name: 'test'}];

    const result = parseProvidersMeta(data);

    expect(result[0]).toEqual({name: 'test', type: '', has_api_key: false, model: null});
  });
});

describe('parseWorkloadsMeta', () => {
  it('parses valid workloads array', () => {
    const data = [
      {name: 'reasoning', provider: 'openai', model: 'gpt-4', kind: 'chat'},
      {name: 'embeddings', provider: 'openai', model: 'text-embedding-3-small', kind: 'embeddings'},
    ];

    const result = parseWorkloadsMeta(data);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({name: 'reasoning', provider: 'openai', model: 'gpt-4', kind: 'chat'});
    expect(result[1]).toEqual({
      name: 'embeddings',
      provider: 'openai',
      model: 'text-embedding-3-small',
      kind: 'embeddings',
    });
  });

  it('returns null for kind when not present (legacy workloads)', () => {
    const data = [{name: 'legacy', provider: 'openai', model: 'gpt-4'}];

    const result = parseWorkloadsMeta(data);

    expect(result[0].kind).toBeNull();
  });

  it('returns empty array for non-array input', () => {
    expect(parseWorkloadsMeta(null)).toEqual([]);
    expect(parseWorkloadsMeta(undefined)).toEqual([]);
  });
});

describe('parseAgentProviderSlots', () => {
  it('parses valid slots array', () => {
    const data = [
      {path: 'models.agents.universal', provider: 'openai', workload: 'reasoning'},
      {path: 'models.agents.inspector'},
    ];

    const result = parseAgentProviderSlots(data);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({path: 'models.agents.universal', provider: 'openai', workload: 'reasoning'});
    expect(result[1]).toEqual({path: 'models.agents.inspector', provider: undefined, workload: undefined});
  });

  it('returns empty array for non-array input', () => {
    expect(parseAgentProviderSlots(null)).toEqual([]);
    expect(parseAgentProviderSlots({})).toEqual([]);
  });
});

describe('parseStringArray', () => {
  it('parses valid string array', () => {
    const data = ['openai', 'anthropic', 'azure'];

    const result = parseStringArray(data);

    expect(result).toEqual(['openai', 'anthropic', 'azure']);
  });

  it('filters out non-string items', () => {
    const data = ['valid', 123, null, 'also-valid', {}];

    const result = parseStringArray(data);

    expect(result).toEqual(['valid', 'also-valid']);
  });

  it('returns empty array for non-array input', () => {
    expect(parseStringArray(null)).toEqual([]);
    expect(parseStringArray('string')).toEqual([]);
  });
});

describe('parseModelCatalog', () => {
  it('parses valid catalog', () => {
    const data = {
      openai: {
        chat: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        embeddings: ['text-embedding-3-small'],
      },
      anthropic: {
        chat: ['claude-3-opus', 'claude-3-sonnet'],
      },
    };

    const result = parseModelCatalog(data);

    expect(result.openai.chat).toEqual(['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']);
    expect(result.openai.embeddings).toEqual(['text-embedding-3-small']);
    expect(result.anthropic.chat).toEqual(['claude-3-opus', 'claude-3-sonnet']);
  });

  it('returns empty object for non-object input', () => {
    expect(parseModelCatalog(null)).toEqual({});
    expect(parseModelCatalog('string')).toEqual({});
    expect(parseModelCatalog([])).toEqual({});
  });

  it('filters non-string models', () => {
    const data = {
      openai: {
        chat: ['gpt-4', 123, null, 'gpt-3.5-turbo'],
      },
    };

    const result = parseModelCatalog(data);

    expect(result.openai.chat).toEqual(['gpt-4', 'gpt-3.5-turbo']);
  });
});

describe('ExpandedStateManager', () => {
  let manager: ExpandedStateManager;

  beforeEach(() => {
    manager = new ExpandedStateManager();
  });

  describe('provider expansion', () => {
    it('tracks expanded providers', () => {
      manager.setProviderExpanded('openai', true);
      manager.setProviderExpanded('anthropic', true);

      expect(manager.isProviderExpanded('openai')).toBe(true);
      expect(manager.isProviderExpanded('anthropic')).toBe(true);
      expect(manager.isProviderExpanded('azure')).toBe(false);
    });

    it('collapses providers', () => {
      manager.setProviderExpanded('openai', true);
      manager.setProviderExpanded('openai', false);

      expect(manager.isProviderExpanded('openai')).toBe(false);
    });

    it('returns expanded providers list', () => {
      manager.setProviderExpanded('openai', true);
      manager.setProviderExpanded('anthropic', true);

      const expanded = manager.getExpandedProviders();

      expect(expanded).toContain('openai');
      expect(expanded).toContain('anthropic');
      expect(expanded).toHaveLength(2);
    });
  });

  describe('workload expansion', () => {
    it('tracks expanded workloads', () => {
      manager.setWorkloadExpanded('reasoning', true);
      manager.setWorkloadExpanded('coding', true);

      expect(manager.isWorkloadExpanded('reasoning')).toBe(true);
      expect(manager.isWorkloadExpanded('coding')).toBe(true);
      expect(manager.isWorkloadExpanded('embeddings')).toBe(false);
    });

    it('collapses workloads', () => {
      manager.setWorkloadExpanded('reasoning', true);
      manager.setWorkloadExpanded('reasoning', false);

      expect(manager.isWorkloadExpanded('reasoning')).toBe(false);
    });

    it('returns expanded workloads list', () => {
      manager.setWorkloadExpanded('reasoning', true);
      manager.setWorkloadExpanded('coding', true);

      const expanded = manager.getExpandedWorkloads();

      expect(expanded).toContain('reasoning');
      expect(expanded).toContain('coding');
      expect(expanded).toHaveLength(2);
    });
  });

  describe('rename operations', () => {
    it('updates provider name in expanded state', () => {
      manager.setProviderExpanded('openai', true);

      manager.renameProvider('openai', 'openai-new');

      expect(manager.isProviderExpanded('openai')).toBe(false);
      expect(manager.isProviderExpanded('openai-new')).toBe(true);
    });

    it('does not add to expanded if not previously expanded', () => {
      manager.renameProvider('openai', 'openai-new');

      expect(manager.isProviderExpanded('openai-new')).toBe(false);
    });

    it('updates workload name in expanded state', () => {
      manager.setWorkloadExpanded('reasoning', true);

      manager.renameWorkload('reasoning', 'reasoning-v2');

      expect(manager.isWorkloadExpanded('reasoning')).toBe(false);
      expect(manager.isWorkloadExpanded('reasoning-v2')).toBe(true);
    });

    it('does not add workload to expanded if not previously expanded', () => {
      manager.renameWorkload('reasoning', 'reasoning-v2');

      expect(manager.isWorkloadExpanded('reasoning-v2')).toBe(false);
    });
  });

  describe('delete operations', () => {
    it('removes provider from expanded state', () => {
      manager.setProviderExpanded('openai', true);
      manager.setProviderExpanded('anthropic', true);

      manager.deleteProvider('openai');

      expect(manager.isProviderExpanded('openai')).toBe(false);
      expect(manager.isProviderExpanded('anthropic')).toBe(true);
    });

    it('removes workload from expanded state', () => {
      manager.setWorkloadExpanded('reasoning', true);
      manager.setWorkloadExpanded('coding', true);

      manager.deleteWorkload('reasoning');

      expect(manager.isWorkloadExpanded('reasoning')).toBe(false);
      expect(manager.isWorkloadExpanded('coding')).toBe(true);
    });
  });

  describe('clear', () => {
    it('clears all expanded state', () => {
      manager.setProviderExpanded('openai', true);
      manager.setWorkloadExpanded('reasoning', true);

      manager.clear();

      expect(manager.getExpandedProviders()).toHaveLength(0);
      expect(manager.getExpandedWorkloads()).toHaveLength(0);
    });
  });
});

describe('ScrollPositionManager', () => {
  let manager: ScrollPositionManager;

  beforeEach(() => {
    manager = new ScrollPositionManager();
  });

  it('saves scroll position', () => {
    manager.save(500);

    expect(manager.get()).toBe(500);
  });

  it('does not overwrite with 0 if already saved', () => {
    manager.save(500);
    manager.save(0);

    expect(manager.get()).toBe(500);
  });

  it('overwrites with 0 if not previously saved', () => {
    manager.save(0);

    expect(manager.get()).toBe(0);
  });

  it('updates with new positive value', () => {
    manager.save(500);
    manager.save(750);

    expect(manager.get()).toBe(750);
  });

  it('resets scroll position', () => {
    manager.save(500);
    manager.reset();

    expect(manager.get()).toBe(0);
  });
});

describe('updateConfigAtPath', () => {
  it('updates nested value', () => {
    const config = {
      providers: {
        openai: {
          api_key: 'old-key',
        },
      },
    };

    const result = updateConfigAtPath(config, ['providers', 'openai', 'api_key'], 'new-key');

    expect(result.providers).toBeDefined();
    expect((result.providers as Record<string, unknown>).openai).toBeDefined();
    expect(((result.providers as Record<string, unknown>).openai as Record<string, unknown>).api_key).toBe('new-key');
  });

  it('creates nested structure if not exists', () => {
    const config = {};

    const result = updateConfigAtPath(config, ['providers', 'openai', 'api_key'], 'new-key');

    expect(((result.providers as Record<string, unknown>).openai as Record<string, unknown>).api_key).toBe('new-key');
  });

  it('does not mutate original config', () => {
    const config = {
      providers: {
        openai: {api_key: 'old-key'},
      },
    };

    updateConfigAtPath(config, ['providers', 'openai', 'api_key'], 'new-key');

    expect((config.providers.openai as Record<string, unknown>).api_key).toBe('old-key');
  });

  it('returns original config for empty path', () => {
    const config = {test: 'value'};

    const result = updateConfigAtPath(config, [], 'ignored');

    expect(result).toEqual(config);
  });
});

describe('getConfigAtPath', () => {
  it('gets nested value', () => {
    const config = {
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
    };

    const result = getConfigAtPath(config, ['providers', 'openai', 'api_key']);

    expect(result).toBe('test-key');
  });

  it('returns undefined for non-existent path', () => {
    const config = {providers: {}};

    const result = getConfigAtPath(config, ['providers', 'openai', 'api_key']);

    expect(result).toBeUndefined();
  });

  it('returns undefined when path traverses non-object', () => {
    const config = {providers: 'not-an-object'};

    const result = getConfigAtPath(config, ['providers', 'openai']);

    expect(result).toBeUndefined();
  });
});

describe('isValueInCatalog', () => {
  const catalog = {
    openai: {
      chat: ['gpt-4', 'gpt-4-turbo'],
      embeddings: ['text-embedding-3-small'],
    },
  };

  it('returns true when value is in catalog', () => {
    expect(isValueInCatalog('gpt-4', catalog, 'openai')).toBe(true);
    expect(isValueInCatalog('text-embedding-3-small', catalog, 'openai')).toBe(true);
  });

  it('returns false when value is not in catalog', () => {
    expect(isValueInCatalog('custom-model', catalog, 'openai')).toBe(false);
  });

  it('returns false for unknown provider type', () => {
    expect(isValueInCatalog('gpt-4', catalog, 'anthropic')).toBe(false);
  });

  it('returns false for empty value', () => {
    expect(isValueInCatalog('', catalog, 'openai')).toBe(false);
  });
});

describe('getModelsFromCatalog', () => {
  const catalog = {
    openai: {
      chat: ['gpt-4', 'gpt-4-turbo'],
      embeddings: ['text-embedding-3-small'],
    },
  };

  it('returns models for provider type and category', () => {
    expect(getModelsFromCatalog(catalog, 'openai', 'chat')).toEqual(['gpt-4', 'gpt-4-turbo']);
    expect(getModelsFromCatalog(catalog, 'openai', 'embeddings')).toEqual(['text-embedding-3-small']);
  });

  it('defaults to chat category', () => {
    expect(getModelsFromCatalog(catalog, 'openai')).toEqual(['gpt-4', 'gpt-4-turbo']);
  });

  it('returns empty array for unknown provider', () => {
    expect(getModelsFromCatalog(catalog, 'anthropic')).toEqual([]);
  });

  it('returns empty array for unknown category', () => {
    expect(getModelsFromCatalog(catalog, 'openai', 'unknown')).toEqual([]);
  });
});

describe('validateProviderName', () => {
  const existingProviders = {openai: {}, anthropic: {}};

  it('returns valid for new unique name', () => {
    const result = validateProviderName('azure', existingProviders);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns invalid for empty name', () => {
    const result = validateProviderName('', existingProviders);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Provider name cannot be empty');
  });

  it('returns invalid for whitespace-only name', () => {
    const result = validateProviderName('   ', existingProviders);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Provider name cannot be empty');
  });

  it('returns invalid for duplicate name', () => {
    const result = validateProviderName('openai', existingProviders);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Provider with this name already exists!');
  });

  it('trims whitespace before validation', () => {
    const result = validateProviderName('  openai  ', existingProviders);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Provider with this name already exists!');
  });
});

describe('validateWorkloadName', () => {
  const existingWorkloads = {reasoning: {}, coding: {}};

  it('returns valid for new unique name', () => {
    const result = validateWorkloadName('embeddings', existingWorkloads);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns invalid for empty name', () => {
    const result = validateWorkloadName('', existingWorkloads);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Workload name cannot be empty');
  });

  it('returns invalid for duplicate name', () => {
    const result = validateWorkloadName('reasoning', existingWorkloads);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Workload with this name already exists!');
  });
});

describe('createProviderDeletionPayload', () => {
  it('creates correct deletion payload', () => {
    const result = createProviderDeletionPayload('openai');

    expect(result).toEqual({
      providers: {
        openai: null,
      },
    });
  });
});

describe('createWorkloadDeletionPayload', () => {
  it('creates correct deletion payload', () => {
    const result = createWorkloadDeletionPayload('reasoning');

    expect(result).toEqual({
      workloads: {
        reasoning: null,
      },
    });
  });
});

describe('parseFieldValue', () => {
  it('parses checkbox value', () => {
    expect(parseFieldValue('', 'checkbox', true)).toBe(true);
    expect(parseFieldValue('', 'checkbox', false)).toBe(false);
    expect(parseFieldValue('', 'checkbox')).toBe(false);
  });

  it('parses number value', () => {
    expect(parseFieldValue('42', 'number')).toBe(42);
    expect(parseFieldValue('3.14', 'number')).toBe(3.14);
    expect(parseFieldValue('invalid', 'number')).toBe(0);
  });

  it('parses JSON value', () => {
    expect(parseFieldValue('{"key": "value"}', 'json')).toEqual({key: 'value'});
    expect(parseFieldValue('[1, 2, 3]', 'json')).toEqual([1, 2, 3]);
    expect(parseFieldValue('invalid json', 'json')).toBe('invalid json');
  });

  it('parses text value', () => {
    expect(parseFieldValue('hello', 'text')).toBe('hello');
    expect(parseFieldValue('', 'text')).toBeNull();
    expect(parseFieldValue('null', 'text')).toBeNull();
  });
});
