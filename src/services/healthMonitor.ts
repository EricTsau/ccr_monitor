import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { CcrProvider, ProviderHealth, HealthStatus, OverallHealth } from '../types/config';
import { ConfigManager } from './configManager';

export class HealthMonitor implements vscode.Disposable {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _healthMap: Map<string, ProviderHealth> = new Map();
  private readonly _onDidUpdateHealth = new vscode.EventEmitter<Map<string, ProviderHealth>>();
  readonly onDidUpdateHealth = this._onDidUpdateHealth.event;

  constructor(private readonly configManager: ConfigManager) {}

  get healthMap(): ReadonlyMap<string, ProviderHealth> {
    return this._healthMap;
  }

  getOverallHealth(): OverallHealth {
    if (this._healthMap.size === 0) { return 'checking'; }
    const statuses = [...this._healthMap.values()].map(h => h.status);
    if (statuses.every(s => s === 'checking')) { return 'checking'; }
    if (statuses.every(s => s === 'healthy')) { return 'all-healthy'; }
    if (statuses.every(s => s === 'unhealthy')) { return 'all-down'; }
    return 'partial';
  }

  start(): void {
    this.checkAll();
    const intervalSec = vscode.workspace.getConfiguration('ccr-monitor').get<number>('healthCheckInterval') ?? 60;
    this._timer = setInterval(() => this.checkAll(), intervalSec * 1000);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async checkAll(): Promise<void> {
    const config = this.configManager.config;
    if (!config || !config.Providers) { return; }

    const promises = config.Providers.map(provider => this._checkProvider(provider));
    await Promise.allSettled(promises);
    this._onDidUpdateHealth.fire(this._healthMap);
  }

  private async _checkProvider(provider: CcrProvider): Promise<void> {
    const entry: ProviderHealth = {
      providerName: provider.name,
      status: 'checking',
      latencyMs: null,
      error: null,
      modelCount: provider.models.length,
      lastChecked: Date.now(),
    };
    this._healthMap.set(provider.name, entry);

    const timeoutMs = vscode.workspace.getConfiguration('ccr-monitor').get<number>('healthCheckTimeout') ?? 5000;

    try {
      const modelsUrl = this._buildModelsUrl(provider.api_base_url);
      const apiKey = this._getFirstResolvedKey(provider);
      const start = Date.now();
      await this._httpGet(modelsUrl, apiKey, timeoutMs);
      const latency = Date.now() - start;

      entry.status = 'healthy';
      entry.latencyMs = latency;
      entry.error = null;
    } catch (err: unknown) {
      entry.status = 'unhealthy';
      entry.latencyMs = null;
      entry.error = err instanceof Error ? err.message : String(err);
    }

    entry.lastChecked = Date.now();
    this._healthMap.set(provider.name, entry);
  }

  private _buildModelsUrl(apiBaseUrl: string): string {
    let base = apiBaseUrl.replace(/\/+$/, '');
    base = base.replace(/\/chat\/completions\/?$/, '');
    if (!base.endsWith('/models')) {
      base += '/models';
    }
    return base;
  }

  private _getFirstResolvedKey(provider: CcrProvider): string | null {
    const keys = this.configManager.getResolvedApiKey(provider);
    return keys.length > 0 ? keys[0] : null;
  }

  private _httpGet(url: string, apiKey: string | null, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = mod.get(
        {
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: parsed.pathname + parsed.search,
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
              resolve(res.statusCode);
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        },
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.on('error', (err) => reject(err));
    });
  }

  dispose(): void {
    this.stop();
    this._onDidUpdateHealth.dispose();
  }
}
