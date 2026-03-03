import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const execAsync = promisify(exec);

export class CcrProcessManager implements vscode.Disposable {
  private _terminal: vscode.Terminal | null = null;
  private _outputChannel: vscode.OutputChannel | null = null;

  private get outputChannel(): vscode.OutputChannel {
    if (!this._outputChannel) {
      this._outputChannel = vscode.window.createOutputChannel('CCR Monitor Diagnostics');
    }
    return this._outputChannel;
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] ${message}`;
    console.log(fullMessage);
    this.outputChannel.appendLine(fullMessage);
  }

  private getWindowsNpmPath(): string {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  }

  private async checkWindowsNpmPath(): Promise<boolean> {
    const npmPath = this.getWindowsNpmPath();
    const possibleBinaries = [
      path.join(npmPath, 'claude-code-router.cmd'),
      path.join(npmPath, 'claude-code-router.exe'),
      path.join(npmPath, 'claude-code-router'),
    ];

    for (const binPath of possibleBinaries) {
      this.log(`Checking Windows npm path: ${binPath}`);
      if (fs.existsSync(binPath)) {
        this.log(`Found CCR at: ${binPath}`);
        return true;
      }
    }
    return false;
  }

  private async checkNpx(): Promise<boolean> {
    this.log('Attempting npx claude-code-router --version');
    try {
      const { stdout } = await execAsync('npx claude-code-router --version', { timeout: 20000 });
      this.log(`npx succeeded, output: ${stdout.trim()}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`npx failed: ${errorMessage}`);
      return false;
    }
  }

  async isInstalled(): Promise<boolean> {
    this.log('Starting CCR detection...');

    // Try npx first (works on all platforms)
    if (await this.checkNpx()) {
      this.log('CCR detected via npx');
      return true;
    }

    // On Windows, also check the npm global path directly
    if (process.platform === 'win32') {
      this.log('Windows detected, checking npm global path...');
      if (await this.checkWindowsNpmPath()) {
        this.log('CCR detected via Windows npm path');
        return true;
      }
    }

    this.log('CCR not detected via any method');
    return false;
  }

  async isRunning(): Promise<boolean> {
    try {
      await execAsync('ccr status', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async restart(): Promise<void> {
    if (this._terminal) {
      this._terminal.dispose();
    }
    this._terminal = vscode.window.createTerminal({
      name: 'CCR',
      hideFromUser: false,
    });

    const running = await this.isRunning();

    if (running) {
      // 已運行：先停止再啟動
      this._terminal.sendText('ccr stop');
      this._terminal.sendText('ccr start');
    } else {
      // 未運行：直接啟動
      this._terminal.sendText('ccr start');
    }

    this._terminal.show(true);
  }

  showDiagnostics(): void {
    this.outputChannel.show();
    this.log('=== CCR Monitor Diagnostics ===');
    this.log(`Platform: ${process.platform}`);
    this.log(`Node version: ${process.version}`);
    this.log(`OS Home: ${os.homedir()}`);
    this.log(`Windows npm path: ${this.getWindowsNpmPath()}`);
    this.log(`PATH env: ${process.env.PATH?.substring(0, 200)}...`);
  }

  dispose(): void {
    if (this._terminal) {
      this._terminal.dispose();
      this._terminal = null;
    }
    if (this._outputChannel) {
      this._outputChannel.dispose();
      this._outputChannel = null;
    }
  }
}
