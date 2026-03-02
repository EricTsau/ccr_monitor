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
      await new Promise(resolve => setTimeout(resolve, 1000));
      return true;
    } catch {
      return false;
    }
  }

  async restart(): Promise<void> {
    const wasRunning = await this.isRunning();
    if (wasRunning) {
      await this.kill();
    }

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
