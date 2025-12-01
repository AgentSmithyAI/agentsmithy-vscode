export interface WorkloadConfig {
  provider?: string;
  model?: string;
  kind?: string; // "chat" or "embeddings"
  purpose?: string;
  name?: string; // From metadata
  [key: string]: unknown;
}

export interface AgentModelConfig {
  workload?: string;
  [key: string]: unknown;
}

export interface AgentsConfig {
  universal?: AgentModelConfig;
  inspector?: AgentModelConfig;
  reasoning?: AgentModelConfig; // Legacy
  [key: string]: unknown;
}

export interface ModelsConfig {
  agents?: AgentsConfig;
  [key: string]: unknown;
}

export interface AppConfig {
  workloads?: Record<string, WorkloadConfig>;
  models?: ModelsConfig;
  [key: string]: unknown;
}

export interface ProviderMetadata {
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface ModelCatalog {
  chat?: string[];
  embeddings?: string[];
  [key: string]: unknown;
}

export interface WorkloadMetadata {
  name: string;
  provider: string;
  model: string;
  kind: string; // "chat" or "embeddings"
}

export interface ConfigMetadata {
  workloads?: WorkloadMetadata[];
  workload_kinds?: string[];
  providers?: ProviderMetadata[];
  model_catalog?: Record<string, ModelCatalog>;
  [key: string]: unknown;
}
