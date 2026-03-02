import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CcrConfig, ConfigSource } from '../types/config';

export class ConfigManager implements vscode.Disposable {
  private _config: CcrConfig | null = null;
  private _activeSource: ConfigSource | null = null;
  private _watcher: fs.FSWatcher | null = null;
  private readonly _onDidChangeConfig = new vscode.EventEmitter<CcrConfig>();
  readonly onDidChangeConfig = this._onDidChangeConfig.event;

  get config(): CcrConfig | null {
    return this._config;
  }

  get activeSource(): ConfigSource | null {
    return this._activeSource;
  }

  getGlobalConfigPath(): string {
    const configured = vscode.workspace.getConfiguration('ccr-monitor').get<string>('globalConfigPath');
    if (configured) {
      return configured.replace(/^~/, os.homedir());
    }
    return path.join(os.homedir(), '.claude-code-router', 'config.json');
  }

  getProjectConfigPath(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }
    return path.join(workspaceFolders[0].uri.fsPath, '.claude-code-router', 'config.json');
  }

  getAvailableSources(): ConfigSource[] {
    const sources: ConfigSource[] = [];
    const globalPath = this.getGlobalConfigPath();
    if (fs.existsSync(globalPath)) {
      sources.push({ type: 'global', path: globalPath });
    }
    const projectPath = this.getProjectConfigPath();
    if (projectPath && fs.existsSync(projectPath)) {
      sources.push({ type: 'project', path: projectPath });
    }
    return sources;
  }

  load(source?: ConfigSource): CcrConfig | null {
    if (source) {
      this._activeSource = source;
    } else {
      const sources = this.getAvailableSources();
      const projectSource = sources.find(s => s.type === 'project');
      this._activeSource = projectSource || sources[0] || null;
    }

    if (!this._activeSource) {
      this._config = null;
      return null;
    }

    try {
      const raw = fs.readFileSync(this._activeSource.path, 'utf-8');
      this._config = JSON.parse(raw) as CcrConfig;
      this._setupWatcher();
      this._onDidChangeConfig.fire(this._config);
      return this._config;
    } catch (err) {
      console.error('Failed to load CCR config:', err);
      this._config = null;
      return null;
    }
  }

  save(config: CcrConfig): boolean {
    if (!this._activeSource) {
      return false;
    }
    try {
      const dir = path.dirname(this._activeSource.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._activeSource.path, JSON.stringify(config, null, 2), 'utf-8');
      this._config = config;
      this._onDidChangeConfig.fire(config);
      return true;
    } catch (err) {
      console.error('Failed to save CCR config:', err);
      return false;
    }
  }

  resolveEnvVars(value: string): string {
    return value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name) => {
      return process.env[name] || '';
    });
  }

  getResolvedApiKey(provider: { api_key?: string; api_keys?: string[] }): string[] {
    const keys: string[] = [];
    if (provider.api_key) {
      keys.push(this.resolveEnvVars(provider.api_key));
    }
    if (provider.api_keys) {
      for (const k of provider.api_keys) {
        keys.push(this.resolveEnvVars(k));
      }
    }
    return keys;
  }

  private _setupWatcher(): void {
    this._disposeWatcher();
    if (!this._activeSource) { return; }
    try {
      this._watcher = fs.watch(this._activeSource.path, (eventType) => {
        if (eventType === 'change') {
          setTimeout(() => this.load(this._activeSource!), 200);
        }
      });
    } catch {
      // File may not exist yet
    }
  }

  private _disposeWatcher(): void {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  dispose(): void {
    this._disposeWatcher();
    this._onDidChangeConfig.dispose();
  }
}
