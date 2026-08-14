# Loadout 编辑器改造 + 物品清单库 — 设计

> 技术名词保留原文；需求决策锁定在 §2，本设计只在其上展开，不重开已定结论。

---

## 1. 背景与真源

Commands.dat 的 `Loadout` 命令：`Loadout <SkillsetID>/<itemID>/<itemID>...`。

| 事实 | 真源 |
|---|---|
| 技能组共 11 个（`NONE(0)`–`MEDIC(10)`），无 255 枚举成员 | `EPlayerSkillset.cs:10-23` |
| `skillsetID == 255` → 写基础 `loadout` 槽；`0-10` → 写 `skillsets[ID]` 槽 | `CommandLoadout.cs:42-49` |
| 出生分发 `bestowLoadout()` 是 `if/else if`：基础层非空时**跳过**技能组分支 → 255 与技能组**互斥** | `PlayerInventory.cs:1398-1456` |
| 不同技能组写不同槽位、玩家只读自己技能组的槽 → 多技能组并存**各自生效** | `CommandLoadout.cs:48` + `PlayerInventory.cs:1426` |
| wiki 正式命名：ID 255 = 「All Skillsets」（对所有技能组生效） | `unturned.wiki.gg/wiki/Skills` + `/wiki/Commands` |
| SDK 默认：`LOADOUT={}` + `SKILLSETS_SERVER=[[]×11]` → 开局无额外物品 | `PlayerInventory.cs:30-32` |

## 2. 需求决策（11 项，已锁定）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 新条目默认技能组 | 255（所有技能组） |
| D2 | 加完自动跳「无技能(0)」 | BUG，修复 |
| D3 | 给已有技能组追加物品 | 支持（✏️ → 物品选择 dialog 预填） |
| D4 | 255 与技能组并存 | 互斥禁止；技能组之间自由并存 |
| D5 | 物品数据源 | 持久化物品清单（内置种子 + 自定义 CRUD）+ 手输兜底 |
| D6 | Mod 物品 | 下拉与手输并列 |
| D7 | 添加交互 | 技能组 → 添加 → dialog 选物品成标签 |
| D8 | 标签修改 | 删除标签重选 |
| D9 | 清单 CRUD 入口 | 开局物品区块内「管理物品清单」按钮 |
| D10 | 序列化 | `Loadout <skillsetId>/<id>/...` 纯数字；名称按清单反查，未命中「未知物品」 |
| D11 | 内置权限 | 内置只读；自定义 ID+名称可编辑、可删除 |

## 3. 总体架构

```
前端                                                   后端
┌─────────────────────────────┐   GET/PUT /api/servers/:id/config/commands   ┌──────────────────────┐
│ ConfigPage › Commands.dat   │ ──────────────────────────────────────────→ │ ConfigService         │
│ └─ LoadoutEditor（改造）     │                                             │  ├─ writeCommandsDat  │
│    ├─ 物品选择 LoadoutItemDialog │                                           │  └─ ★255 互斥校验     │
│    ├─ 清单管理 ItemListDialog │                                             └──────────────────────┘
│    └─ useItems()            │
│          │                  │   GET/POST/PUT/DELETE /api/items             ┌──────────────────────┐
│          └──────────────────│ ──────────────────────────────────────────→ │ ItemService（新）     │
│                             │                                             │  ├─ item_list 表       │
│                             │                                             │  ├─ 内置只读规则       │
│                             │                                             │  └─ seedBuiltinItems()│
└─────────────────────────────┘                                             └──────────────────────┘
```

- 物品清单是**全局一份**（物品 ID 是游戏全局的，不随服务器实例变化）。
- `loadouts` 仍走现有 `CommandsDatRecordSchema`，**数据契约不变**；物品清单只做「名称展示」与「选择器数据源」。

---

## 4. 后端设计

### 4.1 DB 迁移 `006-add-item-list.sql`

```sql
-- 006: 物品清单表（全局唯一；内置种子只读，自定义可 CRUD）
CREATE TABLE IF NOT EXISTS item_list (
  id         INTEGER PRIMARY KEY,              -- 物品 ID（0–65535，天然唯一）
  name       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'custom'    -- 'builtin' | 'custom'
               CHECK (source IN ('builtin','custom')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_item_list_source ON item_list(source);
CREATE INDEX IF NOT EXISTS idx_item_list_name   ON item_list(name);
```

`id` 用 INTEGER PRIMARY KEY（rowid 别名）自带唯一约束，无需单独 UNIQUE 索引。

### 4.2 共享契约 `shared/contracts/items.ts`

```typescript
/** 物品来源：内置种子（只读）| 用户自定义（可 CRUD） */
export type ItemSource = 'builtin' | 'custom';

/** 物品清单记录 */
export interface ItemRecord {
  /** 物品 ID（0–65535） */
  id: number;
  /** 显示名（如「手枪」） */
  name: string;
  /** 来源——驱动只读规则 */
  source: ItemSource;
}

export interface IItemService {
  /** 全量物品清单（按 ID 升序）——客户端搜索用，量级几百条，无需分页 */
  listItems(): ItemRecord[];
  /** 新增自定义物品；ID 已存在 → AppError 409 */
  createItem(input: { id: number; name: string }): ItemRecord;
  /** 修改自定义物品（ID 或名称，至少一项）；内置 → 403；新 ID 冲突 → 409 */
  updateItem(id: number, input: { id?: number; name?: string }): ItemRecord;
  /** 删除自定义物品；内置 → 403 */
  deleteItem(id: number): void;
  /** 播种内置种子（INSERT OR IGNORE，幂等）——composition-root 启动调用 */
  seedBuiltinItems(): void;
}
```

### 4.3 共享 schema `shared/schemas/items.schema.ts`

```typescript
import { z } from 'zod';

export const ItemRecordSchema = z.object({
  id: z.number().int().min(0).max(65535),
  name: z.string().min(1, '名称不能为空').max(64, '名称不能超过 64 字'),
  source: z.enum(['builtin', 'custom']),
});
export type ItemRecordDto = z.infer<typeof ItemRecordSchema>;

export const CreateItemSchema = z.object({
  id: z.number().int().min(0, '物品 ID 需为 0–65535 整数').max(65535, '物品 ID 需为 0–65535 整数'),
  name: z.string().min(1, '名称不能为空').max(64, '名称不能超过 64 字'),
});
export type CreateItemInput = z.infer<typeof CreateItemSchema>;

export const UpdateItemSchema = z.object({
  id: z.number().int().min(0).max(65535).optional(),
  name: z.string().min(1).max(64).optional(),
}).refine((d) => d.id !== undefined || d.name !== undefined, {
  message: '至少修改一项',
});
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
```

### 4.4 模块 `modules/items/ItemService.ts`

```typescript
/**
 * 物品清单服务——全局物品 ID → 名称映射（开局物品选择器 + 名称反查共用）。
 * 内置种子只读（D11）：builtin 行禁止 create/update/delete。
 *
 * 设计决策：
 * - 同步 SQL（better-sqlite3），路由直接返回，不引 async 样板。
 * - 内置只读是**服务端硬规则**（不是前端禁用就够）——API 层绕过也会被拦。
 */
export class ItemService implements IItemService { ... }
```

**规则明细：**

| 操作 | 规则 | 错误 |
|---|---|---|
| `listItems` | `SELECT id,name,source FROM item_list ORDER BY id` | — |
| `createItem` | 校验 ID 未存在；`INSERT (id,name,source='custom')`；唯一冲突 → 409 | `item-id-exists` |
| `updateItem(id, input)` | 行不存在 → 404；`source='builtin'` → 403；改 ID 时校验新 ID 唯一；`UPDATE` | `item-not-found` / `builtin-item-readonly` / `item-id-exists` |
| `deleteItem(id)` | 行不存在 → 404；`source='builtin'` → 403；`DELETE` | 同上 |
| `seedBuiltinItems` | 遍历 `itemSeed.ts` 内置表 `INSERT OR IGNORE`（幂等、可自愈） | — |

**错误码 → 用户可见文案（frontend-development §界面文案规范）：**

| code | message |
|---|---|
| `item-id-exists` | 「该物品 ID 已存在」 |
| `item-not-found` | 「物品不存在」 |
| `builtin-item-readonly` | 「内置物品不可修改，只能管理自定义物品」 |

### 4.5 路由 `routes/items.ts`

```typescript
export function createItemsRouter(itemService: IItemService): Router {
  const router = Router();
  router.get('/',    (req, res) => res.json({ data: itemService.listItems() }));
  router.post('/',   validate(CreateItemSchema), (req, res) => res.status(201).json({ data: itemService.createItem(req.body) }));
  router.put('/:id', validate(UpdateItemSchema), (req, res) => res.json({ data: itemService.updateItem(Number(req.params.id), req.body) }));
  router.delete('/:id', (req, res) => { itemService.deleteItem(Number(req.params.id)); res.status(204).end(); });
  return router;
}
```

- 响应统一 `{ data }` / `{ error: { code, message } }`（backend-development §路由规范）
- `:id` 用 `Number()` 后交给 service；非数字由 zod/route 处理为 404/400（实现时按 `validate` 中间件惯例对齐）
- 鉴权：与其它路由一致在 `index.ts` 挂载时套 JWT 中间件

### 4.6 种子数据 `modules/items/itemSeed.ts`

```typescript
/**
 * 内置物品种子（只读 source='builtin'）——unturned.wiki.gg 采集的 vanilla 常用物品。
 * name  = wiki 英文源名（权威）；label = 中文显示名（仅前端 UI 显示，不进 Commands.dat）
 * 未译项 label 缺省 → 前端回落显示 name。
 */
export const BUILTIN_ITEMS: ReadonlyArray<{ id: number; name: string; label?: string }> = [...];
```

- **生成方式**：curl 直连 wiki.gg **MediaWiki API**（绕过代理/限流，自定义 User-Agent）→ 遍历 `Category:Items` 15 个子类 → 逐页 wikitext 抽 infobox `Internal ID` → **373 条**（370 条配中文 label）。
- **权威校验**：ID 与 U3-SDK `PlayerInventory.cs` SKILLSETS_CLIENT 交叉核验全吻合；排除载具武器/开发测试物 4 条。
- **label 语义**：`label` 列（迁移 007）存中文显示名，**只用于前端 UI 显示**，序列化 Commands.dat 仍只写数字 ID；前端 `label ?? name` 兜底。
- **播种时机**：composition-root 构造 `ItemService` 后调用 `seedBuiltinItems()`（幂等）。内置只读 → 用户删不掉 → 无需「重新导入」按钮（D11 简化）。

### 4.7 装配

- `composition-root.ts`：`AppContainer` 加 `itemService: IItemService`；构造 `new ItemService(db)` 后 `itemService.seedBuiltinItems()`。
- `index.ts`：`app.use('/api/items', authMiddleware, createItemsRouter(itemService))`。

### 4.8 ★ 255 互斥的保存侧校验（D4 后端兜底）

`ConfigService.writeCommandsDat` 现有序列化逻辑加一步校验：

```typescript
const has255 = loadouts.some((l) => l.skillsetId === 255);
const hasSkillset = loadouts.some((l) => l.skillsetId !== 255);
if (has255 && hasSkillset) {
  throw new AppError('loadout-mutually-exclusive',
    '「所有技能组」与具体技能组不能同时配置——技能组条目会被覆盖、实际不生效',
    400);
}
```

- 前端禁用是主防线；此校验防 API 层绕过（单用户系统下主要是防御性）。
- **已知边界**：若用户磁盘上的 Commands.dat 本就同时含 255 + 技能组，加载显示冲突态，**保存时会被拦**——属期望行为（迫使用户先消解冲突），提示文案引导处理。

---

## 5. 前端设计

### 5.1 数据层

`manager-web/src/api/items.ts`（走 `apiClient`，baseURL `/api`）：

```typescript
export async function fetchItems(): Promise<ItemRecord[]> { /* GET /items → res.data.data */ }
export async function createItem(input: CreateItemInput) { /* POST /items */ }
export async function updateItem(id: number, input: UpdateItemInput) { /* PUT /items/:id */ }
export async function deleteItem(id: number) { /* DELETE /items/:id */ }
```

`manager-web/src/hooks/useItems.ts`：

```typescript
/** 物品清单加载 + CRUD 后 reload——ConfigPage 不需要感知，LoadoutEditor 内部自持 */
export function useItems() {
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [loading, setLoading] = useState(false);
  // 挂载时 fetchItems()；reload() 供 CRUD 后刷新
  return { items, loading, reload };
}
```

### 5.2 组件结构（均在 `components/shared/`，与 LoadoutEditor 同簇）

| 组件 | 职责 | 说明 |
|---|---|---|
| `LoadoutEditor`（改造） | 条目列表 + 添加/编辑/删除 + 255 互斥 + 两个 dialog 的编排 | props 不变（`loadouts`/`onChange`），内部自持 `useItems()` |
| `LoadoutItemDialog`（新） | 单技能组的物品选择 dialog | 已有标签 + 搜索/手输 + 多标签 + 保存/取消 |
| `ItemListDialog`（新） | 物品清单管理 dialog | 搜索 + 列表 + 新增 + 编辑 + 删除 |

> 组织说明：三个组件只被 ConfigPage 使用，按「三行原则」不满足 shared 提取条件；但 LoadoutEditor 已在 `components/shared/`，新 dialog 与其强内聚，跟随同簇放置（避免跨目录分裂同一功能的组件）。

### 5.3 交互流

**添加新技能组 / 追加物品（D3、D7）：**

```
[+ 添加开局物品]  ──▶ 下拉：未配置技能组（默认 255）──▶ 选中
条目行 ✏️  ──▶ 打开 LoadoutItemDialog（预填该技能组已有标签）
                        │
                        ▼
   LoadoutItemDialog:
     · 标签区：已有物品标签（ID + 名称，未知 → 「未知物品」）
     · 输入框：搜索内置+自定义清单（按 ID/名称子串）或直接输整数 ID
        · 选中下拉项 / 输入合法整数 → 回车 → 加标签
        · 已存在同 ID → 忽略（不重复）
     · [保存] → onSave(itemIds) → onChange 更新 loadouts 数组
       [取消] → 丢弃
```

**物品清单管理（D9、D11）：**

```
[管理物品清单]（区块标题右侧）──▶ ItemListDialog:
     · 搜索框（SearchInput）过滤 ID/名称
     · 行：来源徽章（内置/自定义）+ ID + 名称 + [✏️][🗑]
        · 内置：只读（无操作按钮）
        · 自定义：✏️ → 编辑（ID + 名称可改）、🗑 → ConfirmDialog 删除
     · [+ 新增物品] → 表单（ID + 名称），ID 唯一校验
     · 任何改动 → reload() 刷新 useItems → LoadoutEditor 标签名称即时更新
```

**255 互斥（D4）——LoadoutEditor 渲染逻辑：**

```
has255      = loadouts 含 skillsetId 255
hasSkillset = loadouts 含 0-10 任一

· has255 = true：
    技能组 0-10 条目 → 灰显 + 禁用 ✏️（仍可见，标明被覆盖）
    添加下拉 → 只列 255（已用则隐藏），技能组选项禁用
    顶部提示：「已配置所有技能组通用包，具体技能组条目会被覆盖」
· hasSkillset = true 且 255 未用：
    添加下拉的 255 选项 → 禁用 + tooltip 提示原因
· 后端 writeCommandsDat 二次校验兜底（§4.8）
```

**D2 修复（默认跳转）：**
新条目默认技能组 = 255（未用）；255 已用则取第一个未用技能组（升序）。不再出现「加完跳无技能(0)」。

### 5.4 LoadoutItemDialog 输入框行为（关键交互）

| 输入 | 下拉展示 | 回车效果 |
|---|---|---|
| `1` | 高亮「1 手枪」等 ID/名称含 `1` 的项 | 提交高亮项 → 标签「1 手枪」 |
| `99999`（清单外合法整数） | 无匹配项 | 提交原始 ID → 标签「99999 未知物品」（Mod 物品 D6） |
| `abc` | 无匹配、非整数 | 忽略（不产生标签） |

- 下拉过滤：`id.toString().includes(q) || name.includes(q)`（大小写不敏感）
- 提交后输入框清空，可连续添加；标签可单独删除（×）；重复 ID 自动忽略
- 支持方向键选择下拉项 + Enter 提交；`Backspace` 空输入时删除最后一个标签（顺手项）

### 5.5 界面文案（frontend-development §界面文案规范）

新出现的用户可见词：`物品清单`、`管理物品清单`、`所有技能组`、`未知物品`、`自定义物品`、`内置物品`、`物品 ID`、`物品名称`、`开局物品`。

- 术语表 `reference_ui_terms.md` 同步新增：`Loadout → 开局物品`、`All Skillsets(255) → 所有技能组`、`item_list → 物品清单`、`builtin → 内置`、`custom → 自定义`、`未知物品 → 未知物品（ID 不在清单内）`。
- `LoadoutEditor.tsx` 现有 JSDoc/注释里的「255 = 默认全部技能组」表述改为与 wiki 一致的「255 = 所有技能组」，消除「默认」歧义。

### 5.6 测试计划

| 层 | 用例 |
|---|---|
| 后端 `ItemService.test.ts` | list 升序 / create 成功 / create 重复 ID→409 / update 改名 / update 改 ID 冲突→409 / update 内置→403 / delete 内置→403 / delete 不存在→404 / seed 幂等 |
| 后端 `ConfigService` 扩展 | writeCommandsDat：255+技能组并存 → 抛 `loadout-mutually-exclusive` |
| 后端路由 | items CRUD 四端点响应形态 + zod 校验 400 |
| 前端 `LoadoutItemDialog.test` | 选中项回车加标签 / 原始 ID 加「未知物品」/ 重复忽略 / 删除标签 / 保存取消 |
| 前端 `ItemListDialog.test` | 搜索过滤 / 新增 / 编辑改 ID / 内置只读无按钮 / 删除确认 |
| 前端 `LoadoutEditor.test` | 255 互斥灰显 + 添加禁用 / 加完默认不跳 0 / ✏️ 追加 / 🗑 删除 |
| E2E（playwright） | 冒烟：ConfigPage → 添加开局物品 → dialog 选物品 → 保存 → 回读断言 |

---

## 6. 实施顺序

| 里程碑 | 内容 | 验证 |
|---|---|---|
| **M1 后端** | 迁移 006 + 契约 + schema + ItemService + 路由 + seed 骨架 + composition-root 装配 + ConfigService 255 校验 | 后端 typecheck + 单测 |
| **M2 前端核心** | useItems + api/items + LoadoutItemDialog + LoadoutEditor 改造（列表/添加/编辑/删除/255 互斥/D2 修复） | 前端 typecheck + 组件单测 |
| **M3 清单管理** | ItemListDialog（搜索/新增/编辑/删除/内置只读） | 前端单测 |
| **M4 种子内容** | wiki.gg 采集脚本 → `itemSeed.ts` 生成 + 人工抽检 | seed 单测 + 手动核对 |
| **M5 文案/收尾** | reference_ui_terms.md 同步 + JSDoc/注释对齐 + e2e 冒烟 + 文档过时检测 | 双端 typecheck + 全量测试 |

## 7. 开放问题 / 后续

- 种子内容覆盖面（目标几百条常用 vanilla 物品）——M4 采集时按 wiki 分类过滤，具体阈值实施时定。
- 名称仅前端反查展示，未持久化到 `LoadoutEntry`——若后续需要跨端一致显示（如服务器列表页展示开局物品），再议是否在 loadouts 附带名称缓存。
- 255 互斥的后端校验是**保存即拦**；若将来要支持「先配好技能组、后切到 255」的临时共存，需改此校验为警告级——当前按 D4 锁定为禁止。
