---
paths:
  - "manager-server/src/modules/**"
---

# Unturned 开服标准作业流程（SOP）

> 每个服务端管理功能都要对到本章里某个样板上，**不能重新发明**。

## 一个 ServerID 的目录布局

```
Servers/
└── <ServerID>/
    ├── Server/
    │   ├── Commands.dat           # 启动参数
    │   ├── Adminlist.dat          # 管理员 SteamID64 名单
    │   ├── Blacklist.dat          # 黑名单
    │   ├── Whitelist.dat          # 白名单
    │   └── WorkshopDownloadConfig.json  # Mod 订阅清单
    ├── Config.txt                 # 游戏玩法/浏览器配置
    ├── Rocket/                    # RocketMod（老的、兼容用）
    │   ├── Rocket.config.xml
    │   └── Plugins/<Name>/Configuration.xml
    ├── openmod/                   # OpenMod（新的、推荐）
    │   ├── openmod.yaml
    │   └── plugins/<Id>/config.yaml
    ├── Workshop/                  # SteamCMD 下载的 Workshop 内容
    ├── Bundles/Workshop/          # 手动放的 .unity3d 包
    └── Logs/                      # 面板 tail 的日志目录
```

## 安装 + 启动

### 单服模式（Phase 1 — 当前）

```bash
# SteamCMD 安装（幂等、匿名、AppID 1110390）
steamcmd +login anonymous +force_install_dir /opt/unturned +app_update 1110390 validate +quit

# 运行时前置（Debian/Ubuntu）
sudo apt-get install -y mono-complete lib32gcc-s1

# 首次启动——生成默认配置（Servers/Default/ 目录）
/opt/unturned/ExampleServer.sh

# 编辑配置后再次启动
/opt/unturned/ExampleServer.sh
```

`ExampleServer.sh` 是 U3DS 自带的默认启动脚本（SteamCMD 安装后自动生成），对应 `Servers/Default/` 这个 ServerID。**参考**：GSM3 单服模式也走同一条路径（`.research/GameServerManager` 配套文档）。

### 多实例模式（Phase 5+ — 后续扩展）

```bash
# 启动一个命名的服
/opt/unturned/ServerHelper.sh +InternetServer/<ServerID> -ThreadedConsole
```

多个 ServerID 共用同一个 U3DS 安装目录，省 10GB×N 磁盘。

**硬规则**：
- 一个 ServerID 一个进程。多个 ServerID 共用同一个 U3DS 安装目录。
- **不要再用老命令行的 `-port -map -pvp` 参数**——所有可配置项都走 `Commands.dat`。
- Mono **必须装**。
- **SteamCMD 下载到 staging（`Workshop/staging/`）可不停服**；写入 `content/1110390/`、`validate`、更新 U3DS 二进制**必须停服**（见下文「Workshop 内容下载」）。

## Commands.dat 样板

```
Name My Unturned Server
Port 27015
MaxPlayers 16
Map PEI
Mode Normal
Owner 76561198XXXXXXXXX
Perspective Both
Chatrate 0.25
Cycle 3600
Timeout 750
Queue_Size 0
Filter
Whitelisted
Gold
Hide_Admins
Sync
Cheats
GSLT <your_gslt_here>
Log Y Y Y N
Votify N 60 60 30 60 1
```

**解析器契约**：每行 `指令 值`（单独一个词就是开关）；用 `#` 或 `;` 起注释；**必须保留未知键**——面板不能把不认识的指令删了。

## WorkshopDownloadConfig.json 规则

- 面板**只能写** `File_IDs`，以及用户主动切换的 `Should_Monitor_Updates` 跟计时器字段。其他字段**只读展示**。
- **每次写之前**必须先复制备份：`cp WorkshopDownloadConfig.json WorkshopDownloadConfig.json.bak.<UTC-ISO>`
- 配置文件形状权威在 U3-SDK 的 `WorkshopDownloadConfig.cs`（仅供查阅）。

## Workshop 内容下载（staging，下载可不停服）

> 依据：U3-SDK `WorkshopDownloadConfig.Use_Cached_Downloads`——服务端**只在启动时**加载已安装 Mod（`content/1110390/`），运行中不重扫目录；`Should_Monitor_Updates` 官方行为 = 检测到更新 → 广播 → **关服应用**。即：**下载≠生效**，下载可不停服，生效必须重启。

- **下载新 Mod（不在 File_IDs 或未加载）**：SteamCMD 下载到 **staging 目录**，U3DS **可继续运行**。
  - staging 目录：`Servers/<ID>/Workshop/staging/`（U3DS 只 mount `Workshop/steamapps/workshop/content/1110390/`，**不扫描 staging**）
  - 命令：`steamcmd +force_install_dir <Servers/<ID>/Workshop/staging> +login anonymous +workshop_download_item 1110390 <id1> <id2> ... +quit`
  - 进度经 `steamcmd_progress` 事件推送；下载锁与 `activeOperation` 竞态门控合并。
- **应用（生效）必须停服**：把 staging 内容移入 `Workshop/steamapps/workshop/content/1110390/` 并改 `File_IDs` 后，**必须走下方重启流水线**。Unturned 无热重载（U3-SDK Issues #1794）。
- **validate / 更新已启用 Mod / 更新 U3DS 二进制**：**必须停服**（写入运行中服务端直接读取的位置，覆盖已加载文件有风险）。
- staging 下载完成后，其中的 `appworkshop_1110390.acf` 可用于「已下载 Mod 清单」核对（参考 `claudedocs/research_dst_mod_reference_2026-08-08.md`）。

## 重启 / 改 Mod 流水线（唯一模式——没有热重载）

```
用户确认修改 Mod 列表（staging 下载已在不停服阶段完成）
  → 备份 WorkshopDownloadConfig.json → 原子写新文件
  → 经 PTY 终端写入 "Save"（强制刷玩家数据到磁盘）
  → 经 PTY 终端写入 "Shutdown 10 <重启原因>"（10 秒优雅关服，对齐 applyModChanges 代码）
  → 等进程退出
  → 移动 staging 内容 → Workshop/steamapps/workshop/content/1110390/（进程已停，零冲突）
  → 再拉起新的
  → PTY 终端输出含 'Server is ready' / 'World saved' 类 ready 信号 + content 目录落盘 + acf 更新 = 成功。无 A2S 轮询（ADR-0004 §3.3）
  → 通过 WebSocket 广播"已恢复"事件给前端
```

## 服务端状态机

```
STOPPED → STARTING → RUNNING → STOPPING → STOPPED（循环，4 态）
任何状态 → STOPPED（强制停止，kill -9 兜底）
```

`activeOperation` 字段防止"用户点自动重启同时点手动重启"的竞态。

> 状态机完全由 PTY 进程的 spawn/exit 驱动，无 A2S / RCON / DEGRADED 维度（ADR-0004 §3.3 + Phase 6）。

## Steam Workshop Mod 元数据获取

- **主路径（推荐）**：Steam WebAPI `IPublishedFileService/GetDetails/v1`（详情/批量）+ `QueryFiles/v1`（搜索），**需要 WebAPI Key**（用户 Steam 账号免费申请，Settings 配置）。
- **旧路径已废弃**：`?xml=1` 零凭证接口 **2026-08 实测返回 HTML 而非 XML**，不再可用（证据见 `claudedocs/research_dst_mod_reference_2026-08-08.md` §5.1）。
- **不做**：GameServerUGC 接口（安全成本太高）。

## 实时控制台

- 后端 tail 两路：日志文件 `Servers/<ID>/Logs/*.log` + spawn 子进程 stdout
- 通过 `ws` **双向**：出站 `console_line` 推送输出 + 入站 `terminal_input` 写入 PTY stdin（ADR-0004 Phase 3）
- 前端命令经 WS `terminal_input` 直达 PTY 终端——owner-trust 模型（登录即可执行任意命令，ADR-0004 Phase 6 删 RCON 后为唯一通道）；危险指令由前端卡片拦截
