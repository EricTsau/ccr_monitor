# CCR 安裝偵測 — 設計文件

**日期**：2026-03-03
**狀態**：已核准

---

## 概述

在 extension 啟動時檢查 CCR npm 套件是否已安裝。如果未安裝，不啟動 health monitor 和其他服務，僅在狀態列顯示「CCR: not installed」提示。

## 偵測方式

執行 `npx claude-code-router --version`（5 秒 timeout）。成功表示已安裝，失敗（command not found 或 timeout）表示未安裝。

## 變更範圍

### 1. `src/types/config.ts`

擴展 `OverallHealth` type，新增 `'not-installed'`：

```typescript
export type OverallHealth = 'all-healthy' | 'partial' | 'all-down' | 'checking' | 'not-installed';
```

### 2. `src/services/ccrProcess.ts`

新增 `isInstalled()` 方法：

```typescript
async isInstalled(): Promise<boolean> {
  try {
    await execAsync('npx claude-code-router --version', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
```

### 3. `src/views/statusBar.ts`

新增 `'not-installed'` 狀態的顯示邏輯：

```typescript
case 'not-installed':
  this._item.text = '$(x) CCR: not installed';
  this._item.backgroundColor = undefined;
  this._item.color = new vscode.ThemeColor('descriptionForeground');
  this._item.tooltip = 'CCR Monitor - Claude Code Router not installed. Click to learn more.';
  break;
```

### 4. `src/extension.ts`

- 將 `activate` 改為 `async function`
- 啟動時先執行 `ccrProcess.isInstalled()`
- 未安裝時 early return，只註冊基本 commands 和狀態列
- 已安裝時走原有正常流程

## 流程圖

```
activate()
  ├─ ccrProcess.isInstalled()
  │    ├─ true  → 正常初始化所有服務
  │    └─ false → statusBar.update('not-installed')
  │               → 僅註冊 commands（避免 command not found）
  │               → return（不啟動 health monitor）
```

## 不在範圍內

- 不做自動安裝 CCR
- 不做定期重新檢查（使用者安裝後需重啟 VS Code）
