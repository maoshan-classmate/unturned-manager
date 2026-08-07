# 前端组件抽象铁律

> 每次新增页面或功能后，必须对照本文档检查是否有可抽象的模式。违反铁律的 PR 不予合并。

## 铁律

### 1. 三行原则
同一 JSX 模式出现 **≥3 次**，必须提取为组件。出现 **2 次**，提取为工具函数。

### 2. 状态容器必须用 PageState
所有页面必须用 `<PageState>` 包裹，禁止手写 loading/error/empty 三件套。
```tsx
// ❌ 禁止
if (loading) return <div className="flex..."><Loader2 />加载中...</div>

// ✅ 必须
<PageState loading={loading} error={error} empty={!data} onRetry={refetch}>
  {children}
</PageState>
```

### 3. 样式禁用手写 hex
卡片容器（`#1E293B` + `#334059`）用 `<Card>` 组件，禁用 inline style 复制粘贴。按钮用 CVA variant，禁止 inline `style={{ backgroundColor: '#22C55E' }}`。

### 4. 对话框用 Dialog/ConfirmDialog
禁止每页写 `fixed inset-0 z-50 bg-black/50`。Dialog 用于通用弹窗，ConfirmDialog 用于确认操作。

### 5. 工具函数放 lib/utils
`formatSize`、`formatDate`、`stateLabel`、`stateColor`、`errorMessage` 已提取。发现新的通用工具函数必须加到这里。

### 6. Tab/搜索输入用共享组件
`<TabBar>` 和 `<SearchInput>` 已抽象。新页面需要 Tab 切换或搜索框时直接用，不要复制 ConfigPage 或 ServerSetupPage 的旧代码。

## 抽象流程

1. **写完功能后自检**：搜索项目中是否有相同的 JSX pattern 重复 ≥3 次
2. **提取到 components/shared/**：组件名 PascalCase，Props 接口完整定义
3. **现有页面替换**：更新所有使用旧 pattern 的页面
4. **typecheck + e2e**：确保零破坏
5. **更新本文档**：新增组件记入下方清单

## 已抽象组件清单

| 组件 | 路径 | 用途 |
|---|---|---|
| PageState | `components/shared/PageState.tsx` | 页面四态容器（loading/error/empty/data） |
| ConfirmDialog | `components/shared/ConfirmDialog.tsx` | 确认弹窗（支持 danger variant） |
| Dialog | `components/shared/Dialog.tsx` | 通用对话框（含 Title/Footer） |
| SearchInput | `components/shared/SearchInput.tsx` | 带搜索图标的输入框 |
| TabBar | `components/shared/TabBar.tsx` | 页面内 Tab 切换 |
| Card | `components/shared/Card.tsx` | 暗色卡片容器（#1E293B + #334059） |

## 已提取工具函数（lib/utils.ts）

| 函数 | 用途 |
|---|---|
| `formatSize(bytes?)` | 文件大小 B→KB→MB |
| `formatDate(iso)` | ISO→YYYY-MM-DD |
| `stateLabel(state)` | 服务端状态→中文 |
| `stateColor(state)` | 服务端状态→色值 |
| `errorMessage(err, fallback)` | 统一错误消息提取 |
| `cn(...inputs)` | Tailwind class 合并 |

## 色值常量（全局统一，禁止新色值）

| 色值 | 用途 |
|---|---|
| `#0F172A` | 页面/输入框背景 |
| `#1E293B` | 卡片/工具栏/弹窗背景 |
| `#334059` | 边框 |
| `#F1F5FB` | 主文本 |
| `#94A3B8` | 次级文本 |
| `#64748B` | 弱化文本/图标 |
| `#22C55E` | 强调色/在线/成功 |
| `#EF4444` | 危险/删除/错误 |
| `#F59E0B` | 警告/进行中 |
| `#3B82F6` | 文件夹图标 |

---

*创建日期：2026-08-07 · 组件抽象 Sprint*
