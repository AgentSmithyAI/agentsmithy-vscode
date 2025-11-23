export interface WorkloadConfig {
  provider?: string;
  model?: string;
  purpose?: string;
  name?: string; // From metadata
  [key: string]: unknown;
}

export interface AgentModelConfig {
  workload?: string;
  [key: string]: unknown;
}

export interface AgentsConfig {
  reasoning?: AgentModelConfig;
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

export interface ConfigMetadata {
  workloads?: WorkloadConfig[];
  providers?: ProviderMetadata[];
  model_catalog?: Record<string, ModelCatalog>;
  [key: string]: unknown;
}
