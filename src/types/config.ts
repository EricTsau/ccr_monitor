export interface CcrProvider {
  name: string;
  api_base_url: string;
  api_key?: string;
  api_keys?: string[];
  enable_rotation?: boolean;
  rotation_strategy?: 'round-robin' | 'random';
  retry_on_failure?: boolean;
  max_retries?: number;
  models: string[];
  transformer?: {
    use: (string | [string, Record<string, unknown>])[];
  };
}

export interface CcrRouter {
  default?: string;
  background?: string;
  think?: string;
  longContext?: string;
  longContextThreshold?: number;
  webSearch?: string;
  image?: string;
}

export interface CcrConfig {
  APIKEY?: string;
  PROXY_URL?: string;
  HOST?: string;
  LOG?: boolean;
  LOG_LEVEL?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  NON_INTERACTIVE_MODE?: boolean;
  API_TIMEOUT_MS?: number;
  Providers: CcrProvider[];
  Router: CcrRouter;
  transformers?: unknown[];
}

export type HealthStatus = 'healthy' | 'unhealthy' | 'checking' | 'unknown';

export interface ProviderHealth {
  providerName: string;
  status: HealthStatus;
  latencyMs: number | null;
  error: string | null;
  modelCount: number;
  lastChecked: number;
}

export type OverallHealth = 'all-healthy' | 'partial' | 'all-down' | 'checking';

export interface ConfigSource {
  type: 'global' | 'project';
  path: string;
}
