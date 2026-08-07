# Sprint 2 工作流：Sidebar Figma 1:1 复刻

> 产出时间：2026-08-07  
> 触发：`/sc:workflow --think-hard`  
> 状态：📋 计划阶段（待 `/sc:implement` 执行）

---

## Phase 0：前置清理（2 项，< 5 分钟）

> 来源：`/sc:reflect` 待处理清单

### Task 0.1 — 清理 REVIEW.md
- **文件**：`manager-web/REVIEW.md`
- **操作**：删除（所有 8 项发现已修复，代码审查报告已无未解决问题）
- **验证**：`git status` 确认 `REVIEW.md` 不再出现

### Task 0.2 — PasswordInput 补充 required 属性
- **文件**：`src/pages/LoginPage.tsx` Line 196-207
- **操作**：在 `<PasswordInput>` 上加 `required` 属性（与 username Input Line 163 的 `required` 一致）
- **修改**：
  ```tsx
  <PasswordInput
    id="login-password"
    required    // ← 新增
    ...
  ```
- **验证**：React DevTools 确认 DOM 上有 `required` 属性

---

## Phase 1：Sidebar Figma 1:1 复刻（核心）

### Figma 权威数据源

| 属性 | Figma 值 | 当前代码 | 偏差 |
|---|---|---|---|
| **宽度** | 260px | 260px | ✅ 一致 |
| **背景** | `#020617` (bg-slate-950) | `bg-slate-950` | ✅ 一致 |
| **Logo 文字** | `"UNTURNED MANAGER"` UPPERCASE | `"unturned-manager"` lowercase | ❌ 大小写 |
| **Logo 字体** | Inter Regular 12px | `text-lg font-semibold` (18px) | ❌ 字号/字重 |
| **Logo 颜色** | `#22C55E` emerald-500 | `text-emerald-500` | ✅ 一致 |
| **Logo 位置** | x=24, y=20（无边框分隔） | 带 `border-b border-slate-800` | ❌ 多余分隔线 |
| **Server 选择器** | `chevron-down` icon + "MyServer ● 在线" | **缺失** | ❌ 未实现 |
| **导航 labels** | 中文（仪表盘/控制台/玩家/配置/模组/文件/权限/服务器设置/系统设置） | 英文 | ❌ 语言 |
| **导航排序** | 仪表盘→控制台→玩家→配置→模组→**文件**→**权限**→服务器设置→系统设置 | Dashboard→Console→Mods→Players→Config→Files→Server Setup→Settings | ❌ 排序 |
| **导航项数** | 9 项（含 权限） | 8 项（缺权限） | ❌ 缺项 |
| **图标大小** | 16×16px | `size={18}` | ❌ 大 2px |
| **图标颜色(active)** | emerald-500 | emerald-500 | ✅ 一致 |
| **图标颜色(inactive)** | `#94A3B8` (text-secondary) | `text-slate-400` | ⚠️ 微偏 |
| **文字字体** | Inter Regular 14px | `text-sm font-medium` | ⚠️ 应是 Regular |
| **Active 指示器** | 3×22px 矩形，emerald-500，x=0 | `border-l-[3px] border-emerald-500` | ⚠️ 接近但不精确 |
| **项目间距** | y 间隔 40px (80→120→160...) | `space-y-1` (4px) | ❌ 太密 |
| **项目内边距** | 无 padding/bg，纯 icon+text 水平排列 | `px-3 py-2 rounded-md` + hover bg | ❌ 多余背景 |
| **水平内边距** | icon x=24, text x=48（左 24px 开始） | `px-3` (12px) | ❌ 太少 |
| **分割线** | x=24, y=460, 212×1px, `#1E293B` | `border-t border-slate-800` | ⚠️ 接近 |
| **底部用户区** | icon/user 16px + "管理员" 13px Regular | `LogOut` icon + "登出" button | ❌ 完全不同 |
| **Hover 行为** | Figma 无 hover 态（需推断） | hover bg + color change | ⚠️ 需保留可用性 |

### Task 1.1 — 重写 `Sidebar.tsx`（完整替换）

**文件**：`src/components/layout/Sidebar.tsx`（77 行 → 预计 ~120 行）

**Figma 精确布局规范**：

```
┌─ Sidebar 260×900 ─────────────────────────────┐
│                                                │
│  [24,20] UNTURNED MANAGER                      │  ← 12px Regular emerald-500
│                                                │
│  [24,48] ▽ [48,48] MyServer  ● 在线           │  ← Server 选择器 12px
│                                                │
│  ┃ [24,80] 田 [48,80] 仪表盘                   │  ← Active: 3px left bar + emerald-500
│    [24,120] >_ [48,120] 控制台                 │  ← Inactive: #94A3B8
│    [24,160] 👥 [48,160] 玩家                   │
│    [24,200] ⚙ [48,200] 配置                    │
│    [24,240] 📦 [48,240] 模组                   │
│    [24,280] 📁 [48,280] 文件                   │
│    [24,320] 🔑 [48,320] 权限                   │
│    [24,380] 🚀 [48,380] 服务器设置              │
│    [24,420] ⚡ [48,420] 系统设置                │
│                                                │
│  ───────────── [24,460] 212×1 ────────────     │  ← Divider #1E293B
│                                                │
│    [24,480] 👤 [48,480] 管理员                  │  ← User 13px
│                                                │
└────────────────────────────────────────────────┘
```

**实现细节**：

1. **Logo 区域**（无底部边框）
   - 12px Inter Regular, UPPERCASE, emerald-500
   - 位置：`px-6 pt-5 pb-0` → y=20

2. **Server 选择器**（新增）
   - `ChevronDown` icon 16px + 文字 "MyServer ● 在线" 12px
   - 绿色圆点用 `<span>` + `bg-emerald-500 rounded-full w-2 h-2`
   - 包装为 `<button>` 语义（将来用于下拉切换）
   - 位置：y=48

3. **导航项**
   - 每项高度：~22px（文字 17px + active indicator 22px）
   - 间距：`gap-[18px]` 或每个 `py-[9px]` 实现 40px 节距
   - 结构：`<NavLink>` 内无 padding 无背景
   - Active 态：左侧 3px 竖条 + 文字/图标变 emerald-500
   - Hover 态：文字变 `text-slate-200`（保留 hover 反馈，Figma 没画但必须有）
   - 字体：14px Regular

4. **分割线**
   - 全宽左留 24px：`mx-6 h-px bg-slate-800`

5. **底部用户区**
   - `User` icon 16px + "管理员" 13px Regular
   - 无交互（纯展示），`text-slate-400`

**Lucide 图标映射**：
| Figma icon | Lucide |
|---|---|
| icon/layout-dashboard | `LayoutDashboard` |
| icon/terminal | `Terminal` |
| icon/users | `Users` |
| icon/settings | `Settings` |
| icon/package | `Package` |
| icon/folder | `FolderOpen` |
| icon/key | `Key`（新增） |
| icon/rocket | `Rocket` |
| icon/zap | `Zap` |
| icon/chevron-down | `ChevronDown`（新增） |
| icon/user | `User` |

### Task 1.2 — 更新 `App.tsx` 路由

**文件**：`src/App.tsx`

- 确保所有 9 条路由都有对应 `<Route>`（当前缺 `/permissions`）
- 导航 label 中文排序对齐 Sidebar

### Task 1.3 — 验证（3 步）

1. **TypeScript 编译**：`tsc --noEmit` 零错误
2. **Figma 比对截图**：`browser-harness` 截 Sidebar → 与 Figma 5:29 导出图对比
3. **交互验证**：路由切换正常、active 指示器位置正确

---

## Phase 2：Code Review & Close

### Task 2.1 — 自检清单
- [ ] Logo 12px Regular UPPERCASE
- [ ] Server 选择器存在且样式正确
- [ ] 9 项导航，中文 label，正确排序
- [ ] Icon 16px，颜色分 active/inactive
- [ ] Active 指示器 3px 左竖条 emerald-500
- [ ] 项目间距 40px
- [ ] 无多余的 rounded/padding/bg
- [ ] 分割线在正确位置
- [ ] 底部显示用户名（非登出按钮）
- [ ] 无 `any` 类型
- [ ] 无未使用 import

### Task 2.2 — Code Reviewer 验证（≥1 agent）

---

## 依赖关系

```
Phase 0 (Task 0.1, 0.2)  ← 独立，可先做
       ↓
Phase 1 (Task 1.1 → 1.2 → 1.3)  ← 顺序依赖
       ↓
Phase 2 (Task 2.1 → 2.2)  ← 验证闭环
```

## 影响范围

| 文件 | 操作 | 风险 |
|---|---|---|
| `manager-web/REVIEW.md` | 删除 | 低 |
| `src/pages/LoginPage.tsx` | 1 行修改 | 极低 |
| `src/components/layout/Sidebar.tsx` | 完整重写 | 中 |
| `src/App.tsx` | 路由微调 | 低 |

## 预计工时

| Phase | 预估 |
|---|---|
| Phase 0 | 5 分钟 |
| Phase 1 | 30-45 分钟 |
| Phase 2 | 10-15 分钟 |
| **合计** | **45-65 分钟** |
