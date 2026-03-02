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
