## 架构决策记录 (ADR)
1. Panel 与 U3DS 通过共享卷 + RCON 通信，不通过 Agent（同机部署下 Agent 是多余中间层）
2. 多实例通过同一 U3DS 安装目录的不同 ServerID 实现，不通过多容器（节省 10GB×N 磁盘）
3. RCON 优先 OpenMod，RocketMod 作为 fallback（auto-detection）
4. 单用户 JWT 认证，数据库预留 users 表支持未来多用户扩展
5. ServerManager 五状态状态机：STOPPED→STARTING→RUNNING→DEGRADED→STOPPING
6. Files 页（Figma `12:16326`）从 P2 收回 P0——骨干交互功能，没有 Files 无法上传 mod、修改配置传播、调日志看 Workshop 内容。FilesService 是后端 7 模块之一。
7. 设计源头权威在 `docs/architecture/design-system-mapping.md`（figwright 真 Figma 拉取）。PNG 截图只在 `claudedocs/figma-exports/` 当快照留档；实现时**必须从 mapping 文件查色板/component ID/Page ID/路由**，不在 PNG 上猜。

## 关键竞态风险
- 共享卷并发写入：ConfigService + FilesService 双文件级互斥锁
- Mod apply 与手动重启冲突：activeOperation 字段检测
- RCON 断连时命令丢失：Promise reject + 前端禁用输入框
- Files 大文件上传内存爆：分块流式 1MB；并发磁盘 IO：写 `.part` → atomic-rename
- Files 路径穿越：白名单只允许 `Servers/<ID>/` + `Workshop/` + `Logs/`，越界 403

8. 系统架构权威在 `docs/architecture/architecture-spec.md`（C4 模型组件图粒度，2026-08-06 产出，经 5 轮 3-agent 交叉审查），与 `design-system-mapping.md` 并列为架构层两大权威来源
9. 后端 12 模块分 3 层：API 层（WsBroadcaster）→ 核心域层（ServerManager 聚合根 / ConfigService / FilesService / SteamCmdManager / WorkshopMetadataService / LogStreamer / AuthService）→ 基础设施层（RconManager / A2SClient / ProcessSupervisor / FileLockProvider）
10. 模块通信：TypeScript 接口契约（`shared/contracts/`），非 EventEmitter；手动 DI 在 `composition-root.ts`；基础设施层 4 模块实现 `destroy()` 生命周期；核心域层无状态
11. 乐观锁：ConfigService 所有 write 方法接受 `expectedVersion?: number`，config_snapshots.version 做并发控制
12. WorkshopDownloadConfig.json 细粒度权限：面板只写 `File_IDs`（通过 `writeWorkshopFileIds`），其余字段只读

## 配置文件优先级
Commands.dat (启动参数/模式) → Config.txt (游戏玩法/浏览器) → WorkshopDownloadConfig.json (Mod) → Rocket/OpenMod 插件配置

## 计划文件
C:\Users\WINDOWS\.claude\plans\happy-forging-zephyr.md
