# 禁用清单 + 白名单/黑名单

## 硬禁止（要先写 ADR 才能用）

| 禁用项 | 理由 |
|---|---|
| Socket.IO | 钉死用 `ws`，更轻、和 `rcon-srcds` 更合拍 |
| MySQL / Postgres / SQL Server | SQLite 够了，多用户将来再加 |
| Agent / 边车容器 | 违反共享卷+RCON 决策 |
| Docker-in-Docker | SteamCMD 不走 DinD |
| MongoDB | MVP 不用 Redis |
| pushrax 的 `node-rcon` | 2021 年没维护了，用 `rcon-srcds` |
| TypeScript `any` | 除非迫不得已并加本地注释说明原因 |

## 禁用模式（带理由）

| 禁用模式 | 理由 |
|---|---|
| 编译 `.research/U3-SDK` 然后链入 | 编译出来是客户端不是服务端 |
| 抄 GSM 的 `GameManager.ts` 当起点 | 耦合给 40+ 通用游戏写的，污染未转变者专用 Mod 工作流 |
| 直接抄 `installgame.json` 那行 tip/port 的**值** | tip 是 Windows 变通方案、端口直接抄的 Rust |
| 抄 GSM 里其他游戏的专门实现 | minecraft-server-api / factorio-deployer / mrpack-server-api / tmodloader-server-api |
| 给每个服起一个 U3DS 容器 | 违反多 ServerID 共装决策（省 10GB/服） |
| 承诺"无停机换 Mod" | 热重载不存在，参 U3-SDK/Issues/#1794 |
| 自动跑 `rocket reload` | OpenMod reload 仅作可选，RocketMod reload 直接禁用 |
| 明文存密码 | 用户用 Argon2id；RCON 凭证用 AES-GCM 落库 |

## 绝对不能

- U3-SDK **绝对不能编译来当服务端用**——它是客户端 Unity 工程（AppID `304930`）
- U3-SDK 文件**绝对不能导入、编译、复制到本项目源码树**
- U3-SDK **只能当 schema 参考用**——`WorkshopDownloadConfig.cs` 是唯一可查阅的文件
- `.claude/` **绝对不能提交个人 token**
- 打印日志时**绝不能**带 RCON 密码部分

## GSM 可抄白名单（颗粒度细化）

| 可抄对象 | GSM 仓位置 | 抄的姿势 |
|---|---|---|
| 服务端元数据字段 schema | `installgame.json` 第 134 行 | 抄字段集，不抄值 |
| SteamCMD 安装 API 形态 | `server/src/routes/steamcmd.ts` | 路径和返回形态照搬；命令换成 `+app_update 1110390 validate` |
| SteamCMD 安装引导（前端） | `client/.../SteamCMDOnboardingStep.tsx` | 交互形式沿用 |
| PTY 二进制自举脚本 | `start.sh` 第 36–60 行 | 整体抄 |
| Dockerfile 多阶段构建 | `Dockerfile` | 范式沿用 |
| docker-compose 拓扑 | `docker-compose.yml` | 两容器同桥接 + 共卷挂载 |
| 插件协议模板 | `example-plugin/` | 抄文件清单形态和勾子函数签名 |
| 引导向导整体编排 | `OnboardingWizard.tsx` | 分步方式 + 本地缓存进度 |

## GSM 黑名单（严禁抄）

- ❌ 泛化游戏管理抽象（`GameManager.ts`）
- ❌ 其他游戏的专门实现（minecraft / factorio / mrpack / tmodloader）
- ❌ `installgame.json` 那行具体的 tip/port **值**（端口是抄 Rust 的 28015/28016，不能用）

## 踩过的坑（直接照搬前确认）

1. `installgame.json` 端口 `28015/28016` 不能用——未转变者实际是 `27015/27016`
2. `installgame.json` 那条 tip「`Unturned.exe -batchmode -nographics`」是 Windows 端——Linux 单服启动 `ExampleServer.sh`；多实例模式用 `ServerHelper.sh +InternetServer/<ServerID> -ThreadedConsole`
3. GSM 的 PTY 二进制在它的镜像里——本项目要么自己打包进镜像，要么启动时网络下载
4. `installgame.json` 的 `cloud` 字段（厂商推广图片）——本项目用不上，值留空
