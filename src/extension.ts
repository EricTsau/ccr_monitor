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
        } else {
          vscode.window.showErrorMessage('Failed to save CCR config.');
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
        } else {
          vscode.window.showErrorMessage('Failed to save CCR config.');
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
        } else {
          vscode.window.showErrorMessage('Failed to save CCR config.');
        }
        break;
      }

      case 'saveRouter': {
        const config = configManager.config;
        if (!config) { break; }
        const updated = { ...config, Router: msg.payload.router as CcrConfig['Router'] };
        if (configManager.save(updated)) {
          await promptRestart();
        } else {
          vscode.window.showErrorMessage('Failed to save CCR config.');
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
        } else {
          vscode.window.showErrorMessage('Failed to save CCR config.');
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
    setTimeout(() => healthMonitor.checkAll(), 3000);
  }

  // Register disposables
  context.subscriptions.push(configManager, healthMonitor, ccrProcess, statusBar, webviewPanel);

  console.log('CCR Monitor is now active');
}

export function deactivate() {}
