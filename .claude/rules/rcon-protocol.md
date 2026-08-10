---
paths:
  - "manager-server/src/modules/rcon/**"
---

# RCON 通道规范

## 链路

```
1. 自动探测 OpenMod 端口
   读 Servers/<ID>/openmod.yaml，看 rcon.port（默认 25545）

2. 尝试 OpenMod Valve Source RCON（npm 库 rcon-srcds）
   凭证 = "SteamID:密码" 格式（OpenMod 特有）
   连接成功 → 第 4 步
   连不上 → 第 3 步

3. 回落：RocketMod Telnet RCON
   端口 = 游戏端口 + 2
   发送 "login <密码>\r\n"，等成功响应
   认证失败 → 上报"RCON 不可用"错误

4. 缓存当前工作模式 60 秒
   60 秒内不再探测，直接复用上次成功的协议
```

## 凭证分离（ADR-17）

- **OpenMod**：`openModCredential`，格式 `SteamID:密码`
- **RocketMod**：`rocketModPassword`，裸密码
- 不能共享 `rconPassword` 字段——会导致跨协议凭证冲突

## 安全门控

### 危险指令（需二次确认）
`Shutdown`、`Ban`、`Slay`、`ResetConfig`、`Unadmin`、`Unban`、`Cheats`

- 前端必须传 `{confirmed: true}` 才执行
- 后端返回 `428 Precondition Required` 表示需要确认

### Owner 专属指令
`Owner`、`Cheats`、`Shutdown`

- 校验 JWT `role=admin`
- 面板必须鉴权到主人才能用

## RCON 凭证存储

- 面板数据库中**加密存储**（AES-GCM）
- 打印日志时**绝不能**带密码部分
- OpenMod 凭证格式：`SteamID:密码`（写成"ID"+"冒号"+"PASSWORD"）

## DEGRADED 接线

- ServerManager constructor 订阅 `rconManager.onStateChange`
- 连续 3 次 ping 失败 → `transition(DEGRADED)`
- 恢复 → `transition(RUNNING)`

## 安全门控与 PTY 终端（ADR-0004 addendum）

ADR-0004 把实例控制改为持久 PTY 终端 + xterm.js 后，**命令通道分两类**，安全门控语义不同：

### 结构化 RCON 接口（`POST /rcon/execute` 等）

- 仍走 `rcon-srcds`（OpenMod Valve Source RCON）→ `net`（RocketMod Telnet 回落）
- **保留完整安全门**：JWT role check / 危险指令 428 二次确认 / Owner 专属 / AES-GCM 凭证加密
- 本文件上方所有规则（DEGRADED / 危险指令 / Owner 专属 / 凭证分离）**仅适用于此通道**

### PTY 终端（GSM3 同款 owner-trust 模型）

- 通过 WS `terminal_input` 事件把字符串直接写入 PTY stdin
- **无角色检查、无 428 二次确认**——登录（JWT 有效）即可在终端执行任意命令
- 单用户系统（CLAUDE.md §2）+ 终端是 owner 自己用 = owner-trust 模型成立
- 若需要危险指令拦截，由前端控制卡片实现（Phase 4 后）

⚠️ **不要**把 PTY 路径当 RCON 一样保护；**也不要**因为有了 PTY 就丢弃 RCON 安全门（结构化 API 仍受 RCON 保护）。
