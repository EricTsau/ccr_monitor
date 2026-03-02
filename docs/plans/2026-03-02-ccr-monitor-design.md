# CCR Monitor — VS Code Extension 設計文件

**日期**：2026-03-02
**狀態**：已核准

---

## 1. 專案概述

### 目的

為 Claude Code Router (CCR) 使用者提供一個 VS Code 套件，能夠：

1. **定期偵測** CCR config.json 中所有模型提供商是否存活
2. **顯示當前設定** — 路由規則、使用中的 provider 及其詳細參數
3. **視覺化編輯** — Webview 表單 UI 編輯 config.json 並 Apply（寫入 + 重啟 CCR）
4. **快速切換** — 當 provider 掛掉時能一鍵切換到健康的 provider

### 使用情境

開發者使用 Claude Code + CCR 搭配多個 LLM 提供商（Anthropic、OpenRouter、Gemini 等）。當某個提供商服務中斷時，需要快速感知並切換到備用提供商，避免開發工作中斷。

---

## 2. 架構設計

### 方案：單一 Webview Panel

所有功能集中在一個 Webview 面板中，搭配狀態列指示器。

```
┌─────────────────────────────────────────────────┐
│                 VS Code Extension                │
│                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Health    │  │  Config      │  │ CCR       │  │
│  │ Monitor   │  │  Manager     │  │ Process   │  │
│  │ Service   │  │              │  │ Manager   │  │
│  └─────┬────┘  └──────┬───────┘  └─────┬─────┘  │
│        │              │                │         │
│  ┌─────┴──────────────┴────────────────┴─────┐  │
│  │            Webview Panel                   │  │
│  │  ┌─────────────────────────────────────┐   │  │
│  │  │  Dashboard (Health Status Cards)    │   │  │
│  │  ├─────────────────────────────────────┤   │  │
│  │  │  Router Config Summary              │   │  │
│  │  ├─────────────────────────────────────┤   │  │
│  │  │  Provider Editor (Form)             │   │  │
│  │  └─────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────┐                          │
│  │  Status Bar Item   │  ← 綠/紅/黃 圖示         │
│  └────────────────────┘                          │
└─────────────────────────────────────────────────┘
```

### 三個核心服務

1. **Health Monitor Service** — 每 60 秒對所有 provider 的 `/models` 端點發送 GET 請求，記錄回應狀態與延遲
2. **Config Manager** — 讀取/解析/寫入 config.json（支援全域 + 專案級），監聽檔案變更
3. **CCR Process Manager** — 管理 CCR 的偵測與重啟

---

## 3. 狀態列設計

- **位置**：VS Code 底部狀態列
- **顯示格式**：`$(pulse) CCR` + 彩色指示
  - 🟢 綠色：全部 provider 健康
  - 🟡 黃色：部分 provider 不可用
  - 🔴 紅色：全部 provider 不可用
  - ⚪ 灰色：偵測中
- **互動**：點擊開啟/聚焦 Webview Panel

---

## 4. Dashboard 設計

### Provider 健康卡片

每張卡片顯示：
- 健康狀態指示燈（綠/紅）
- Provider 名稱
- 回應延遲（ms）或錯誤訊息（timeout / connection refused 等）
- 可用模型數量
- [Edit] 按鈕進入編輯模式

### Router Config Summary

顯示當前路由規則：
- default: `provider / model`
- background: `provider / model`
- think: `provider / model`
- longContext: `provider / model`
- webSearch: `provider / model`

### Quick Switch

一鍵切換 default provider 的下拉選單 + [Apply & Restart] 按鈕。不健康的 provider 灰色標示但仍可選。

---

## 5. Provider 編輯表單

點擊 [Edit] 後展開表單，欄位包含：

| 欄位 | 類型 | 說明 |
|------|------|------|
| Name | text input | Provider 名稱 |
| API Base URL | text input | API 端點 URL |
| API Keys | text input + 列表 | 支援多組 key，支援 `$ENV_VAR` 格式 |
| Enable Rotation | checkbox | 啟用 key 輪替 |
| Rotation Strategy | dropdown | round-robin / random |
| Retry on Failure | checkbox | 啟用失敗重試 |
| Max Retries | number input | 最大重試次數 |
| Models | text input + 列表 | 支援新增/刪除模型 |
| Transformer | dropdown + 列表 | 選擇適用的 transformer |

### 新增 Provider

Dashboard 頂部有 [+ Add Provider] 按鈕，開啟空白表單。

### Router 編輯

Router Summary 區塊有 [Edit Router] 按鈕，展開路由設定表單。每個路由規則用 provider + model 兩個下拉選單。

---

## 6. Apply 流程

1. 使用者在表單編輯完畢點 [Save]
2. 套件驗證表單資料（必填欄位、URL 格式等）
3. 將修改寫入 config.json
4. 詢問「是否重啟 CCR？」
5. 若確認，執行 CCR 重啟
6. 重新觸發一次 health check 驗證新設定

---

## 7. Config 管理

### 檔案定位

- **全域**：`~/.claude-code-router/config.json`
- **專案級**：`{workspaceFolder}/.claude-code-router/config.json`
- **優先順序**：專案級 > 全域
- **UI 切換**：Dashboard 頂部可切換顯示 global / project config

### 檔案監聽

- 使用 `fs.watch` 偵測外部變更
- 外部變更時自動重新載入並更新 UI

### 環境變數處理

- UI 顯示時保持 `$VAR_NAME` 原樣顯示
- Health check 時展開為實際值
- 寫入時保留環境變數語法

---

## 8. CCR Process Manager

### 偵測 CCR 是否在執行

- 透過 `ps aux | grep claude-code-router` 查找 process

### 重啟流程

1. 找到現有 CCR process → `kill`
2. 在 VS Code 內建 terminal 執行 `npx claude-code-router`
3. 等待啟動完成
4. 觸發一次 health check

---

## 9. Extension 設定

```json
{
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
```

---

## 10. 專案結構

```
ccr-monitor/
├── package.json              # Extension manifest
├── tsconfig.json
├── README.md                 # 完整使用說明
├── CHANGELOG.md
├── .vscodeignore
├── resources/
│   └── icon.png
├── src/
│   ├── extension.ts          # activate/deactivate entry point
│   ├── services/
│   │   ├── healthMonitor.ts  # 定時 health check 邏輯
│   │   ├── configManager.ts  # config.json 讀寫與 watch
│   │   └── ccrProcess.ts     # CCR 程序管理（偵測/重啟）
│   ├── views/
│   │   ├── statusBar.ts      # 狀態列管理
│   │   └── webviewPanel.ts   # Webview panel 生命週期與訊息處理
│   ├── webview/
│   │   ├── index.html        # Webview 主頁面
│   │   ├── main.js           # Webview 內 JS 邏輯
│   │   └── style.css         # 樣式（使用 VS Code theme variables）
│   └── types/
│       └── config.ts         # CCR config TypeScript 型別定義
└── docs/
    └── plans/
        └── 2026-03-02-ccr-monitor-design.md
```

---

## 11. 技術選型

| 項目 | 選擇 | 理由 |
|------|------|------|
| 語言 | TypeScript | VS Code 標準，型別安全 |
| Webview | 原生 HTML/CSS/JS | 輕量，無框架依賴 |
| HTTP 請求 | Node.js 原生 http/https | 無額外依賴 |
| 樣式 | VS Code CSS Variables | 自動適配所有 VS Code 主題 |
| 通訊 | postMessage API | Webview ↔ Extension 標準通訊方式 |

---

## 12. 不在範圍內

- 不做自動切換 provider（僅提供快速手動切換）
- 不做 provider 效能歷史記錄圖表
- 不做多 workspace 同步
- 不做 CCR config 的 diff/merge 功能

---

## 13. README 需求

README.md 需包含：

1. **專案簡介** — 套件功能說明
2. **功能截圖** — Dashboard、狀態列、編輯器的截圖
3. **安裝方式** — 從 VSIX 安裝 / 從 marketplace 安裝
4. **前置需求** — Node.js、CCR 已安裝
5. **設定說明** — Extension settings 說明
6. **使用方式** — 如何開啟 Dashboard、如何編輯 config、如何切換 provider
7. **開發建置** — 如何 clone、install、build、package
8. **貢獻指南** — 如何提交 PR
9. **授權條款**
