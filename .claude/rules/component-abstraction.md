---
paths:
  - "manager-web/**"
---

# 前端组件抽象铁律

> 每次新增页面或功能后，必须对照本文档检查是否有可抽象的模式。违反铁律的 PR 不予合并。

## 铁律

### 1. 三行原则
同一 JSX 模式出现 **≥3 次**，必须提取为组件。出现 **2 次**，提取为工具函数。

### 2. 复用优先
编写任何 UI 之前，先用 `Glob` 列出 `components/shared/` 下的所有组件。
目录中已存在的组件**必须复用**，禁止重新手写。
这包括但不限于：状态容器、弹窗、卡片、输入控件、导航控件等——具体有哪些以目录实际内容为准。

### 3. 样式禁用手写 hex
用 `components/shared/` 中的容器组件承载内容，禁止 inline `style={{ backgroundColor: ... }}`。

### 4. 工具函数放 lib/utils
新增通用工具函数**必须**加到 `manager-web/src/lib/utils.ts`。
开发前用 `Read` 查看该文件，避免重复实现。

### 5. 表单必须用 react-hook-form + zod
所有表单使用 `react-hook-form` + `zod` 校验。
禁止手写 `useState` 管理表单字段。Zod schema 放在页面同级 `xxxSchema.ts` 文件中。实现样板用 `Grep` 搜索项目中 `useForm` 的现有调用。

### 6. 组件 JSDoc 必须完整
共享组件必须写传统 JSDoc：`/**` 多行——`@param props` + `@returns` + `@example`。Props interface 每个属性 `/**` 单行。

## 组件存放位置

```
components/
├── ui/          ← shadcn/ui 原生包装（Button / Input / Card / Dialog 等）
├── shared/      ← 跨页面复用的业务组件（提取条件：≥3 次重复）
├── layout/      ← 全局布局组件（Sidebar 等）
└── <feature>/   ← 特定功能的专属组件（如 stats/StatCard）
```

新增组件前，用 `Glob` 列出 `components/shared/` 目录下已有组件，避免重复。修改 `components/ui/` 中 shadcn 组件时保持与原版 API 兼容。

## 抽象流程

1. **写完功能后自检**：搜索项目中是否有相同的 JSX pattern 重复 ≥3 次
2. **提取到 components/shared/**：组件名 PascalCase，Props 接口完整定义 + JSDoc
3. **现有页面替换**：更新所有使用旧 pattern 的页面
4. **typecheck + e2e**：确保零破坏
5. **更新本文档**：如新增了抽象原则，记入上方铁律列表

## 工具函数

工具函数集中放在 `manager-web/src/lib/utils.ts`。开发前用 `Read` 查看该文件，确认是否已有可复用的工具函数。新增通用工具函数必须加到此文件。

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
*最后更新：2026-08-08——移除硬编码组件清单→目录指向；新增表单强制规范、组件存放位置、JSDoc 要求*
