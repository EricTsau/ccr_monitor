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
      const { stdout } = await execAsync('npx claude-code-router --version', { timeout: 10000 });
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
    if (process.platform === 'win32') {
      try {
        await execAsync('tasklist /FI "IMAGENAME eq node.exe"', { timeout: 5000 });
        // On Windows, we check for node.exe running with claude-code-router arg
        const { stdout } = await execAsync(
          'tasklist /NH /FO CSV 2>nul | findstr /I "node.exe" | findstr /I "claude-code-router"',
          { timeout: 5000 }
        );
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    } else {
      try {
        const { stdout } = await execAsync('pgrep -f claude-code-router');
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    }
  }

  async getPid(): Promise<number | null> {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(
          'wmic process where "name=\'node.exe\' and commandline like \'%claude-code-router%\'" get ProcessId 2>nul',
          { timeout: 5000 }
        );
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
          const pid = parseInt(lines[1].trim(), 10);
          return isNaN(pid) ? null : pid;
        }
        return null;
      } catch {
        return null;
      }
    } else {
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
  }

  async kill(): Promise<boolean> {
    const pid = await this.getPid();
    if (!pid) { return false; }
    try {
      if (process.platform === 'win32') {
        await execAsync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
      } else {
        await execAsync(`kill ${pid}`);
      }
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
