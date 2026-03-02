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
