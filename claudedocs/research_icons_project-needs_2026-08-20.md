# 项目目前需要的图标清单

> 研究产出 · 2026-08-20 · 仅整理，不实现
>
> 数据源：`manager-web/src` 全量 `lucide-react` 引入 + `.research/Icons` 现有 3183 张游戏方块图
> 用途：给后续「图标整合 + 替换」PR 划定边界——当前阶段哪些页面用 lucide 矢量、哪些页面未来要换成游戏方块图。

---

## 1. 当前项目图标基线

### 1.1 矢量图标基线（lucide-react 74 种）

项目当前**所有 UI 矢量图标都来自 `lucide-react`**，无自建图标库。按用途聚合（详见脚本 `icons_summary.py` 输出）：

| 用途分类 | 用到的 lucide-react 图标 |
|---|---|
| 侧栏导航 | `LayoutDashboard`、`Terminal`、`Settings`、`Package`、`Puzzle`、`FolderOpen`、`Rocket`、`Zap`、`User` |
| Dashboard | `Activity`、`Cpu`、`MemoryStick`、`Power`、`PowerOff`、`RotateCw`、`RefreshCw`、`Plug`、`Package`、`CheckCircle2`、`XCircle`、`AlertTriangle`、`Loader2` |
| Mods（Steam 创意工坊） | `Search`、`Star`、`Plus`、`Eye`、`Users`、`Check`、`Download`、`ExternalLink`、`Calendar`、`HardDrive`、`Package` |
| 实例控制 / SteamCMD | `Play`、`Square`、`RefreshCw`、`Save`、`Edit3`、`Loader2`、`Download`、`Pencil`、`AlertCircle`、`Server`、`ShieldCheck`、`Clock`、`Trash2` |
| 文件管理 | `FolderOpen`、`File`、`FileText`、`Upload`、`Globe`、`Key` |
| 控制台（PTY） | `Terminal`、`TerminalIcon`、`Send`、`ArrowRight`、`Megaphone` |
| LDM Mod 框架 | `Puzzle`、`Settings`、`Shield`、`Calendar`、`Folder`、`Hash`、`Package`、`Copy`、`ChevronDown`、`ChevronRight`、`Info`、`AlertTriangle` |
| 通用 UI 件 | `Plus`、`X`、`Save`、`Pencil`、`Trash2`、`Loader2`、`AlertCircle`、`AlertTriangle`、`Check`、`Info`、`Eye`、`EyeOff`、`Search`、`ChevronDown`、`ChevronUp`、`ChevronDownIcon`、`ChevronUpIcon`、`CheckIcon`、`ArrowRight`、`HelpCircle`、`Scissors`、`Settings2`、`UserMinus` |
| 主题切换 | `Sun`、`Moon` |
| 工具调试 | `Wrench`、`Boxes`、`Database` |

> **去重后实际图标种类：74 个**——其中 ~25 个是「通用件」（Plus/X/Save/Pencil 等），其余是功能件。
>
> **lucide-react 总图库 1500+ 个，本项目只引 74 个——非常克制**，整合新图标直接复用现有 import 行。

### 1.2 游戏方块图基线（.research/Icons，3183 张）

| 项 | 现状 |
|---|---|
| 是否被前端代码引用 | **0 处**——`grep` 全仓 `.research/Icons` 零命中 |
| 是否被后端代码引用 | **0 处** |
| 唯一用到 `<img>` 的地方 | `ModCard.tsx` / `ModDetailDialog.tsx`——但只展示 Steam Workshop 返回的缩略图 URL（`previewUrl` 字段），不是 `.research/Icons` |
| 面板物品相关页面当前展示 | **ID 数字 + 中文 label + 内置/自定义徽章**，纯文字标签 |

**结论**：项目当前**完全不显示游戏物品的位图**——这是后续整合的发力点。

---

## 2. 项目目前需要的图标——分两栏

### 2.1 栏 A：UI 矢量图标（lucide-react 现状即足够）

> 这部分**已经完整**，不需要新增 lucide-react 图标，除非有视觉调优诉求。

| 页面 / 组件 | 用到的图标 | 后续整合动作 |
|---|---|---|
| 侧栏（Sidebar） | LayoutDashboard / Terminal / Settings / Package / Puzzle / FolderOpen / Rocket / User | **不替换** |
| Dashboard | Activity / Cpu / MemoryStick / Power / PowerOff / RotateCw / RefreshCw / Plug / CheckCircle2 / XCircle | **不替换** |
| StatCard（所有页面通用） | 父组件传入 `icon: LucideIcon`——见各页面调用 | **不替换** |
| 实时事件状态块 | Activity / AlertTriangle / Package / Power / Plug | **不替换** |
| Steam Mod 浏览 | Star / Eye / Users / Download / ExternalLink / Calendar / HardDrive | **不替换** |
| 实例控制 | Play / Square / RefreshCw / Save / Edit3 / Loader2 | **不替换** |
| SteamCMD 卡 | Download / Pencil / AlertCircle | **不替换** |
| 计划任务 | Clock / Plus / Pencil / Trash2 / AlertCircle | **不替换** |
| 文件管理 | FolderOpen / File / FileText / Upload / Globe / Key | **不替换** |
| 控制台 | Terminal / Send / ArrowRight / Megaphone | **不替换** |
| LDM 框架 | Puzzle / Settings / Shield / Calendar / Folder / Hash / Package / Copy / ChevronDown / ChevronRight / Info / AlertTriangle | **不替换** |
| 通用表单 | Plus / X / Save / Pencil / Trash2 / Loader2 / AlertCircle / AlertTriangle / Check / Eye / EyeOff / Search | **不替换** |
| 登录页 | Loader2 / AlertCircle | **不替换** |
| 信息卡 / 状态卡 / 确认弹窗 | Info / LucideIcon（类型） | **不替换** |

### 2.2 栏 B：游戏物品方块图（项目当前完全未用，是整合发力点）

> 这部分**是真正的「项目目前需要的图标」**，未来会替换下列页面里的纯文字物品标签。

#### B.1 物品 Loadout 编辑器（**首要整合目标**）

文件：`manager-web/src/components/shared/LoadoutEditor.tsx`
相关：`LoadoutItemDialog.tsx`、`ItemListDialog.tsx`

| 位置 | 当前展示 | 整合方案 | 需要的图标类型 |
|---|---|---|---|
| Loadout 条目标签（第 232–256 行） | `<span>{id}</span> <span>{resolveName(id)}</span> ×N` | 加 `<img src={getItemIconUrl(id)} />` 缩略图 16×16 | 食物 / 医疗 / 武器 / 衣服 / 工具……通用 24×24 |
| 物品选择下拉项（LoadoutItemDialog 第 277–313 行） | ID + 中文名 + 内置/自定义徽章 | 列表项左侧加 16×16 缩略图 | 同上 |
| 物品清单管理弹窗（ItemListDialog 第 328–378 行） | ID + 中文名 + 内置/自定义徽章 + 编辑/删除按钮 | 列表项左侧加 20×20 缩略图 | 同上 |

**需要的图标数量级**：Loadout 默认内置物品清单 375 条（项目 wiki label 维护），**至少要 375 张缩略图**才能全覆盖内置物品。`CN_` 系列（1051 张）正好填补这块。

#### B.2 实例控制卡——可补充的物品级视觉

文件：`manager-web/src/components/server-setup/ServerControlCard.tsx`、`U3dsCard.tsx`、`SteamCmdCard.tsx`

这些卡片当前用 lucide（Play/Square/RefreshCw/Download/Pencil）表示「动作」，与游戏物品图无关，**保留矢量图标**。

#### B.3 Mod 详情弹窗

文件：`manager-web/src/components/mods/ModDetailDialog.tsx`、`ModCard.tsx`

当前用 Steam Workshop `previewUrl`（远程缩略图 URL），**已完整**。如果未来要展示 Mod 携带的物品列表缩略图，可以参考 B.1 做法。

#### B.4 LDM 插件卡

文件：`manager-web/src/components/ldm/`

LDM 是**玩家自己上传的 `.dll`**（用户在 GitHub Releases 下载后上传到面板），不是 Steam Workshop 物品，**没有「官方物品图」概念**。LDM 插件卡**保留 lucide 的 Puzzle / Package / Shield** 即可。

#### B.5 实时事件状态块

文件：`manager-web/src/components/dashboard/StatusBlock.tsx`

事件类型用 `Power` / `Activity` / `Package` 等抽象矢量图标——事件本身（启动/停止/Mod 装载/玩家连接）没有具体物品图，**保留矢量图标**。

---

## 3. 整合优先级（建议）

| 优先级 | 场景 | 影响范围 | 工作量估算 |
|---|---|---|---|
| **P0** | Loadout 编辑器（LoadoutEditor + LoadoutItemDialog）物品缩略图 | ConfigPage「开局物品」Tab | 1–2 PR（前端 + 资源打包） |
| **P1** | 物品清单管理弹窗（ItemListDialog）缩略图 | LoadoutEditor 顶部「管理物品清单」按钮 | 与 P0 同 PR 共用组件 |
| **P2** | Mod 详情弹窗 Mod 自带物品清单预览 | ModsPage / ModDetailDialog | 独立 Phase（依赖 Mod 元数据规范） |
| **P3** | 控制台事件流里的 Mod 装载日志配图 | ConsolePage | 视情况 |
| **P4** | 启动时默认服务端的 favicon / 启动欢迎页用 Unturned 主图标 | 全站 favicon | 单独小 PR |

---

## 4. 资产打包策略建议（与第一份文档 §8 对齐）

### 4.1 放置位置

- **运行时目录**：`manager-web/public/items/<id>.png`
- **静态资源目录**（如选择不挂 public）：`shared/assets/items/<id>.png`
- **基地址常量**：`ITEM_ICON_BASE = "/items"`（写进 `lib/utils.ts` 或新建 `lib/itemIcon.ts`）

### 4.2 工具函数

```typescript
// lib/itemIcon.ts（建议）
const ITEM_ICON_BASE = "/items";

/**
 * 把游戏内物品 ID 转成静态图路径。
 * 找不到时返回 null，调用方用 lucide 占位图。
 *
 * @param id - 物品 ID （ushort 0–65535）
 * @returns 静态资源路径或 null
 */
export function getItemIconUrl(id: number): string | null {
  if (!Number.isFinite(id) || id < 0 || id > 65535) return null;
  return `${ITEM_ICON_BASE}/${id}.png`;
}
```

> **不打包全部 3183 张**——只把内置物品清单 + Mod 物品引用过的图打包进 `public/items/`。
> 整合时按需 copy，构建脚本可做：扫描 `ItemListDialog` 的内置物品清单 + `LoadoutEditor` 用户实际填过的 ItemID 集合 → 复制到 `public/items/`。

### 4.3 占位策略

`ItemIcon` 组件封装：

```tsx
// components/shared/ItemIcon.tsx（建议）
<ItemIcon id={item.id} size={20} />
```

- 有图：`<img src={...} />`
- 无图：按物品类型 fallback 到 lucide 图标（武器 `Crosshair` / 医疗 `Heart` / 食物 `Apple` / 衣服 `Shirt`）——颜色按物品类型着色

> 占位 fallback 的「物品类型」分类需要从 `ItemRecord` 扩字段（当前只有 `id` / `name` / `label` / `source`）。若不想改 schema，就用统一灰色 `Package` 占位。

---

## 5. 不要动的图标（保留 lucide）

下列场景**已经清晰、效果验证过**，整合阶段**禁止替换**为游戏方块图：

- 侧栏导航 9 个矢量图标
- Dashboard 系统监控 3 个图标（CPU / 内存 / 活动）
- 实时事件状态块的「启动/停止/玩家/Mod」等抽象事件图标
- 所有 Dialog / Button / Card / Tab 的通用件图标
- LDM 框架的「加载/卸载/配置」动作图标
- 文件管理的「上传/新建文件夹/删除」动作图标

**理由**：这些是**操作图标**（动效语义），不是**物品图标**——它们表达「做什么动作」，游戏方块图表达「这是什么东西」，两者职责不同，混用会破坏视觉一致性。

---

## 6. 总结

| 维度 | 现状 | 整合后 |
|---|---|---|
| 矢量图标 | lucide-react 74 种（克制） | **不变**——继续 lucide-react |
| 物品方块图 | 完全未使用 | **新增到 LoadoutEditor / ItemListDialog / LoadoutItemDialog 三处** |
| 资产打包 | 无 | `public/items/<id>.png`，按需 copy |
| 占位策略 | 纯文字标签 | `<ItemIcon>` 组件，找不到图时 lucide 兜底 |
| 视觉一致性 | 全单色 lucide stroke | 游戏图保持原色 + 16–24px 圆角缩放 |

---

## 7. 行动建议（决策门）

| 选项 | 影响 |
|---|---|
| **A. 直接整合（推荐）** | 按 P0→P1 节奏改 LoadoutEditor/ItemListDialog；1–2 PR；工作量适中 |
| **B. 只整理不整合** | 当前文档已足够；后续遇到需求再实施 |
| **C. 重新评估需求** | 也许「面板不需要显示物品图」也是合理选择——纯文字 ID+名称标签更紧凑；等真实用户反馈再定 |

> 待用户拍板进入 `/sc:design` 或 `/sc:implement`。

---

**研究完成。等待下一步指令。**