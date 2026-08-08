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
