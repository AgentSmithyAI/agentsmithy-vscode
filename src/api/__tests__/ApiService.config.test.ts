import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ApiService} from '../ApiService';

/**
 * Tests for configuration API methods
 */
describe('ApiService - Configuration', () => {
  let apiService: ApiService;
  const baseUrl = 'http://localhost:8765';

  beforeEach(() => {
    apiService = new ApiService(baseUrl);
    global.fetch = vi.fn();
  });

  describe('getConfig', () => {
    it('parses config and metadata correctly', async () => {
      const mockResponse = {
        config: {
          providers: {
            openai: {
              type: 'openai',
              api_key: null,
              base_url: null,
              options: {},
            },
          },
          workloads: {
            reasoning: {provider: 'openai', model: 'gpt-5', options: {}},
          },
          models: {
            agents: {
              universal: {workload: 'reasoning'},
            },
          },
        },
        metadata: {
          provider_types: ['openai', 'anthropic'],
          providers: [{name: 'openai', type: 'openai', has_api_key: false, model: null}],
          workloads: [{name: 'reasoning', provider: 'openai', model: 'gpt-5'}],
          agent_provider_slots: [{path: 'models.agents.universal.workload', workload: 'reasoning'}],
          model_catalog: {
            openai: {
              chat: ['gpt-4.1', 'gpt-5', 'gpt-5-mini'],
              embeddings: ['text-embedding-3-large', 'text-embedding-3-small'],
            },
          },
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.getConfig();

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/config`, {
        headers: {Accept: 'application/json'},
      });

      // Verify config
      expect(result.config).toBeDefined();
      expect(result.config.providers).toBeDefined();
      expect((result.config.providers as any).openai).toBeDefined();

      // Verify metadata
      expect(result.metadata).toBeDefined();
      expect(result.metadata).not.toBeNull();
      expect((result.metadata as any).provider_types).toEqual(['openai', 'anthropic']);
      expect((result.metadata as any).model_catalog).toBeDefined();
      expect((result.metadata as any).model_catalog.openai).toBeDefined();
      expect((result.metadata as any).model_catalog.openai.chat).toEqual(['gpt-4.1', 'gpt-5', 'gpt-5-mini']);
    });

    it('returns empty config when config field is missing', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await apiService.getConfig();

      expect(result.config).toEqual({});
      expect(result.metadata).toBeNull();
    });

    it('throws on HTTP error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(apiService.getConfig()).rejects.toThrow('HTTP error! status: 500');
    });

    it('throws on malformed response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => 'invalid',
      });

      await expect(apiService.getConfig()).rejects.toThrow('Malformed config response');
    });
  });

  describe('getHealth', () => {
    it('parses health response correctly', async () => {
      const mockResponse = {
        server_status: 'ready',
        port: 8765,
        config_valid: false,
        config_errors: ['API key not configured'],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.getHealth();

      expect(result.server_status).toBe('ready');
      expect(result.port).toBe(8765);
      expect(result.config_valid).toBe(false);
      expect(result.config_errors).toEqual(['API key not configured']);
    });

    it('filters non-string errors and logs warning', async () => {
      const mockResponse = {
        server_status: 'ready',
        port: 8000,
        config_valid: false,
        config_errors: ['ok', {unexpected: true}],
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // No-op for tests
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiService.getHealth();

      // Non-string errors should be filtered out
      expect(result.config_errors).toEqual(['ok']);
      // Should warn about malformed data
      expect(warnSpy).toHaveBeenCalledWith('[ApiService] health response contained non-string config_errors entries');

      warnSpy.mockRestore();
    });
  });

  describe('updateConfig', () => {
    it('sends config update and returns result', async () => {
      const configUpdate = {
        providers: {
          openai: {api_key: 'sk-test'},
        },
      };

      const mockResponse = {
        success: true,
        message: 'Successfully updated 1 configuration key(s)',
        config: configUpdate,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await apiService.updateConfig(configUpdate);

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({config: configUpdate}),
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully updated 1 configuration key(s)');
    });

    it('throws ApiError with structured errors on validation failure', async () => {
      const {ApiError} = await import('../ApiService');

      const configUpdate = {
        providers: {
          ollama: null,
        },
      };

      const errorResponse = {
        detail: {
          message: 'Invalid configuration',
          errors: ["Workload 'reasoning' references unknown provider 'ollama'"],
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorResponse),
      });

      await expect(apiService.updateConfig(configUpdate)).rejects.toThrow(ApiError);

      try {
        await apiService.updateConfig(configUpdate);
      } catch (e) {
        // Re-mock for second call
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(errorResponse),
        });
      }
    });
  });

  describe('renameConfig', () => {
    it('renames workload and returns updated config', async () => {
      const mockResponse = {
        success: true,
        message: "Successfully renamed workload 'reasoning' to 'main-model'",
        old_name: 'reasoning',
        new_name: 'main-model',
        updated_references: ['models.agents.universal.workload'],
        config: {
          workloads: {
            'main-model': {provider: 'openai', model: 'gpt-5'},
          },
        },
        metadata: {
          workloads: [{name: 'main-model', provider: 'openai', model: 'gpt-5'}],
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await apiService.renameConfig('workload', 'reasoning', 'main-model');

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/config/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          type: 'workload',
          old_name: 'reasoning',
          new_name: 'main-model',
        }),
      });

      expect(result.success).toBe(true);
      expect(result.old_name).toBe('reasoning');
      expect(result.new_name).toBe('main-model');
      expect(result.updated_references).toEqual(['models.agents.universal.workload']);
    });

    it('renames provider and returns updated config', async () => {
      const mockResponse = {
        success: true,
        message: "Successfully renamed provider 'openai' to 'my-openai'",
        old_name: 'openai',
        new_name: 'my-openai',
        updated_references: ['workloads.reasoning.provider'],
        config: {
          providers: {
            'my-openai': {type: 'openai', api_key: 'sk-test'},
          },
        },
        metadata: null,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await apiService.renameConfig('provider', 'openai', 'my-openai');

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/config/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          type: 'provider',
          old_name: 'openai',
          new_name: 'my-openai',
        }),
      });

      expect(result.success).toBe(true);
      expect(result.old_name).toBe('openai');
      expect(result.new_name).toBe('my-openai');
      expect(result.metadata).toBeNull();
    });

    it('throws ApiError when entity not found', async () => {
      const {ApiError} = await import('../ApiService');

      const errorResponse = {
        detail: {
          message: "Workload 'unknown' not found",
          errors: [],
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorResponse),
      });

      await expect(apiService.renameConfig('workload', 'unknown', 'new-name')).rejects.toThrow(ApiError);
    });

    it('throws ApiError when new name already exists', async () => {
      const {ApiError} = await import('../ApiService');

      const errorResponse = {
        detail: {
          message: "Workload 'existing' already exists",
          errors: [],
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorResponse),
      });

      await expect(apiService.renameConfig('workload', 'old-name', 'existing')).rejects.toThrow(ApiError);
    });

    it('handles response with missing optional fields', async () => {
      const mockResponse = {
        success: true,
        message: 'Renamed',
        config: {},
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await apiService.renameConfig('workload', 'old', 'new');

      expect(result.success).toBe(true);
      expect(result.old_name).toBe('old'); // Falls back to input
      expect(result.new_name).toBe('new'); // Falls back to input
      expect(result.updated_references).toEqual([]);
      expect(result.metadata).toBeNull();
    });

    it('filters non-string updated_references', async () => {
      const mockResponse = {
        success: true,
        message: 'Renamed',
        old_name: 'old',
        new_name: 'new',
        updated_references: ['valid.path', 123, null, 'another.path'],
        config: {},
        metadata: null,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await apiService.renameConfig('workload', 'old', 'new');

      expect(result.updated_references).toEqual(['valid.path', 'another.path']);
    });
  });
});
