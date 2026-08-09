# Session Checkpoint 2026-08-08-b

## 会话成果

按 `docs/adr/0002-api-fix-phase0.md` 设计，完成 Phase 0–3 共 4 张实施卡的全部开发和测试。

### 卡 A：Phase 0·主干修复（12 步）
- 新建 `utils/AppError.ts` + `middleware/{asyncHandler,validate,errorHandler,noCache}.ts`
- `shared/types/domain.ts` `Map<>` → `Record<>`（修复 C3/C4 契约断裂）
- `ConfigService.ts` 解析/序列化适配 Record
- 全部 `routes/*.ts` 接入 Zod + asyncHandler
- 新增 `/rcon/execute` 别名（修复 C1）、`/files/raw` multipart+Range（修复 C7）、`/players` 端点、`/auth/change-password`、`/audit-logs`、`/settings/webapi-key`
- `gateway.ts` WS subscribe 协议 + 5s timeout（修复 C8）
- `index.ts` LogStreamer 接线 + 全局 noCache 中间件
- `routes/servers.ts` 全量 Zod 接入

### 卡 B：Phase 2·Mod apply 流水线
- `ServerManager.applyModChanges` 9 步实装（backup→writeFileIds→Say→倒计时→Save→Shutdown→waitForExit→spawn→完成广播）
- `routes/mods.ts` Zod + asyncHandler
- 前端 `ModsPage.tsx` 改调 `POST /apply`（修复 C5）
- 前端 `WebSocketContext.tsx` 建连后发 subscribe

### 卡 C：Phase 3·SteamCMD + Workshop
- `SteamCmdManager` 真 spawn（GSM3 +runscript 模式）+ 进度解析 + `downloadWorkshopItem`
- `WorkshopMetadataService` 切 `IPublishedFileService/GetDetails/v1`（替代废弃 `?xml=1`）
- `cryptoBox.ts` AES-256-GCM + `settings` 表（003 migration）+ WebAPI Key 存取
- `routes/steamcmd.ts` 加 `/download-workshop` 端点

### 卡 D：Phase 4·测试与部署基线
- vitest 配置 + 34 条单测（ServerManager 9 + ConfigService 6 + Utilities 9 + API smoke 10）
- playwright e2e 10 条（login→CRUD→Zod→health→logout）
- `Dockerfile` 3 阶段构建
- `tests/e2e/e2e-checklist.md` D1-D9 验收清单
- **注意**：docker-compose.yml 列入延后（Windows 端无 Docker 环境）

### 手动测试期间修复的 Bug
1. Settings 改密码 `setTimeout` 假实现 → 接 `/auth/change-password`
2. `/change-password` 缺 `authenticateToken` 中间件
3. Vite proxy 端口 3001→3099（修复前端登录 500）
4. 系统代理 `192.168.2.9:7890` 缓存 → 全局 `noCache` 中间件
5. Players/Config/Mods 无服务器时整页替换 → 骨架常驻 + 按钮 disabled
6. Players 页面假 demo 数据 → 删除
7. Dashboard 已装 Mod 卡写死 `—` → 接 `/config/workshop`
8. Dashboard 图表标"(Sprint 3)"过期标签 → 更新
9. FilesPage base64→atob 破坏二进制 → 改 `/files/raw` FormData
10. 手动测试服务器使用 `tests/e2e/test-server.ts`（全路由挂载 + 文件 DB）

## 当前状态
- **COMMIT 锁定**：开发+验证完成前不得 commit。所有 4 卡已完成，typecheck 全绿，vitest 34/34、playwright 10/10
- **前后端运行中**：后端 `localhost:3098`，前端 `localhost:5174`，用户 admin/admin123
- **待 Sprint 5 Linux 实机验证**：spawn/RCON/WS/U3DS 启动流程

## 关键文件变更总计
新增 ~20 文件，修改 ~25 文件。详见 `docs/adr/0002-api-fix-phase0.md`。
