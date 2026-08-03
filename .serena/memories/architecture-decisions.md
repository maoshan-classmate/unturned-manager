## 架构决策记录 (ADR)
1. Panel 与 U3DS 通过共享卷 + RCON 通信，不通过 Agent（同机部署下 Agent 是多余中间层）
2. 多实例通过同一 U3DS 安装目录的不同 ServerID 实现，不通过多容器（节省 10GB×N 磁盘）
3. RCON 优先 OpenMod，RocketMod 作为 fallback（auto-detection）
4. 单用户 JWT 认证，数据库预留 users 表支持未来多用户扩展
5. ServerManager 五状态状态机：STOPPED→STARTING→RUNNING→DEGRADED→STOPPING

## 关键竞态风险
- 共享卷并发写入：ConfigService 文件级互斥锁
- Mod apply 与手动重启冲突：activeOperation 字段检测
- RCON 断连时命令丢失：Promise reject + 前端禁用输入框

## 配置文件优先级
Commands.dat (启动参数/模式) → Config.txt (游戏玩法/浏览器) → WorkshopDownloadConfig.json (Mod) → Rocket/OpenMod 插件配置

## 计划文件
C:\Users\WINDOWS\.claude\plans\happy-forging-zephyr.md