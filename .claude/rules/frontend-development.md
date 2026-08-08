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
