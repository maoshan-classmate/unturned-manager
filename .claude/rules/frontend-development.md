---
paths:
  - "manager-web/**"
---

# 前端开发规范

## 组件存放位置

```
manager-web/src/components/
├── ui/          ← shadcn/ui 原生包装（Button / Input / Card / Dialog 等）
│                 直接从 shadcn 官网复制，按需修改源码（如 forwardRef）
├── shared/      ← 跨页面复用的业务组件（PageState / DataTable / SearchInput 等）
│                 提取条件：同一 JSX 模式出现 ≥3 次
├── layout/      ← 全局布局组件（Sidebar / Header / Shell）
└── <feature>/   ← 特定功能/页面的专属组件（如 stats/StatCard）
                  如果只被一个页面使用，可放在页面文件内部
```

新增组件前，先用 `Glob` 列出 `components/shared/` 下已有组件，避免重复造轮子。
修改 `components/ui/` 中的 shadcn 组件时，保持与原版 API 兼容（Props 接口向后兼容）。

## 页面规范

- 页面文件放在 `pages/`，命名 `XxxPage.tsx`
- **所有页面必须用 `<PageState>` 包裹**——禁止手写 loading/error/empty 三件套
- 页面内状态管理：API 数据用 `useServer()` hook，UI 状态用 `useState`
- 路由参数通过 `useParams()` 获取，禁止硬编码路径

## 表单规范

- **所有表单必须使用 `react-hook-form` + `zod`**——LoginPage 是参考样板
- 禁止手写 `useState` 管理表单字段
- Zod schema 放在页面同级 `xxxSchema.ts` 文件中
- 错误显示：`{form.formState.errors.field && <p role="alert" style={{ color: '#EF4444' }}>{...}</p>}`

```tsx
// loginSchema.ts（参考样板）
import { z } from 'zod';
export const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});
export type LoginFormValues = z.infer<typeof loginSchema>;
```

## 样式规范

- **Tailwind class 优先**——禁止在 JSX 中手写 `style={{ backgroundColor: '#1E293B' }}`
- `style={{}}` 仅用于动态计算值（如动态宽度、动画参数）
- 静态颜色/间距全部用 Tailwind utility class
- `cn()` 统一 class 合并——禁止字符串拼接（`className={`base ${dynamic}`}`）
- 全局色值已定义在 `component-abstraction.md` 中，禁止引入新色值
- 全局边框颜色由 `index.css` 的 `* { border-color: #334059 }` 统一控制

## 状态管理

- **AuthContext 模式**是标准——Provider 组件 + 专用 hook + null-guard
- WebSocketContext 需升级为 AuthContext 的 null-guard 模式
- 后续服务端数据迁移到 TanStack Query（`useQuery` / `useMutation`）

## 界面文案规范

> 用户来用面板，不读项目文档。所有可见文案必须按普通玩家能看懂的标准来写。

### 总原则

界面文案面向用户，不得出现项目内部术语、缩写、代号。**判据**：见 `CLAUDE.md` 顶部「⚠️ 全局最高级别约束」段铁律 ①（全局判据同样适用）。

### 术语对照表（独立维护）

行内术语 → 界面用语映射表不在此处维护，**权威在独立活参考文档**：

- **表见** `@claudedocs/reference_ui_terms.md`——一行一个内部术语，列为「内部术语 → 界面用语」两列
- 新增内部术语时，必须在那张表同步加对照——这条不是建议，是强制

### 适用范围

凡是会渲染到屏幕或被屏幕阅读器读出的字符串：

- 按钮文字、图标后的辅助说明
- 卡片标题、表单标签、占位符
- 提示消息（toast、sonner 等）
- 确认弹窗的标题与正文
- 无障碍标签（`aria-label`、`aria-describedby`、`title` 等属性）
- 错误提示文案

### 不适用范围

**保留内部术语是正确的**——项目宪法术语表（`CLAUDE.md` §1）钉死了这些名字，内部沟通需要精确：

- 组件名、文件名、类型与接口名
- 变量名、参数名、常量键
- 提示消息的内部标识（sonner 的 `id`、React `key` 等）
- 接口路径（`/api/steamcmd/install-u3ds` 等）
- 代码注释、JSDoc
- 日志文案（pino logger 调用）

### 跨层提醒

后端抛出的错误消息会被前端原样弹成提示（前端 catch 块读 `err.response.data.error.message` 后塞进 toast）。因此**后端错误消息也受本规范约束**。后端开发规范 (`backend-development.md`) 错误处理节有交叉引用。

### 自查方式

新增或修改界面文案后，按对照表左列逐个在本文件作用域内全局搜索，确认未落到用户可见位置（搜索范围：`manager-web/src/` 与 `manager-web/e2e/`，排除 JSDoc/注释）。命中则改写为人话再提交。

## 组件导出

- **命名导出**——禁止 `export default`（`App.tsx` 除外）
- Props 用 `interface` 定义在组件上方，不导出（跨文件消费的除外）
- 组件文件命名 PascalCase（`SearchInput.tsx`）

## React JSDoc 注释规范

采用**传统 JSDoc**——公共组件和函数必须写完整标签。

### 必须写 JSDoc 的目标

| 目标 | 要求 |
|---|---|
| 页面组件 | `/**` 一行——页面职责，如 `/** 玩家管理页面——表格展示在线玩家，支持踢出/封禁 */` |
| 共享组件 | `/**` 多行——`@param props` + `@returns` + `@example` |
| 自定义 Hooks | `/**` 多行——`@param` + `@returns` + `@example`——说明触发时机和副作用 |
| Props interface | 每个属性 `/**` 单行 |
| 工具函数（lib/） | `/**` 多行——`@param` + `@returns` + `@throws` + `@example` |
| 复杂逻辑/状态机 | `/**` 多行——说明设计意图和边界条件 |

### 格式

**共享组件**:
```tsx
/**
 * 服务器状态统计卡片。
 * 展示单个服务器的在线玩家数、Mod 数和运行状态。
 *
 * @param props - 组件属性
 * @param props.serverId - 服务器实例 ID
 * @param props.onClick - 点击卡片回调，传入 serverId
 * @returns 统计卡片 React 元素；loading 时返回骨架屏
 *
 * @example
 * ```tsx
 * <StatCard serverId="MyServer" onClick={handleSelect} />
 * ```
 */
export function StatCard({ serverId, onClick }: StatCardProps) { ... }

/** StatCard 组件属性 */
interface StatCardProps {
  /** 服务器实例 ID，对应 Servers/<ServerID> 目录名 */
  serverId: string;
  /** 点击卡片时的回调，传入被点击的 serverId */
  onClick?: (serverId: string) => void;
}
```

**自定义 Hook**:
```tsx
/**
 * 订阅指定服务器的实时控制台输出。
 * 通过 WebSocket 接收日志流，自动解析 ANSI 转义序列并着色。
 *
 * @param serverId - 服务器实例 ID，传空字符串时不建立连接
 * @returns 控制台状态——{ lines, sendCommand, clearLines, connected }
 *
 * @example
 * ```tsx
 * const { lines, sendCommand, connected } = useConsole(serverId);
 * ```
 */
export function useConsole(serverId: string): ConsoleState { ... }
```
