# CCR Monitor VS Code Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VS Code extension that monitors Claude Code Router provider health, displays current config, and provides a Webview editor to edit and apply config changes with CCR restart.

**Architecture:** Three services (HealthMonitor, ConfigManager, CcrProcess) feed data to a single Webview Panel and a Status Bar item. The Webview uses vanilla HTML/CSS/JS communicating with the extension host via postMessage. Config files are watched for external changes.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js native http/https, Webview postMessage API, VS Code CSS Variables for theming.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.vscodeignore`
- Create: `.gitignore`
- Create: `src/extension.ts` (stub)

**Step 1: Initialize git repo**

```bash
cd /home/eric/projects/ccr_monitor
git init
```

**Step 2: Create package.json**

Create `package.json`:

```json
{
  "name": "ccr-monitor",
  "displayName": "CCR Monitor",
  "description": "Monitor Claude Code Router provider health, view/edit config, and manage CCR process",
  "version": "0.1.0",
  "publisher": "ccr-monitor",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "ccr-monitor.openDashboard",
        "title": "CCR Monitor: Open Dashboard"
      },
      {
        "command": "ccr-monitor.refreshHealth",
        "title": "CCR Monitor: Refresh Health Check"
      },
      {
        "command": "ccr-monitor.restartCcr",
        "title": "CCR Monitor: Restart CCR"
      }
    ],
    "configuration": {
      "title": "CCR Monitor",
      "properties": {
        "ccr-monitor.healthCheckInterval": {
          "type": "number",
          "default": 60,
          "description": "Health check interval in seconds"
        },
        "ccr-monitor.globalConfigPath": {
          "type": "string",
          "default": "~/.claude-code-router/config.json",
          "description": "Path to global CCR config.json"
        },
        "ccr-monitor.healthCheckTimeout": {
          "type": "number",
          "default": 5000,
          "description": "Health check request timeout in milliseconds"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src --ext ts",
    "test": "node ./out/test/runTest.js",
    "package": "npx @vscode/vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.0.0",
    "typescript": "^5.5.0"
  }
}
```

**Step 3: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

**Step 4: Create .vscodeignore**

Create `.vscodeignore`:

```
.vscode/**
.vscode-test/**
src/**
out/test/**
node_modules/**
.gitignore
tsconfig.json
docs/**
```

**Step 5: Create .gitignore**

Create `.gitignore`:

```
out/
node_modules/
*.vsix
.vscode-test/
```

**Step 6: Create stub extension.ts**

Create `src/extension.ts`:

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('CCR Monitor is now active');
}

export function deactivate() {}
```

**Step 7: Install dependencies and verify build**

```bash
cd /home/eric/projects/ccr_monitor
npm install
npm run compile
```

Expected: Compiles without errors, creates `out/extension.js`.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with package.json, tsconfig, extension stub"
```

---

## Task 2: TypeScript Types for CCR Config

**Files:**
- Create: `src/types/config.ts`

**Step 1: Create the CCR config type definitions**

Create `src/types/config.ts`:

```typescript
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
```

**Step 2: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/types/config.ts
git commit -m "feat: add TypeScript type definitions for CCR config"
```

---

## Task 3: Config Manager Service

**Files:**
- Create: `src/services/configManager.ts`

**Step 1: Create the Config Manager**

Create `src/services/configManager.ts`:

```typescript
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
```

**Step 2: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/services/configManager.ts
git commit -m "feat: add ConfigManager service for reading/writing CCR config"
```

---

## Task 4: Health Monitor Service

**Files:**
- Create: `src/services/healthMonitor.ts`

**Step 1: Create the Health Monitor**

Create `src/services/healthMonitor.ts`:

```typescript
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
    // If URL ends with /chat/completions, strip to base
    base = base.replace(/\/chat\/completions\/?$/, '');
    // Ensure it ends with /models
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
          // Drain response
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
```

**Step 2: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/services/healthMonitor.ts
git commit -m "feat: add HealthMonitor service with periodic provider health checks"
```

---

## Task 5: CCR Process Manager

**Files:**
- Create: `src/services/ccrProcess.ts`

**Step 1: Create the CCR Process Manager**

Create `src/services/ccrProcess.ts`:

```typescript
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CcrProcessManager implements vscode.Disposable {
  private _terminal: vscode.Terminal | null = null;

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('ps aux');
      return stdout.includes('claude-code-router');
    } catch {
      return false;
    }
  }

  async getPid(): Promise<number | null> {
    try {
      const { stdout } = await execAsync(
        "ps aux | grep 'claude-code-router' | grep -v grep | awk '{print $2}' | head -1"
      );
      const pid = parseInt(stdout.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  async kill(): Promise<boolean> {
    const pid = await this.getPid();
    if (!pid) { return false; }
    try {
      await execAsync(`kill ${pid}`);
      // Wait a moment for process to exit
      await new Promise(resolve => setTimeout(resolve, 1000));
      return true;
    } catch {
      return false;
    }
  }

  async restart(): Promise<void> {
    // Kill existing process
    const wasRunning = await this.isRunning();
    if (wasRunning) {
      await this.kill();
    }

    // Start in VS Code terminal
    if (this._terminal) {
      this._terminal.dispose();
    }
    this._terminal = vscode.window.createTerminal({
      name: 'CCR',
      hideFromUser: false,
    });
    this._terminal.sendText('npx claude-code-router');
    this._terminal.show(true);
  }

  dispose(): void {
    if (this._terminal) {
      this._terminal.dispose();
      this._terminal = null;
    }
  }
}
```

**Step 2: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/services/ccrProcess.ts
git commit -m "feat: add CcrProcessManager for detecting and restarting CCR"
```

---

## Task 6: Status Bar View

**Files:**
- Create: `src/views/statusBar.ts`

**Step 1: Create the Status Bar Manager**

Create `src/views/statusBar.ts`:

```typescript
import * as vscode from 'vscode';
import { OverallHealth } from '../types/config';

export class StatusBarManager implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;

  constructor() {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._item.command = 'ccr-monitor.openDashboard';
    this._item.tooltip = 'CCR Monitor - Click to open dashboard';
    this._update('checking');
    this._item.show();
  }

  update(health: OverallHealth): void {
    this._update(health);
  }

  private _update(health: OverallHealth): void {
    switch (health) {
      case 'all-healthy':
        this._item.text = '$(check) CCR';
        this._item.backgroundColor = undefined;
        this._item.color = new vscode.ThemeColor('statusBarItem.foreground');
        this._item.tooltip = 'CCR Monitor - All providers healthy';
        break;
      case 'partial':
        this._item.text = '$(warning) CCR';
        this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._item.color = undefined;
        this._item.tooltip = 'CCR Monitor - Some providers down';
        break;
      case 'all-down':
        this._item.text = '$(error) CCR';
        this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this._item.color = undefined;
        this._item.tooltip = 'CCR Monitor - All providers down!';
        break;
      case 'checking':
      default:
        this._item.text = '$(sync~spin) CCR';
        this._item.backgroundColor = undefined;
        this._item.color = undefined;
        this._item.tooltip = 'CCR Monitor - Checking...';
        break;
    }
  }

  dispose(): void {
    this._item.dispose();
  }
}
```

**Step 2: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/views/statusBar.ts
git commit -m "feat: add StatusBarManager with color-coded health indicator"
```

---

## Task 7: Webview Panel — Extension Host Side

**Files:**
- Create: `src/views/webviewPanel.ts`

**Step 1: Create the Webview Panel Manager**

This handles the Webview lifecycle and message routing between the extension and the Webview.

Create `src/views/webviewPanel.ts`:

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CcrConfig, ProviderHealth, ConfigSource } from '../types/config';

export type WebviewMessage =
  | { type: 'requestState' }
  | { type: 'saveProvider'; payload: { index: number; provider: unknown } }
  | { type: 'deleteProvider'; payload: { index: number } }
  | { type: 'addProvider'; payload: { provider: unknown } }
  | { type: 'saveRouter'; payload: { router: unknown } }
  | { type: 'saveGlobalSettings'; payload: { settings: unknown } }
  | { type: 'quickSwitch'; payload: { routeKey: string; providerModel: string } }
  | { type: 'restartCcr' }
  | { type: 'switchConfigSource'; payload: { sourceType: string } }
  | { type: 'refreshHealth' };

export interface WebviewState {
  config: CcrConfig | null;
  healthMap: Record<string, ProviderHealth>;
  activeSource: ConfigSource | null;
  availableSources: ConfigSource[];
  ccrRunning: boolean;
}

export class WebviewPanelManager implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | null = null;
  private readonly _disposables: vscode.Disposable[] = [];
  private _onDidReceiveMessage = new vscode.EventEmitter<WebviewMessage>();
  readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  get isVisible(): boolean {
    return this._panel !== null;
  }

  show(): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'ccrMonitor',
      'CCR Monitor',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'src', 'webview')],
      },
    );

    this._panel.webview.html = this._getHtmlContent(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this._onDidReceiveMessage.fire(msg),
      undefined,
      this._disposables,
    );

    this._panel.onDidDispose(() => {
      this._panel = null;
    }, undefined, this._disposables);
  }

  postState(state: WebviewState): void {
    if (this._panel) {
      this._panel.webview.postMessage({ type: 'updateState', payload: state });
    }
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css'),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'),
    );

    const nonce = this._getNonce();

    html = html.replace('{{cssUri}}', cssUri.toString());
    html = html.replace('{{jsUri}}', jsUri.toString());
    html = html.replace(/{{nonce}}/g, nonce);
    html = html.replace(
      '{{cspSource}}',
      webview.cspSource,
    );

    return html;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  dispose(): void {
    if (this._panel) {
      this._panel.dispose();
    }
    this._onDidReceiveMessage.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
```

**Step 2: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/views/webviewPanel.ts
git commit -m "feat: add WebviewPanelManager for dashboard lifecycle and messaging"
```

---

## Task 8: Webview HTML

**Files:**
- Create: `src/webview/index.html`

**Step 1: Create the Webview HTML shell**

Create `src/webview/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src {{cspSource}} 'nonce-{{nonce}}'; script-src 'nonce-{{nonce}}';">
  <link rel="stylesheet" href="{{cssUri}}">
  <title>CCR Monitor</title>
</head>
<body>
  <div id="app">
    <!-- Header -->
    <header id="header">
      <h1>CCR Monitor</h1>
      <div id="config-source-switcher">
        <label for="config-source">Config:</label>
        <select id="config-source"></select>
      </div>
      <div id="header-actions">
        <button id="btn-refresh" title="Refresh Health Check">Refresh</button>
        <button id="btn-add-provider" title="Add Provider">+ Add Provider</button>
      </div>
    </header>

    <!-- No config warning -->
    <div id="no-config" class="hidden">
      <p>No CCR config.json found. Please ensure Claude Code Router is configured.</p>
      <p>Expected locations:</p>
      <ul>
        <li><code>~/.claude-code-router/config.json</code> (global)</li>
        <li><code>.claude-code-router/config.json</code> (project)</li>
      </ul>
    </div>

    <!-- Dashboard -->
    <section id="dashboard" class="hidden">
      <!-- Provider cards -->
      <div id="provider-cards"></div>

      <!-- Router Summary -->
      <div id="router-section">
        <h2>Current Router
          <button id="btn-edit-router" class="btn-small">Edit Router</button>
        </h2>
        <div id="router-summary"></div>
        <div id="router-editor" class="hidden"></div>
      </div>

      <!-- Quick Switch -->
      <div id="quick-switch">
        <h2>Quick Switch</h2>
        <div id="quick-switch-controls"></div>
      </div>
    </section>

    <!-- Provider Editor (shown when editing) -->
    <section id="provider-editor-section" class="hidden">
      <h2 id="provider-editor-title">Edit Provider</h2>
      <form id="provider-form">
        <div class="form-group">
          <label for="pf-name">Name</label>
          <input type="text" id="pf-name" required>
        </div>
        <div class="form-group">
          <label for="pf-url">API Base URL</label>
          <input type="text" id="pf-url" required placeholder="https://api.example.com/v1/chat/completions">
        </div>
        <div class="form-group">
          <label>API Keys</label>
          <div id="pf-keys-list"></div>
          <button type="button" id="pf-add-key" class="btn-small">+ Add Key</button>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label><input type="checkbox" id="pf-rotation"> Enable Key Rotation</label>
          </div>
          <div class="form-group">
            <label for="pf-rotation-strategy">Strategy</label>
            <select id="pf-rotation-strategy">
              <option value="round-robin">round-robin</option>
              <option value="random">random</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label><input type="checkbox" id="pf-retry"> Retry on Failure</label>
          </div>
          <div class="form-group">
            <label for="pf-max-retries">Max Retries</label>
            <input type="number" id="pf-max-retries" min="0" max="10" value="3">
          </div>
        </div>
        <div class="form-group">
          <label>Models</label>
          <div id="pf-models-list"></div>
          <button type="button" id="pf-add-model" class="btn-small">+ Add Model</button>
        </div>
        <div class="form-group">
          <label>Transformers</label>
          <div id="pf-transformers-list"></div>
          <button type="button" id="pf-add-transformer" class="btn-small">+ Add Transformer</button>
        </div>
        <div class="form-actions">
          <button type="button" id="pf-cancel">Cancel</button>
          <button type="button" id="pf-delete" class="btn-danger hidden">Delete Provider</button>
          <button type="submit" id="pf-save" class="btn-primary">Save</button>
        </div>
      </form>
    </section>

    <!-- CCR Status -->
    <footer id="footer">
      <span id="ccr-status">CCR: checking...</span>
      <button id="btn-restart-ccr">Restart CCR</button>
    </footer>
  </div>
  <script nonce="{{nonce}}" src="{{jsUri}}"></script>
</body>
</html>
```

**Step 2: Verify the file was created**

```bash
ls -la src/webview/index.html
```

Expected: File exists.

**Step 3: Commit**

```bash
git add src/webview/index.html
git commit -m "feat: add Webview HTML template with dashboard and editor layout"
```

---

## Task 9: Webview CSS

**Files:**
- Create: `src/webview/style.css`

**Step 1: Create the Webview styles**

Create `src/webview/style.css` — uses VS Code CSS variables for automatic theme support:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 16px;
  line-height: 1.5;
}

.hidden { display: none !important; }

/* Header */
#header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

#header h1 {
  font-size: 18px;
  font-weight: 600;
}

#config-source-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
}

#header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

/* Buttons */
button {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  padding: 4px 12px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 2px;
  cursor: pointer;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.btn-primary:hover {
  background: var(--vscode-button-hoverBackground);
}

.btn-small {
  padding: 2px 8px;
  font-size: 12px;
}

.btn-danger {
  background: var(--vscode-errorForeground);
  color: var(--vscode-editor-background);
}

/* Select / Input */
select, input[type="text"], input[type="number"] {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border);
  border-radius: 2px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}

select:focus, input:focus {
  outline: 1px solid var(--vscode-focusBorder);
}

/* Provider Cards */
#provider-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.provider-card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 12px;
  background: var(--vscode-editor-background);
  transition: border-color 0.2s;
}

.provider-card.healthy {
  border-left: 3px solid var(--vscode-testing-iconPassed, #4caf50);
}

.provider-card.unhealthy {
  border-left: 3px solid var(--vscode-testing-iconFailed, #f44336);
}

.provider-card.checking {
  border-left: 3px solid var(--vscode-descriptionForeground, #888);
}

.provider-card .card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.provider-card .status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.healthy { background: var(--vscode-testing-iconPassed, #4caf50); }
.status-dot.unhealthy { background: var(--vscode-testing-iconFailed, #f44336); }
.status-dot.checking { background: var(--vscode-descriptionForeground, #888); }

.provider-card .card-name {
  font-weight: 600;
  flex: 1;
}

.provider-card .card-details {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
}

.provider-card .card-error {
  font-size: 12px;
  color: var(--vscode-errorForeground);
  margin-bottom: 8px;
}

/* Router Section */
#router-section {
  margin-bottom: 20px;
}

#router-section h2 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

#router-summary {
  font-size: 13px;
}

.router-row {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.router-row .route-key {
  width: 120px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
}

.router-row .route-value {
  flex: 1;
}

/* Router Editor */
#router-editor .form-group {
  margin-bottom: 8px;
}

#router-editor .router-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

#router-editor .router-edit-row label {
  width: 120px;
  font-weight: 600;
}

/* Quick Switch */
#quick-switch {
  margin-bottom: 20px;
}

#quick-switch h2 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

#quick-switch-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

/* Provider Editor Form */
#provider-editor-section {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 16px;
  margin-bottom: 20px;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

#provider-editor-section h2 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-weight: 500;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group select {
  width: 100%;
  max-width: 500px;
}

.form-row {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--vscode-panel-border);
}

/* Dynamic list items (keys, models) */
.list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.list-item input {
  flex: 1;
  max-width: 460px;
}

.list-item .btn-remove {
  padding: 2px 6px;
  font-size: 12px;
  color: var(--vscode-errorForeground);
  background: transparent;
  border: none;
  cursor: pointer;
}

/* Footer */
#footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--vscode-panel-border);
  font-size: 13px;
}

#ccr-status {
  color: var(--vscode-descriptionForeground);
}

/* No config */
#no-config {
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
}

#no-config ul {
  list-style: none;
  margin-top: 8px;
}

#no-config code {
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-textCodeBlock-background);
  padding: 2px 6px;
  border-radius: 2px;
}
```

**Step 2: Commit**

```bash
git add src/webview/style.css
git commit -m "feat: add Webview CSS with VS Code theme variable support"
```

---

## Task 10: Webview JavaScript

**Files:**
- Create: `src/webview/main.js`

**Step 1: Create the Webview client-side logic**

Create `src/webview/main.js`:

```javascript
// @ts-check
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  /** @type {import('../types/config').CcrConfig | null} */
  let currentConfig = null;
  /** @type {Record<string, import('../types/config').ProviderHealth>} */
  let healthMap = {};
  /** @type {import('../types/config').ConfigSource | null} */
  let activeSource = null;
  /** @type {import('../types/config').ConfigSource[]} */
  let availableSources = [];
  let ccrRunning = false;

  /** @type {number} Index of provider being edited, -1 for new */
  let editingProviderIndex = -1;

  // ── Initialization ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'updateState') {
      currentConfig = msg.payload.config;
      healthMap = msg.payload.healthMap;
      activeSource = msg.payload.activeSource;
      availableSources = msg.payload.availableSources;
      ccrRunning = msg.payload.ccrRunning;
      render();
    }
  });

  // Request initial state
  vscode.postMessage({ type: 'requestState' });

  // ── Event Listeners ──
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshHealth' });
  });

  document.getElementById('btn-add-provider')?.addEventListener('click', () => {
    openProviderEditor(-1);
  });

  document.getElementById('btn-restart-ccr')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'restartCcr' });
  });

  document.getElementById('config-source')?.addEventListener('change', (e) => {
    const select = /** @type {HTMLSelectElement} */ (e.target);
    vscode.postMessage({ type: 'switchConfigSource', payload: { sourceType: select.value } });
  });

  document.getElementById('btn-edit-router')?.addEventListener('click', () => {
    toggleRouterEditor();
  });

  // Provider form
  document.getElementById('provider-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveProvider();
  });

  document.getElementById('pf-cancel')?.addEventListener('click', () => {
    closeProviderEditor();
  });

  document.getElementById('pf-delete')?.addEventListener('click', () => {
    if (editingProviderIndex >= 0) {
      vscode.postMessage({ type: 'deleteProvider', payload: { index: editingProviderIndex } });
      closeProviderEditor();
    }
  });

  document.getElementById('pf-add-key')?.addEventListener('click', () => {
    addListItem('pf-keys-list', '');
  });

  document.getElementById('pf-add-model')?.addEventListener('click', () => {
    addListItem('pf-models-list', '');
  });

  document.getElementById('pf-add-transformer')?.addEventListener('click', () => {
    addListItem('pf-transformers-list', '');
  });

  // ── Render ──
  function render() {
    const noConfig = document.getElementById('no-config');
    const dashboard = document.getElementById('dashboard');

    if (!currentConfig) {
      noConfig?.classList.remove('hidden');
      dashboard?.classList.add('hidden');
      return;
    }

    noConfig?.classList.add('hidden');
    dashboard?.classList.remove('hidden');

    renderConfigSourceSwitcher();
    renderProviderCards();
    renderRouterSummary();
    renderQuickSwitch();
    renderCcrStatus();
  }

  function renderConfigSourceSwitcher() {
    const select = /** @type {HTMLSelectElement} */ (document.getElementById('config-source'));
    if (!select) { return; }
    select.innerHTML = '';
    for (const src of availableSources) {
      const opt = document.createElement('option');
      opt.value = src.type;
      opt.textContent = src.type === 'global' ? `Global (${src.path})` : `Project (${src.path})`;
      opt.selected = activeSource?.type === src.type;
      select.appendChild(opt);
    }
  }

  function renderProviderCards() {
    const container = document.getElementById('provider-cards');
    if (!container || !currentConfig) { return; }
    container.innerHTML = '';

    for (let i = 0; i < currentConfig.Providers.length; i++) {
      const provider = currentConfig.Providers[i];
      const health = healthMap[provider.name];
      const status = health?.status || 'checking';

      const card = document.createElement('div');
      card.className = `provider-card ${status}`;
      card.innerHTML = `
        <div class="card-header">
          <span class="status-dot ${status}"></span>
          <span class="card-name">${escapeHtml(provider.name)}</span>
        </div>
        <div class="card-details">
          ${health?.latencyMs !== null && health?.latencyMs !== undefined ? `${health.latencyMs}ms` : ''}
          ${provider.models.length} model${provider.models.length !== 1 ? 's' : ''}
        </div>
        ${health?.error ? `<div class="card-error">${escapeHtml(health.error)}</div>` : ''}
        <button class="btn-small btn-edit-provider" data-index="${i}">Edit</button>
      `;
      container.appendChild(card);
    }

    // Attach edit handlers
    container.querySelectorAll('.btn-edit-provider').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(/** @type {HTMLElement} */ (e.target).dataset.index || '-1', 10);
        openProviderEditor(idx);
      });
    });
  }

  function renderRouterSummary() {
    const container = document.getElementById('router-summary');
    if (!container || !currentConfig) { return; }
    const router = currentConfig.Router || {};
    const keys = ['default', 'background', 'think', 'longContext', 'webSearch', 'image'];
    container.innerHTML = keys
      .filter((k) => router[k])
      .map((k) => `
        <div class="router-row">
          <span class="route-key">${k}:</span>
          <span class="route-value">${escapeHtml(router[k] || '(not set)')}</span>
        </div>
      `).join('');

    if (router.longContextThreshold) {
      container.innerHTML += `
        <div class="router-row">
          <span class="route-key">longContextThreshold:</span>
          <span class="route-value">${router.longContextThreshold}</span>
        </div>
      `;
    }
  }

  function renderQuickSwitch() {
    const container = document.getElementById('quick-switch-controls');
    if (!container || !currentConfig) { return; }

    const providers = currentConfig.Providers || [];
    const options = providers.map((p) => {
      const health = healthMap[p.name];
      const status = health?.status || 'unknown';
      return p.models.map((m) => ({
        label: `${p.name} / ${m}`,
        value: `${p.name},${m}`,
        healthy: status === 'healthy',
      }));
    }).flat();

    const currentDefault = currentConfig.Router?.default || '';

    container.innerHTML = `
      <label for="qs-select">default:</label>
      <select id="qs-select">
        ${options.map((o) => `
          <option value="${escapeHtml(o.value)}"
            ${o.value === currentDefault ? 'selected' : ''}
            ${!o.healthy ? 'style="opacity:0.5"' : ''}>
            ${o.healthy ? '' : '[DOWN] '}${escapeHtml(o.label)}
          </option>
        `).join('')}
      </select>
      <button id="qs-apply" class="btn-primary">Apply &amp; Restart</button>
    `;

    document.getElementById('qs-apply')?.addEventListener('click', () => {
      const select = /** @type {HTMLSelectElement} */ (document.getElementById('qs-select'));
      if (select) {
        vscode.postMessage({
          type: 'quickSwitch',
          payload: { routeKey: 'default', providerModel: select.value },
        });
      }
    });
  }

  function renderCcrStatus() {
    const el = document.getElementById('ccr-status');
    if (el) {
      el.textContent = ccrRunning ? 'CCR: running' : 'CCR: stopped';
    }
  }

  // ── Provider Editor ──
  function openProviderEditor(index) {
    editingProviderIndex = index;
    const section = document.getElementById('provider-editor-section');
    const title = document.getElementById('provider-editor-title');
    const deleteBtn = document.getElementById('pf-delete');

    if (!section || !title) { return; }
    section.classList.remove('hidden');

    if (index >= 0 && currentConfig) {
      const provider = currentConfig.Providers[index];
      title.textContent = `Edit Provider: ${provider.name}`;
      deleteBtn?.classList.remove('hidden');
      fillProviderForm(provider);
    } else {
      title.textContent = 'Add Provider';
      deleteBtn?.classList.add('hidden');
      fillProviderForm(null);
    }

    section.scrollIntoView({ behavior: 'smooth' });
  }

  function closeProviderEditor() {
    const section = document.getElementById('provider-editor-section');
    section?.classList.add('hidden');
    editingProviderIndex = -1;
  }

  function fillProviderForm(provider) {
    setValue('pf-name', provider?.name || '');
    setValue('pf-url', provider?.api_base_url || '');
    setChecked('pf-rotation', provider?.enable_rotation || false);
    setValue('pf-rotation-strategy', provider?.rotation_strategy || 'round-robin');
    setChecked('pf-retry', provider?.retry_on_failure || false);
    setValue('pf-max-retries', String(provider?.max_retries ?? 3));

    // Keys
    const keysContainer = document.getElementById('pf-keys-list');
    if (keysContainer) {
      keysContainer.innerHTML = '';
      const keys = provider?.api_keys || (provider?.api_key ? [provider.api_key] : []);
      keys.forEach((k) => addListItem('pf-keys-list', k));
      if (keys.length === 0) { addListItem('pf-keys-list', ''); }
    }

    // Models
    const modelsContainer = document.getElementById('pf-models-list');
    if (modelsContainer) {
      modelsContainer.innerHTML = '';
      (provider?.models || []).forEach((m) => addListItem('pf-models-list', m));
      if (!provider?.models?.length) { addListItem('pf-models-list', ''); }
    }

    // Transformers
    const transformersContainer = document.getElementById('pf-transformers-list');
    if (transformersContainer) {
      transformersContainer.innerHTML = '';
      const uses = provider?.transformer?.use || [];
      uses.forEach((t) => {
        const val = Array.isArray(t) ? t[0] : t;
        addListItem('pf-transformers-list', String(val));
      });
    }
  }

  function saveProvider() {
    const provider = {
      name: getValue('pf-name'),
      api_base_url: getValue('pf-url'),
      api_keys: getListValues('pf-keys-list').filter(Boolean),
      enable_rotation: getChecked('pf-rotation'),
      rotation_strategy: getValue('pf-rotation-strategy'),
      retry_on_failure: getChecked('pf-retry'),
      max_retries: parseInt(getValue('pf-max-retries'), 10) || 3,
      models: getListValues('pf-models-list').filter(Boolean),
      transformer: {
        use: getListValues('pf-transformers-list').filter(Boolean),
      },
    };

    if (!provider.name || !provider.api_base_url) {
      return; // Basic validation
    }

    if (editingProviderIndex >= 0) {
      vscode.postMessage({ type: 'saveProvider', payload: { index: editingProviderIndex, provider } });
    } else {
      vscode.postMessage({ type: 'addProvider', payload: { provider } });
    }
    closeProviderEditor();
  }

  // ── Router Editor ──
  function toggleRouterEditor() {
    const editor = document.getElementById('router-editor');
    if (!editor || !currentConfig) { return; }

    if (editor.classList.contains('hidden')) {
      editor.classList.remove('hidden');
      renderRouterEditor();
    } else {
      editor.classList.add('hidden');
    }
  }

  function renderRouterEditor() {
    const editor = document.getElementById('router-editor');
    if (!editor || !currentConfig) { return; }

    const router = currentConfig.Router || {};
    const keys = ['default', 'background', 'think', 'longContext', 'webSearch', 'image'];

    editor.innerHTML = keys.map((k) => `
      <div class="router-edit-row">
        <label>${k}:</label>
        <input type="text" class="router-input" data-key="${k}" value="${escapeHtml(router[k] || '')}" placeholder="provider-name,model-name">
      </div>
    `).join('') + `
      <div class="router-edit-row">
        <label>longContextThreshold:</label>
        <input type="number" id="re-threshold" value="${router.longContextThreshold || 60000}">
      </div>
      <div class="form-actions">
        <button type="button" id="re-cancel" class="btn-small">Cancel</button>
        <button type="button" id="re-save" class="btn-small btn-primary">Save Router</button>
      </div>
    `;

    document.getElementById('re-cancel')?.addEventListener('click', () => {
      editor.classList.add('hidden');
    });

    document.getElementById('re-save')?.addEventListener('click', () => {
      const newRouter = {};
      editor.querySelectorAll('.router-input').forEach((input) => {
        const el = /** @type {HTMLInputElement} */ (input);
        if (el.value.trim()) {
          newRouter[el.dataset.key] = el.value.trim();
        }
      });
      const threshold = /** @type {HTMLInputElement} */ (document.getElementById('re-threshold'));
      if (threshold?.value) {
        newRouter.longContextThreshold = parseInt(threshold.value, 10);
      }
      vscode.postMessage({ type: 'saveRouter', payload: { router: newRouter } });
      editor.classList.add('hidden');
    });
  }

  // ── Helpers ──
  function addListItem(containerId, value) {
    const container = document.getElementById(containerId);
    if (!container) { return; }
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <input type="text" value="${escapeHtml(value)}">
      <button type="button" class="btn-remove" title="Remove">x</button>
    `;
    div.querySelector('.btn-remove')?.addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  function getListValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) { return []; }
    return Array.from(container.querySelectorAll('input')).map((el) => el.value.trim());
  }

  function getValue(id) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    return el?.value?.trim() || '';
  }

  function setValue(id, value) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    if (el) { el.value = value; }
  }

  function getChecked(id) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    return el?.checked || false;
  }

  function setChecked(id, value) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    if (el) { el.checked = value; }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
```

**Step 2: Commit**

```bash
git add src/webview/main.js
git commit -m "feat: add Webview client-side JS with dashboard, editor, and quick switch"
```

---

## Task 11: Wire Everything Together in extension.ts

**Files:**
- Modify: `src/extension.ts`

**Step 1: Rewrite extension.ts to wire all services and views**

Replace the full content of `src/extension.ts`:

```typescript
import * as vscode from 'vscode';
import { ConfigManager } from './services/configManager';
import { HealthMonitor } from './services/healthMonitor';
import { CcrProcessManager } from './services/ccrProcess';
import { StatusBarManager } from './views/statusBar';
import { WebviewPanelManager, WebviewMessage, WebviewState } from './views/webviewPanel';
import { CcrConfig } from './types/config';

export function activate(context: vscode.ExtensionContext) {
  const configManager = new ConfigManager();
  const healthMonitor = new HealthMonitor(configManager);
  const ccrProcess = new CcrProcessManager();
  const statusBar = new StatusBarManager();
  const webviewPanel = new WebviewPanelManager(context.extensionUri);

  // Load config
  configManager.load();

  // Start health monitoring
  healthMonitor.start();

  // Update status bar when health changes
  healthMonitor.onDidUpdateHealth(() => {
    statusBar.update(healthMonitor.getOverallHealth());
    sendStateToWebview();
  });

  // Update webview when config changes
  configManager.onDidChangeConfig(() => {
    sendStateToWebview();
  });

  // ── Commands ──
  context.subscriptions.push(
    vscode.commands.registerCommand('ccr-monitor.openDashboard', () => {
      webviewPanel.show();
      sendStateToWebview();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ccr-monitor.refreshHealth', () => {
      healthMonitor.checkAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ccr-monitor.restartCcr', () => {
      handleRestartCcr();
    }),
  );

  // ── Webview Messages ──
  webviewPanel.onDidReceiveMessage(async (msg: WebviewMessage) => {
    switch (msg.type) {
      case 'requestState':
        sendStateToWebview();
        break;

      case 'refreshHealth':
        healthMonitor.checkAll();
        break;

      case 'restartCcr':
        handleRestartCcr();
        break;

      case 'switchConfigSource': {
        const sources = configManager.getAvailableSources();
        const target = sources.find(s => s.type === msg.payload.sourceType);
        if (target) {
          configManager.load(target);
          healthMonitor.checkAll();
        }
        break;
      }

      case 'saveProvider': {
        const config = configManager.config;
        if (!config) { break; }
        const updated = { ...config };
        updated.Providers = [...config.Providers];
        updated.Providers[msg.payload.index] = msg.payload.provider as CcrConfig['Providers'][number];
        if (configManager.save(updated)) {
          await promptRestart();
        }
        break;
      }

      case 'addProvider': {
        const config = configManager.config;
        if (!config) { break; }
        const updated = { ...config };
        updated.Providers = [...config.Providers, msg.payload.provider as CcrConfig['Providers'][number]];
        if (configManager.save(updated)) {
          await promptRestart();
        }
        break;
      }

      case 'deleteProvider': {
        const config = configManager.config;
        if (!config) { break; }
        const updated = { ...config };
        updated.Providers = config.Providers.filter((_, i) => i !== msg.payload.index);
        if (configManager.save(updated)) {
          await promptRestart();
        }
        break;
      }

      case 'saveRouter': {
        const config = configManager.config;
        if (!config) { break; }
        const updated = { ...config, Router: msg.payload.router as CcrConfig['Router'] };
        if (configManager.save(updated)) {
          await promptRestart();
        }
        break;
      }

      case 'quickSwitch': {
        const config = configManager.config;
        if (!config) { break; }
        const updated = {
          ...config,
          Router: {
            ...config.Router,
            [msg.payload.routeKey]: msg.payload.providerModel,
          },
        };
        if (configManager.save(updated)) {
          await handleRestartCcr();
          healthMonitor.checkAll();
        }
        break;
      }
    }
  });

  // ── Helpers ──
  async function sendStateToWebview(): Promise<void> {
    const running = await ccrProcess.isRunning();
    const healthObj: Record<string, import('./types/config').ProviderHealth> = {};
    for (const [k, v] of healthMonitor.healthMap) {
      healthObj[k] = v;
    }
    const state: WebviewState = {
      config: configManager.config,
      healthMap: healthObj,
      activeSource: configManager.activeSource,
      availableSources: configManager.getAvailableSources(),
      ccrRunning: running,
    };
    webviewPanel.postState(state);
  }

  async function promptRestart(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'Config saved. Restart CCR to apply changes?',
      'Restart',
      'Later',
    );
    if (choice === 'Restart') {
      await handleRestartCcr();
    }
  }

  async function handleRestartCcr(): Promise<void> {
    await ccrProcess.restart();
    // Wait for CCR to start, then re-check health
    setTimeout(() => healthMonitor.checkAll(), 3000);
  }

  // Register disposables
  context.subscriptions.push(configManager, healthMonitor, ccrProcess, statusBar, webviewPanel);

  console.log('CCR Monitor is now active');
}

export function deactivate() {}
```

**Step 2: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire all services and views in extension entry point"
```

---

## Task 12: README

**Files:**
- Create: `README.md`

**Step 1: Create comprehensive README**

Create `README.md`:

```markdown
# CCR Monitor

A Visual Studio Code extension for monitoring and managing [Claude Code Router (CCR)](https://github.com/musistudio/claude-code-router) provider health, configuration, and process lifecycle.

## Features

- **Health Monitoring** — Periodically checks all model providers in your CCR config to see if they're alive
- **Status Bar Indicator** — Color-coded status bar icon (green/yellow/red) for at-a-glance provider health
- **Dashboard** — Webview panel showing all provider health cards, router config summary, and quick switch controls
- **Config Editor** — Visual form-based editor for providers, router rules, and settings
- **Quick Switch** — One-click switching of the default provider when one goes down
- **CCR Process Management** — Detect, restart, and manage the CCR process from within VS Code
- **Multi-config Support** — Works with both global and project-level CCR configs

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code Router](https://github.com/musistudio/claude-code-router) installed and configured
- VS Code >= 1.85.0

## Installation

### From VSIX (Local Build)

1. Build the extension (see [Development](#development) below)
2. In VS Code, open the Command Palette (`Ctrl+Shift+P`)
3. Run `Extensions: Install from VSIX...`
4. Select the generated `.vsix` file

### From Source

```bash
git clone <repo-url> ccr-monitor
cd ccr-monitor
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Configuration

The extension reads CCR config from these locations (in priority order):

1. **Project-level**: `{workspaceFolder}/.claude-code-router/config.json`
2. **Global**: `~/.claude-code-router/config.json`

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccr-monitor.healthCheckInterval` | `60` | Health check interval in seconds |
| `ccr-monitor.globalConfigPath` | `~/.claude-code-router/config.json` | Path to global CCR config |
| `ccr-monitor.healthCheckTimeout` | `5000` | Health check request timeout in ms |

## Usage

### Opening the Dashboard

- Click the **CCR** status bar item (bottom right), or
- Run command `CCR Monitor: Open Dashboard` from the Command Palette

### Understanding the Status Bar

| Icon | Meaning |
|------|---------|
| $(check) CCR | All providers healthy |
| $(warning) CCR (yellow) | Some providers down |
| $(error) CCR (red) | All providers down |
| $(sync~spin) CCR | Checking... |

### Editing a Provider

1. Open the Dashboard
2. Click **Edit** on a provider card
3. Modify the form fields
4. Click **Save**
5. Choose whether to restart CCR to apply changes

### Quick Switching Providers

When a provider goes down:

1. Open the Dashboard
2. In the **Quick Switch** section, select a healthy provider/model from the dropdown
3. Click **Apply & Restart**

### Editing Router Rules

1. Open the Dashboard
2. Click **Edit Router** next to the Current Router section
3. Set provider,model pairs for each route (default, background, think, etc.)
4. Click **Save Router**

### Restarting CCR

- Click **Restart CCR** in the Dashboard footer, or
- Run command `CCR Monitor: Restart CCR` from the Command Palette

## Development

### Setup

```bash
git clone <repo-url> ccr-monitor
cd ccr-monitor
npm install
```

### Build

```bash
npm run compile    # One-time compile
npm run watch      # Watch mode for development
```

### Run & Debug

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. The extension activates automatically on startup

### Package

```bash
npm run package
```

Generates `ccr-monitor-<version>.vsix` in the project root.

### Project Structure

```
ccr-monitor/
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript config
├── src/
│   ├── extension.ts          # Entry point — wires services and views
│   ├── services/
│   │   ├── healthMonitor.ts  # Periodic health checks via HTTP GET /models
│   │   ├── configManager.ts  # Read/write/watch CCR config.json
│   │   └── ccrProcess.ts     # CCR process detection and restart
│   ├── views/
│   │   ├── statusBar.ts      # Status bar color indicator
│   │   └── webviewPanel.ts   # Webview panel lifecycle and messaging
│   ├── webview/
│   │   ├── index.html        # Dashboard HTML
│   │   ├── main.js           # Dashboard client-side logic
│   │   └── style.css         # Styles using VS Code theme variables
│   └── types/
│       └── config.ts         # TypeScript type definitions
└── docs/
    └── plans/                # Design and implementation docs
```

## How It Works

1. On activation, the extension loads the CCR `config.json` (project-level first, then global)
2. A background timer pings each provider's `/models` endpoint every 60 seconds
3. Health results update the status bar indicator and the Webview dashboard
4. The Webview communicates with the extension host via `postMessage` for edits and actions
5. Config changes are written to disk, and CCR can be restarted from within VS Code

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run compile` to verify
5. Submit a pull request

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with setup, usage, and development guide"
```

---

## Task 13: Final Verification

**Step 1: Full clean build**

```bash
cd /home/eric/projects/ccr_monitor
rm -rf out/
npm run compile
```

Expected: No errors, `out/` directory contains compiled JS files.

**Step 2: Verify all files exist**

```bash
ls -R src/
```

Expected: All source files present as specified in the project structure.

**Step 3: Try packaging**

```bash
npm run package
```

Expected: Generates `ccr-monitor-0.1.0.vsix`.

**Step 4: Final commit (if any remaining changes)**

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "chore: final cleanup and verification"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Project scaffolding | package.json, tsconfig.json, .vscodeignore, .gitignore, extension.ts stub |
| 2 | TypeScript types | src/types/config.ts |
| 3 | Config Manager | src/services/configManager.ts |
| 4 | Health Monitor | src/services/healthMonitor.ts |
| 5 | CCR Process Manager | src/services/ccrProcess.ts |
| 6 | Status Bar | src/views/statusBar.ts |
| 7 | Webview Panel (host) | src/views/webviewPanel.ts |
| 8 | Webview HTML | src/webview/index.html |
| 9 | Webview CSS | src/webview/style.css |
| 10 | Webview JavaScript | src/webview/main.js |
| 11 | Extension entry point | src/extension.ts (full wiring) |
| 12 | README | README.md |
| 13 | Final verification | Clean build + package |
