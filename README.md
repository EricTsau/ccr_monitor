# CCR Monitor

一個用於監控與管理 [Claude Code Router (CCR)](https://github.com/musistudio/claude-code-router) 供應商健康狀態、設定檔及程序生命週期的 Visual Studio Code 擴充套件。

## 功能特色

- **健康狀態監控** — 定期檢查 CCR 設定中所有模型供應商的連線狀態以確保正常運作
- **狀態列指示器** — 透過顏色圖示（綠/黃/紅）一眼看出供應商健康狀態
- **控制面板（Dashboard）** — 透過 Webview 面板顯示所有供應商的健康狀態卡片、路由設定摘要，並提供快速切換控制
- **設定檔編輯器** — 視覺化表單編輯器，用於修改供應商、路由規則及相關設定
- **快速切換** — 當某個供應商發生異常時，可一鍵切換預設供應商
- **CCR 程序管理** — 可直接在 VS Code 內偵測、重新啟動及管理 CCR 程序
- **支援多層級設定** — 支援全域（Global）與專案層級（Project-level）的 CCR 設定檔

## 系統需求

- [Node.js](https://nodejs.org/) >= 18
- 已安裝並設定完成的 [Claude Code Router](https://github.com/musistudio/claude-code-router)
- VS Code >= 1.85.0

## 安裝方式

### 從 VSIX 安裝（本地建置）

1. 建置擴充套件（請參考下方的 [開發指南](#開發指南)）
2. 在 VS Code 中開啟命令面板（Command Palette, `Ctrl+Shift+P`）
3. 執行 `Extensions: Install from VSIX...`
4. 選擇產生出的 `.vsix` 檔案

### 從原始碼安裝

```bash
git clone <repo-url> ccr-monitor
cd ccr-monitor
npm install
npm run compile
```

接著在 VS Code 中按下 `F5` 以啟動 Extension Development Host。

## 設定

本擴充套件會從以下位置讀取 CCR 設定檔（依優先順序配置）：

1. **專案層級**：`{workspaceFolder}/.claude-code-router/config.json`
2. **全域**：`~/.claude-code-router/config.json`

### 擴充套件設定項目

| 設定名稱 | 預設值 | 說明 |
|---------|---------|-------------|
| `ccr-monitor.healthCheckInterval` | `60` | 健康檢查間隔（秒） |
| `ccr-monitor.globalConfigPath` | `~/.claude-code-router/config.json` | 全域 CCR 設定檔路徑 |
| `ccr-monitor.healthCheckTimeout` | `5000` | 健康檢查請求逾時時間（毫秒） |

## 使用方式

### 開啟控制面板（Dashboard）

- 點擊狀態列（右下角）的 **CCR** 項目，或者
- 從命令面板執行 `CCR Monitor: Open Dashboard` 指令

### 狀態列圖示說明

| 圖示 | 意義 |
|------|---------|
| $(check) CCR | 預設供應商與模型皆可正常運作 |
| $(warning) CCR (黃色) | 預設供應商不可用，但有其他可用 |
| $(error) CCR (紅色) | 沒有任何供應商可用 |
| $(sync~spin) CCR | 檢查中... |
| $(x) CCR: not installed | CCR 未安裝 |

### 編輯供應商

1. 開啟控制面板
2. 在供應商卡片上點擊 **Edit**
3. 修改表單欄位
4. 點擊 **Save**
5. 選擇是否重新啟動 CCR 以套用變更

### 快速切換供應商

當供應商發生異常時：

1. 開啟控制面板
2. 在 **Quick Switch** 區塊，從下拉選單選擇一個正常的供應商/模型
3. 點擊 **Apply & Restart**

### 編輯路由規則

1. 開啟控制面板
2. 點擊 Current Router 區塊旁的 **Edit Router**
3. 為每個路由（default, background, think 等）設定供應商與模型配對
4. 點擊 **Save Router**

### 重新啟動 CCR

- 點擊控制面板底部的 **Restart CCR**，或者
- 從命令面板執行 `CCR Monitor: Restart CCR` 指令

## 開發指南

### 環境設置

```bash
git clone <repo-url> ccr-monitor
cd ccr-monitor
npm install
```

### 建置

```bash
npm run compile    # 單次建置
npm run watch      # 監聽模式（開發用）
```

### 執行與偵錯

1. 在 VS Code 中開啟專案
2. 按 `F5` 啟動 Extension Development Host
3. 擴充套件將在啟動時自動啟用

### 打包套件

```bash
npm run package
```

會在專案根目錄下產生 `ccr-monitor-<version>.vsix` 檔案。

### 專案結構

```
ccr-monitor/
├── package.json              # 擴充套件資訊
├── tsconfig.json             # TypeScript 設定
├── src/
│   ├── extension.ts          # 進入點 — 連結各服務與視圖
│   ├── services/
│   │   ├── healthMonitor.ts  # 透過 HTTP GET /models 定期檢查健康狀態
│   │   ├── configManager.ts  # 讀取/寫入/監聽 CCR config.json
│   │   └── ccrProcess.ts     # 偵測與重新啟動 CCR 程序
│   ├── views/
│   │   ├── statusBar.ts      # 狀態列顏色指示器
│   │   └── webviewPanel.ts   # Webview 面板生命週期與訊息溝通
│   ├── webview/
│   │   ├── index.html        # 控制面板 HTML
│   │   ├── main.js           # 控制面板客戶端邏輯
│   │   └── style.css         # 使用 VS Code 主題變數的樣式
│   └── types/
│       └── config.ts         # TypeScript 型別定義
```

## 運作原理

1. 擴充套件啟用時，會讀取 CCR 的 `config.json`（優先讀取專案層級，其次為全域）。
2. 背景計時器會每隔 60 秒針對每個供應商的 `/models` 端點進行 Ping 測試。
3. 檢查結果會更新至狀態列指示器與 Webview 控制面板。
4. Webview 透過 `postMessage` 與擴充套件宿主（Host）通訊，以進行編輯和互動。
5. 設定變更會寫入硬碟，且可從 VS Code 內部重新啟動 CCR。

## 參與貢獻

1. Fork 此儲存庫
2. 建立新的功能分支 (Feature branch)
3. 提交您的變更
4. 執行 `npm run compile` 以確認建置無誤
5. 提交 Pull Request (PR)

## 授權條款

MIT License - 詳見 LICENSE 檔案
