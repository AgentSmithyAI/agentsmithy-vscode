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
      
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
        json: async () => mockResponse,
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
  });
});
