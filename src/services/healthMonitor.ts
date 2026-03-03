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
  private _outputChannel: vscode.OutputChannel | null = null;

  private get outputChannel(): vscode.OutputChannel {
    if (!this._outputChannel) {
      this._outputChannel = vscode.window.createOutputChannel('CCR Monitor Health');
    }
    return this._outputChannel;
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  constructor(private readonly configManager: ConfigManager) {}

  get healthMap(): ReadonlyMap<string, ProviderHealth> {
    return this._healthMap;
  }

  getOverallHealth(): OverallHealth {
    const config = this.configManager.config;
    if (!config || !config.Router || !config.Router.default) {
      this.log('[DEBUG] No default config, using _calculateFromHealthMap');
      return this._calculateFromHealthMap();
    }

    const defaultValue = config.Router.default;
    const parts = defaultValue.split(',');
    const defaultProvider = parts[0];
    const defaultModel = parts.length > 1 ? parts.slice(1).join(',') : undefined;

    this.log(`[DEBUG] getOverallHealth: default=${defaultValue}, provider=${defaultProvider}, model=${defaultModel}`);
    return this._calculateWithDefault(defaultProvider, defaultModel);
  }

  private _calculateFromHealthMap(): OverallHealth {
    if (this._healthMap.size === 0) { return 'checking'; }
    const statuses = [...this._healthMap.values()].map(h => h.status);
    if (statuses.every(s => s === 'checking')) { return 'checking'; }
    if (statuses.every(s => s === 'healthy')) { return 'all-healthy'; }
    if (statuses.every(s => s === 'unhealthy')) { return 'all-down'; }
    return 'partial';
  }

  private _calculateWithDefault(defaultProvider: string, defaultModel?: string): OverallHealth {
    const defaultHealth = this._healthMap.get(defaultProvider);

    this.log(`[DEBUG] _calculateWithDefault: provider=${defaultProvider}, model=${defaultModel}`);
    this.log(`[DEBUG] Default provider health: ${defaultHealth ? defaultHealth.status : 'not found'}`);
    this.log(`[DEBUG] Available models: ${defaultHealth?.availableModels?.join(', ') || 'none'}`);

    if (!defaultHealth || defaultHealth.status !== 'healthy') {
      // Default provider unavailable, check if any other providers are healthy
      const healthyCount = [...this._healthMap.values()].filter(h => h.status === 'healthy').length;
      this.log(`[DEBUG] Default provider unhealthy, healthy count=${healthyCount}`);
      return healthyCount > 0 ? 'default-unavailable' : 'all-down';
    }

    // Default provider is healthy, check if model exists
    if (defaultModel && defaultHealth.availableModels.length > 0) {
      // Check if the model exists in available models (handle both full names and simple names)
      const modelExists = defaultHealth.availableModels.some((m) => {
        // Match either exact ID or the last part after / or ,
        return m === defaultModel ||
               m.endsWith(`/${defaultModel}`) ||
               m.endsWith(`,${defaultModel}`) ||
               m.split('/').pop() === defaultModel ||
               m.split(',').pop() === defaultModel;
      });

      this.log(`[DEBUG] Model exists check: ${modelExists}`);

      if (!modelExists) {
        // Default model not available in this provider
        const healthyCount = [...this._healthMap.values()].filter(h => h.status === 'healthy').length;
        this.log(`[DEBUG] Model not available, healthy count=${healthyCount}`);
        return healthyCount > 0 ? 'default-unavailable' : 'all-down';
      }
    }

    this.log(`[DEBUG] Returning all-healthy`);
    return 'all-healthy';
  }

  start(): void {
    this.checkAll();
    const intervalSec = vscode.workspace.getConfiguration('ccr-monitor').get<number>('healthCheckInterval') ?? 60;
    this._timer = setInterval(() => this.checkAll(), intervalSec * 1000);
  }

  showLog(): void {
    this.outputChannel.show();
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
      availableModels: [],
    };
    this._healthMap.set(provider.name, entry);

    const timeoutMs = vscode.workspace.getConfiguration('ccr-monitor').get<number>('healthCheckTimeout') ?? 5000;

    try {
      const modelsUrl = this._buildModelsUrl(provider.api_base_url);
      this.log(`Checking provider "${provider.name}": ${modelsUrl}`);
      const apiKey = this._getFirstResolvedKey(provider);
      const start = Date.now();
      const result = await this._httpGet(modelsUrl, apiKey, timeoutMs);
      const latency = Date.now() - start;

      entry.status = 'healthy';
      entry.latencyMs = latency;
      entry.error = null;
      entry.availableModels = result.models;
      this.log(`  -> SUCCESS (${latency}ms, ${result.models.length} models)`);
    } catch (err: unknown) {
      entry.status = 'unhealthy';
      entry.latencyMs = null;
      entry.error = err instanceof Error ? err.message : String(err);
      entry.availableModels = [];
      this.log(`  -> FAILED: ${entry.error}`);
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

  private _shouldBypassProxy(hostname: string): boolean {
    // Get NO_PROXY from VS Code settings (http.noProxy), then environment
    const noProxySetting = vscode.workspace.getConfiguration('http').get<string | string[]>('noProxy');
    let noProxy = '';
    if (typeof noProxySetting === 'string') {
      noProxy = noProxySetting;
    } else if (Array.isArray(noProxySetting)) {
      noProxy = noProxySetting.join(',');
    }
    noProxy = noProxy || process.env.NO_PROXY || process.env.no_proxy || '';

    if (!noProxy) { return false; }

    const noProxyList = noProxy.split(',').map(s => s.trim());
    const targetHostname = hostname.toLowerCase();

    for (const pattern of noProxyList) {
      if (pattern === '*') { return true; }

      // Remove leading dots for comparison
      const cleanPattern = pattern.replace(/^\.+/, '').toLowerCase();
      const cleanTarget = targetHostname.replace(/^\.+/, '');

      // Exact match or suffix match
      if (cleanTarget === cleanPattern || cleanTarget.endsWith('.' + cleanPattern)) {
        return true;
      }

      // Wildcard match for patterns like "10.*" or "172.18.*"
      if (cleanPattern.includes('*')) {
        const regexPattern = cleanPattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*');
        try {
          const regex = new RegExp(`^${regexPattern}$`);
          if (regex.test(cleanTarget)) {
            return true;
          }
        } catch {
          // Invalid regex, ignore
        }
      }

      // CIDR notation for IP ranges (e.g., "192.168.0.0/16")
      if (cleanPattern.includes('/')) {
        try {
          if (this._ipMatchesCidr(hostname, cleanPattern)) {
            return true;
          }
        } catch {
          // Ignore invalid CIDR
        }
      }
    }
    return false;
  }

  private _ipMatchesCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const mask = parseInt(bits, 10);
    if (isNaN(mask) || mask < 0 || mask > 32) { return false; }
    const ipParts = ip.split('.').map(Number);
    const rangeParts = range.split('.').map(Number);
    if (ipParts.length !== 4 || rangeParts.some(isNaN)) { return false; }
    const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeInt = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
    const maskInt = ~((1 << (32 - mask)) - 1) >>> 0;
    return ((ipInt & maskInt) === (rangeInt & maskInt));
  }

  private _httpGet(url: string, apiKey: string | null, timeoutMs: number): Promise<{ status: number; models: string[] }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Get proxy from VS Code settings, then environment
      const proxySetting = vscode.workspace.getConfiguration('http').get<string>('proxy');
      const proxyUrl = proxySetting ||
                       process.env.HTTP_PROXY || process.env.http_proxy ||
                       process.env.HTTPS_PROXY || process.env.https_proxy || '';

      // Check if we should bypass proxy for this host
      const bypassProxy = this._shouldBypassProxy(parsed.hostname);

      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers,
        timeout: timeoutMs,
      };

      // If proxy is set and not bypassing, use it via HTTP CONNECT tunnel
      let usingProxy = false;
      if (proxyUrl && !bypassProxy) {
        this.log(`  Using proxy: ${proxyUrl}`);
        // Ensure proxy URL has protocol prefix
        let proxyUrlWithProtocol = proxyUrl;
        if (!proxyUrlWithProtocol.startsWith('http://') && !proxyUrlWithProtocol.startsWith('https://')) {
          proxyUrlWithProtocol = 'http://' + proxyUrlWithProtocol;
        }
        try {
          const proxyParsed = new URL(proxyUrlWithProtocol);
          usingProxy = true;
          options.host = proxyParsed.hostname;
          options.port = proxyParsed.port || 80;
          options.path = `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? 443 : 80)}${parsed.pathname}${parsed.search}`;
          if (apiKey) {
            headers['Proxy-Authorization'] = `Basic ${Buffer.from('').toString('base64')}`;
          }
        } catch (err) {
          this.log(`  Failed to parse proxy URL: ${err}`);
        }
      } else if (bypassProxy) {
        this.log(`  Bypassing proxy for: ${parsed.hostname}`);
      }

      const req = mod.get(options, (res) => {
        // Handle proxy CONNECT response (407)
        if (usingProxy && res.statusCode === 407) {
          this.log(`  Proxy requires authentication (HTTP 407)`);
          reject(new Error('HTTP 407 Proxy Authentication Required'));
          return;
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            // Parse models from response
            let models: string[] = [];
            try {
              const parsed = JSON.parse(data);
              if (parsed.data && Array.isArray(parsed.data)) {
                models = parsed.data.map((m: { id: string }) => m.id);
              }
            } catch {
              // If parsing fails, return empty array
            }
            resolve({ status: res.statusCode, models });
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

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
    if (this._outputChannel) {
      this._outputChannel.dispose();
      this._outputChannel = null;
    }
  }
}
