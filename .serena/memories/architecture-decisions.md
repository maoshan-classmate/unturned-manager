## 架构决策记录 (ADR)

编号保持稳定（其他文档有交叉引用），已被推翻的条目标注退役而非删号。

1. 面板与服务端通过**共享卷 + 持久终端**通信，不通过边车代理（同机部署下代理是多余中间层）
2. 多实例通过同一安装目录下的不同实例编号实现，不通过多容器（节省 10GB×N 磁盘）
3. ⛔ **已退役**（ADR-0004 Phase 6）——原「远程控制台优先 OpenMod、RocketMod 回落自动探测」，该通道已整体删除
4. 单用户 JWT 认证，数据库预留用户表支持未来多用户扩展
5. 状态机 **4 态**：STOPPED→STARTING→RUNNING→STOPPING→STOPPED，由终端进程存活驱动（原 5 态中的 DEGRADED 已随 ADR-0004 Phase 6 删除）
6. Files 页（Figma `12:16326`）从 P2 收回 P0——骨干交互功能，没有它无法上传 Mod、修改配置传播、调日志看创意工坊内容
7. 设计源头权威在 `docs/architecture/design-system-mapping.md`（真 Figma 拉取）。实现时必须从 mapping 文件查色板与各类编号，不在 PNG 上猜

## 关键竞态风险

- 共享卷并发写入：配置服务与文件服务双文件级互斥锁
- 改 Mod 与手动重启冲突：`activeOperation` 字段检测
- 文件大上传内存爆：分块流式 1MB；并发磁盘 IO：先写 `.part` 再原子改名
- 文件路径穿越：白名单只允许实例目录、创意工坊目录、日志目录，越界 403
- ⛔ 已退役——原「远程控制台断连时命令丢失」风险项，该通道已删除；终端断连由前端终端组件自身状态承接

8. 系统架构权威在 `docs/architecture/architecture-spec.md`（2026-08-11 重写为 Phase 0-6 现状规格），与 `design-system-mapping.md` 并列为架构层两大权威来源
9. 后端模块分 3 层：接口层（WebSocket 广播器）→ 核心域层（服务端管理器为聚合根 / 配置 / 文件 / SteamCMD / 创意工坊元数据 / 日志流 / 认证 / 会话）→ 基础设施层（进程守护 / 文件锁 / 持久终端管理器）。原基础设施层中的远程控制台管理器与状态查询客户端已随 ADR-0004 Phase 6 删除
10. 模块通信走 TypeScript 接口契约（`shared/contracts/`），非事件发射器；手动依赖注入在 `composition-root.ts`；有状态模块实现 `destroy()` 生命周期
11. 乐观锁：配置服务所有写方法接受期望版本号做并发控制（ADR-0003 B2 后改为按文件修改时间比对）
12. 创意工坊订阅清单细粒度权限：面板只写内容编号列表，其余字段只读

13. **前端动画**：Motion (framer-motion v13)，从 `motion/react` 导入。全局 `<MotionConfig reducedMotion="user">` 处理无障碍。详见 ADR-0001
14. **Tailwind v4**：CSS 优先配置（`@theme inline`），移除 `tailwind.config.ts`。PostCSS 用 `@tailwindcss/postcss`，Vite 用 `@tailwindcss/vite`
15. **shadcn v4**：基于 `@base-ui/react` 原语（非 `@radix-ui`）。组件复制到 `src/components/ui/`，可按需修改源码（如加 `forwardRef`）
16. **表单方案**：react-hook-form + zod + shadcn 输入与按钮组件。已给 shadcn 输入组件加 `forwardRef` 以支持注册

17. ⛔ **已退役**（ADR-0004 Phase 6）——原「远程控制台双协议凭证分离」，两个凭证字段已从契约与创建弹窗删除
18. ⛔ **已退役**（ADR-0004 Phase 6）——原「远程控制台危险指令 428 二次确认 + 主人专属指令角色校验」，该路由已删除。当前命令通道是终端 owner-trust 模型（登录即可执行任意命令），危险指令由前端确认弹窗拦截
19. **竞态防护**：重启全过程由一个 `activeOperation` 覆盖，内部的停与启不被外层 409 门控阻拦
20. **进程生命周期**：进程守护派生子进程必须传工作目录（安装目录），启动命令用绝对路径。实例列表来源已由数据库列改为**目录扫描**（ADR-0003 B2：启动参数文件存在性即代表实例成立）
21. ⛔ **已退役**（ADR-0004 Phase 6）——原「状态查询 30s 超时就绪检测」，该通道已删除。就绪判定改为终端输出中的就绪信号 + 内容目录落盘 + 清单更新
22. ⛔ **已退役**（ADR-0004 Phase 6）——原「心跳连续 3 次失败转 DEGRADED」，该态已删除
23. **崩溃恢复**：进程异常退出 → 转为 STOPPED，5 秒硬重启守卫防抖

## 配置文件优先级

启动参数文件（启动参数与模式）→ 游戏配置文件（玩法与浏览器）→ 创意工坊订阅清单（Mod）→ RocketMod 与 OpenMod 插件配置

相关：[[architecture-spec-current-state]]、[[session-checkpoint-2026-08-11-phase6-rcon-removal]]、[[session-checkpoint-2026-08-11-phase7-session-recovery]]
