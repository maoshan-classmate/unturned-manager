---
paths:
  - "manager-server/**"
---

# 后端开发规范

## 模块目录结构

```
manager-server/src/
├── index.ts              ← 入口（Express + ws 启动 + 优雅关闭）
├── config.ts             ← 环境变量校验
├── composition-root.ts   ← DI 容器（手动 constructor 注入）
├── db/                   ← 数据库（connection / migrate / seed / DDL）
├── routes/               ← REST 路由工厂函数（createXxxRouter）
├── middleware/            ← Express 中间件
├── modules/              ← 业务模块（每个模块实现 shared/contracts/ 接口）
│   ├── <name>.ts              ← 单文件模块（简单场景）
│   └── <name>/                ← 子目录模块（需要内部类型/常量/辅助函数时）
│       ├── <Name>Service.ts
│       └── <Name>Service.test.ts
├── ws/                   ← WebSocket 网关
└── utils/                ← 跨模块工具
    ├── logger.ts
    └── AppError.ts        ← 统一错误类
```

## 模块抽象规范

### 抽象触发条件

| 场景 | 条件 | 目标位置 |
|---|---|---|
| 重复的工具逻辑 | ≥2 个模块中出现相同/类似的纯函数 | `utils/`——命名 camelCase，导出命名函数 |
| 重复的路由模式 | ≥2 个路由文件中出现相同的校验/认证/错误处理 | `middleware/`——导出工厂函数 |
| 重复的数据库操作 | ≥2 个模块中 SQL 查询模式一致 | 提取到对应模块的 private 方法；≥3 模块共用→新建共享模块 |
| 重复的错误类型 | ≥2 个模块抛出相同结构的错误 | `utils/AppError.ts`——统一定义 error code + status |
| 重复的配置读取 | ≥2 个模块读取相同环境变量/配置段 | `config.ts` 或新建配置模块 |

### 模块实现规范

- 每个模块是一个 `class`，实现 `shared/contracts/` 中对应的 `I*` 接口
- 依赖通过 constructor 注入，**禁止**在模块内调用 `getDb()` 或引用全局单例
- 有状态模块（如 PtyManager）必须实现 `destroy()` 方法
- 使用 `// ─── 常量 ───` / `// ─── 实现 ───` 分区注释保持可读性
- 模块间通信通过接口，**禁止**跨模块直接 import 具体类

## 错误处理

### AppError 统一错误类

```typescript
// utils/AppError.ts
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  /**
   * @param code - 错误码（kebab-case，如 'server-not-found'）
   * @param message - 面向用户的中文错误描述
   * @param status - HTTP 状态码，默认 500
   */
  constructor(code: string, message: string, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AppError';
  }
}
```

### 使用规范

- 所有业务错误**必须**通过 `throw new AppError(code, message, status)` 抛出
- **禁止** `throw new Error()` 裸抛（路由无法区分错误类型）
- **禁止** `Object.assign(new Error(), { status })` 模式

## 路由规范

### 路由工厂模式

```typescript
// routes/servers.ts
export function createServersRouter(serverManager: IServerManager): Router {
  const router = Router();
  router.get('/', async (req, res) => { ... });
  return router;
}
```

- 路由文件必须是工厂函数 `createXxxRouter(dep1, dep2): Router`
- 响应格式统一：`{ data: ... }` 成功 / `{ error: { code, message } }` 失败
- 使用 `asyncHandler` 包装所有异步路由（消除 try/catch 样板）
- 输入校验使用 Zod schema（`shared/schemas/` 中定义）

### 错误处理中间件

```typescript
// 全局错误处理——注册在路由之后
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  logger.error({ err }, '未捕获错误');
  res.status(500).json({ error: { code: 'internal_error', message: '服务器内部错误' } });
});
```

## 数据库

- 迁移脚本放在 `db/migrations/`，命名 `NNN-描述.sql`
- 每份迁移必须是幂等的（在 `user_version` pragma 保护下）
- 写操作大事务包裹：`db.transaction(() => { ... })`
- 禁止在路由中直接调用 `getDb()`——通过模块接口访问

## 日志

- 使用 `pino`，导入 `utils/logger.ts`
- 结构化日志：`logger.info({ ctx }, 'message')`
- Error 对象放在 `err` 字段：`logger.error({ err, serverId }, '描述')`
- 禁止 `console.log`

## JSDoc 注释规范

采用**传统 JSDoc**——公共方法必须写完整标签。

### 必须写 JSDoc 的目标

| 目标 | 要求 |
|---|---|
| 导出的 class | `/**` 多行——一句话职责 + 关键设计决策 |
| 公共方法 | `/**` 多行——`@param` + `@returns` + `@throws` + `@example` |
| 接口方法（contracts/） | `/**` 单行——方法契约说明 |
| 常量/配置项 | `/**` 单行——用途说明 |
| 复杂算法/状态机 | `/**` 多行——逻辑说明 + 边界条件 |

### 格式

```typescript
/**
 * 向指定 PTY 终端写入数据（ADR-0004 Phase 6：RCON 通道已删，PTY 终端是唯一命令通道）。
 * 同步写入后立即返回——U3DS 响应经 WS console_line 异步回显。
 *
 * @param serverId - PTY key（ServerId 或 jobId）
 * @param data - 原始字符串；不自动加 \r，需要命令被 bash 解析时调用方自行拼上
 *   （如 `'Save\r'`）。node-pty 原样写入 stdin。
 *
 * @example
 * ```typescript
 * ptyManager.write('MyServer', 'Players\r');
 * ```
 */
write(serverId: PtyKey, data: string): void { ... }
```
