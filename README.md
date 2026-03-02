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
