# unturned-manager — 项目宪法（中文版）

> **这文件是项目唯一权威文档**——任何 agent 或人接手这个仓库，第一件事就是读完它。  
> 现实和本文档冲突时，以本文档为准；改本文档必须和改代码一起走 PR。  
> **技术名词（库名、命令名、文件名、协议名、端口号）保留原文**，因为代码里就要写这些字串；正文中在旁边加中文说明。

---

## 1. 项目身份

**这是干嘛的**：专门给"未转变者 Unturned 3.x"的 Linux 专用服务端做的一套自托管网页管理面板。

**不是什么**：
- 不是通用游戏面板（不做我的世界、幻兽帕鲁、腐蚀这些）
- 不是 Pterodactyl / Pelican / AMP / PufferPanel / TCAdmin 这些成熟产品的克隆
- 不是远程 Agent 架构——我们用「共享卷 + 远程控制协议（RCON）」在进程内和服务端通信，不起 Agent 边车
- 不是 U3-SDK 源码的编辑/分发器（U3-SDK 是什么看 §3.1）

**术语钉死表**（这些词别用同义词替换）：
| 术语 | 含义 |
|---|---|
| **U3DS** | Unturned 专用服务端二进制，从 Steam 上装的，AppID 是 `1110390` |
| **U3-SDK** | 官方公开的 Unity 客户端源码仓，在 `.research/U3-SDK`，**它是客户端不是服务端，绝对不能编译来当服务端用** |
| **ServerID**（也写作 `<ID>`） | `Servers/` 下的一个子目录，代表一个服务端实例（启动参数 `+InternetServer/<ID>` 里的那个 ID） |
| **GSM** | `GameServerManager`，参考仓在 `.research/GameServerManager`，通用游戏面板，本项目**只参考技术栈，不抄业务逻辑** |
| **Panel / unturned-manager** | 就是本项目本身 |
| **Mod** | Steam 创意工坊（Steam Workshop）上的一个订阅项 |
| **RCON** | 远程控制协议，往服务端发命令的通道 |
| **A2S** | Valve 玩家的服务器在线状态查询协议（玩家数、地图、版本） |
| **GSLT** | Game Server Login Token，让服务端能被 Steam 服务器列表看见、并保证重启后服务端识别码不变，要去 `steamcommunity.com/dev/managegameservers` 用 AppID `304930` 申请 |
| **SteamID64** | 玩家在 Steam 上的 17 位数字 ID，开头是 `7656119...` |

---

## 2. 技术栈铁律（钉死的）

> 代码里一旦用了，要换就得先更新本文件 + 写一份 ADR（架构决策记录）。  
> Serena 记忆里的 `architecture-decisions`、`project-overview`、`session-research-findings`、`unturned-server-technical-reference` 是摘要版；本章是可机读版。

### 2.1 前端
| 分层 | 锁定的库 | 备注 |
|---|---|---|
| 框架 | React 18 + TypeScript | |
| 构建 | Vite | |
| 样式 | Tailwind CSS 4 + shadcn/ui（CSS-first 配置） | 深色主题用 slate 色系，点睛色用 HSL(160, 84%, 39%) emerald-500，设计稿在 Figma `🎨 Login` 页面 |
| 图表 | recharts | |
| 表格 | @tanstack/react-table | |
| 图标 | lucide-react | |
| 状态管理 | （实现阶段决定，轻量级、Zustand 风格） | |
| 实时通信 | 浏览器原生 `ws`（WebSocket 客户端） | **不能用 Socket.IO**，后端用的是 `ws`，要统一 |
| 动画(CSS) | tw-animate-css（Tailwind v4 动画工具类） | |
| 动画(React) | Motion（framer-motion v13），从 `motion/react` 导入 | ADR-0001 采纳，全局 `<MotionConfig reducedMotion="user">` 已配置 |

### 2.2 后端

### 2.2 后端
| 分层 | 锁定的库 | 备注 |
|---|---|---|
| 运行时 | Node.js 20 LTS | |
| HTTP 框架 | Express 4 + TypeScript | |
| WebSocket | `ws`（**不是 socket.io**） | |
| 数据库 | SQLite，驱动用 better-sqlite3 | 数据库设计里要预留 `users` 表，将来好扩展多用户 |
| 认证 | 单用户 JWT（一个管理员），Argon2id 密码哈希 | 数据库设计不能堵死将来加多用户 |
| 进程控制 | **共享卷 + child_process / spawn** | 第一版不要 Agent 边车，不要 Docker 边车 |
| 日志 | pino | 结构化 JSON + 自动滚动切分 |

### 2.3 和游戏服务端集成
| 关注点 | 选定方案 |
|---|---|
| RCON 主链路 | **OpenMod** 的 Valve Source RCON 协议，用 npm 上的 `rcon-srcds` |
| RCON 回落方案 | RocketMod 的 Telnet RCON，用 Node 原生 `net` 模块（自动探测 + 自动回落） |
| A2S 服务器在线状态查询 | `@fabricio-191/valve-server-query` |
| XML 配置文件解析 | `fast-xml-parser` |
| YAML 配置文件解析 | `js-yaml` |
| Steam 创意工坊（Workshop）Mod 元数据 | 第一档：URL 加 `?xml=1` 这种零登录方案；要升级时：用户在面板设置里填自己的 WebAPI Key（去 `steamcommunity.com/dev/apikey` 免费申请） |
| Steam WebAPI 的 HTTP 客户端 | undici（Node 20 内置，零依赖） |
| API 文档与契约 | zod + zod-openapi（Sprint 2 引入）—— `shared/schemas/` 定义 Zod schema，派生 TS 类型 + OpenAPI 3.0 规范 + 运行时校验，前后端共用同一 schema 真相源 |

### 2.4 部署
| 分层 | 决策 |
|---|---|
| 拓扑 | Docker Compose，panel 容器和 U3DS 容器**同主机部署**，共用一个 Docker 卷，同一个 bridge 网络（也可以 U3DS 直接装主机上） |
| 多实例方案 | 同一个 U3DS 安装目录下挂多个 ServerID；**不是一个服一个容器**（每个服省 10 GB 磁盘） |
| 反向代理 | panel 前面挂 Caddy 或 nginx，TLS 在那终结，JWT 走 `Authorization: Bearer` 头 |

### 2.5 禁用清单（要先写 ADR 才能用）
- ❌ 不用 Socket.IO（我们钉死用 `ws`，更轻、和 `rcon-srcds` 更合拍）
- ❌ 不用 MySQL / Postgres / SQL Server 这一档（SQLite 够了，多用户将来再加）
- ❌ 不用 Agent / 边车容器（违反 §3.1 决策第一条）
- ❌ 不用 Docker-in-Docker，SteamCMD 不走 DinD
- ❌ 不用 MongoDB，MVP 不用 Redis
- ❌ 不用 pushrax 那个 `node-rcon`（2021 年就没维护了，用 `rcon-srcds`）
- ❌ 不用 TypeScript `any` 类型，除非迫不得已并加本地注释说原因

---

## 3. 仓库蓝图

```
D:/unturned-manager/
├── CLAUDE.md                ← 你在读的这个，项目唯一权威文档
├── README.md                ← 只放一行说明，详情都看 CLAUDE.md
│
├── .research/               ← 只读参考仓（git 子模块或拷贝进来）
│   ├── U3-SDK/              ← SDG 客户端 Unity 源码（用途看 §3.1）
│   └── GameServerManager/   ← 第三方通用游戏面板（用途看 §3.2）
│
├── claudedocs/              ← 只读调研产出（每份都是可引用的参考）+ 工作流计划
│   ├── workflow_sprint1_scaffold.md      ← Sprint 1 实现工作流
│   ├── reference_config_files.md         ← 配置文件完整字段表
│   ├── reference_console_commands.md     ← 大约 64 条远程命令参考（含聊天语法和危险标记）
│   ├── research_unturned_panel_*.md      ← 主调研报告
│   ├── research_unturned_panel_sdk_notes.md  ← 必读：U3-SDK 到底是什么、不是什么
│   ├── research_supplement_rcon_libraries.md
│   ├── research_raw_*.md                 ← 6 份原始子代理交付
│   ├── research_verification_tracker.md  ← 3 项需要实机验证的事项
│   └── figma-exports/                    ← Figma 设计稿 PNG 导出（不要改；快照可视化用，权威是 §3.3 的结构化版本）
│
├── .claude/                 ← 工具配置（Serena、钩子）；绝对不能提交个人 token
├── .serena/.gitignore       ← Serena 记忆的 git 忽略
├── .idea/                   ← 本地 IDE 状态（已 git 忽略）
│
├── docs/                    ← 架构文档
│   ├── adr/                 ← 架构决策记录
│   └── architecture/        ← architecture-spec.md + design-system-mapping.md
│
├── manager-server/          ← 后端源码（Express 4 + ws + SQLite）
│   ├── src/
│   │   ├── index.ts          ← 入口（Express + ws 启动 + 优雅关闭）
│   │   ├── config.ts         ← 环境变量校验
│   │   ├── composition-root.ts ← DI 容器（12 模块桩 + AuthService 真实现）
│   │   ├── db/               ← 数据库（connection / migrate / seed / DDL）
│   │   ├── routes/           ← REST 路由（8 文件，20 端点）
│   │   ├── middleware/       ← Express 中间件（JWT 认证）
│   │   ├── modules/          ← 模块实现（以 auth/server/config/files/... 分目录）
│   │   ├── ws/               ← WebSocket 网关（JWT 认证 + 按 ServerID 路由广播）
│   │   └── utils/            ← 工具（logger）
│   └── .env.example
│
├── manager-web/             ← 前端源码（React 18 + shadcn/ui + Tailwind CSS 4 + Motion）
│   ├── src/
│   │   ├── main.tsx          ← 入口
│   │   ├── App.tsx           ← 路由根（8 页面 + Sidebar 布局）
│   │   ├── api/              ← axios 实例（JWT 注入 / 401 自动刷新）
│   │   ├── contexts/         ← AuthContext + WebSocketContext
│   │   ├── components/       ← 组件（layout/Sidebar + ui/ + shared/）
│   │   └── pages/            ← 页面（LoginPage + 占位页面）
│   └── index.html
│
├── shared/                  ← 前后端共享（纯 TypeScript 类型，零运行时依赖）
│   ├── types/               ← branded.ts / state.ts / domain.ts
│   ├── contracts/           ← 12 个模块接口（IServerManager / IRconManager / ...）
│   └── index.ts             ← barrel export
│
└── docker-compose.yml       （待建）
```

### 3.1 `.research/U3-SDK/` 到底是个啥——绝不能当服务端源码
- 它是**未转变者客户端**的 Unity 工程（`steam_appid.txt` 里明明白白写的 `304930`，那是客户端 AppID）。
- 构建目标是玩家能玩那个游戏，**不是服务端**。
- **只能当 schema 参考用**：`Assets/Runtime/Assembly-CSharp/Unturned/Provider/WorkshopDownloadConfig.cs` 是 `WorkshopDownloadConfig.json` 配置文件的权威形状定义。其他文件不要碰。
- **绝对不能**：导入、编译、复制到本项目源码树、当服务端 SDK 引用。
- 决策原则：要查字段时，去 `claudedocs/reference_config_files.md`；只有这种文档里查不到、定义有歧义的（比如 `Should_Monitor_Updates` 的运行行为），才回去翻 U3-SDK。

### 3.2 `.research/GameServerManager/` 到底是个啥——分三类对待

GSM 是个**通用**的 Steam 游戏面板（40+ 款游戏）。**未转变者在它整个仓库里只有 `server/data/games/installgame.json` 里的一行**——也就是说 GSM 源码本身没有任何「未转变者专用业务逻辑」可抄。  
但是，GSM 仓里有「**通用手段**」，拿来套到未转变者上就是另一回事了。颗粒度要分三类：

**A 类——「数据 schema」可直接抄的字段结构**
- `installgame.json` 那一行的字段格式：`game_nameCN` / `appid` / `tip` / `ports[]` / `image` / `url` / `system[]` / `memory` / `start_command{Windows,Linux}` / `cloud{}` / `docs` / `login_anonymous`。  
- 这套字段就是 Steam 服务端元数据的通用描述。本项目可以拿来做「服务器游戏库」配置（虽然我们只支持一款游戏，但以后想接第二款也有地方放）。
- **抄的时候**只抄字段名和结构，**值要按未转变者重新填**——`installgame.json` 那行里给的 `tip` 是 Windows 输出流转、`ports` 直接抄的是 Rust 的 28015/28016，这两个值都不能用，Linux 实际启动是 §4.2 那条 `./ServerHelper.sh +InternetServer/<ID> -ThreadedConsole`。

**B 类——「通用工作流」可以套用到未转变者场景上抄**
| GSM 里的工作流 | 在 GSM 仓里的位置 | 套到未转变者上抄什么 |
|---|---|---|
| SteamCMD 安装引导（前端） | `client/src/components/onboarding/SteamCMDOnboardingStep.tsx` | UI 引导（探测路径、Windows/Linux 分支、`/root/steamcmd` 默认值、Docker 环境提示）本项目可以沿用同样的交互形式 |
| SteamCMD 安装 API（后端） | `server/src/routes/steamcmd.ts` | `GET /api/steamcmd/status`、`POST /api/steamcmd/install`、`POST /api/steamcmd/manual-path` 这一套 REST 端点形态可以照搬，命令从 GSM 的下载 steamcmd 改成 `app_update 1110390` |
| PTY 自举（Linux x86_64 / arm64 二进制引导） | `start.sh` 第 36–60 行 + `data/lib/pty_linux_x64` / `pty_linux_arm64` | 未转变者没有 PTY 桥，所以这招可以原样抄过去——丢一份 PTY 二进制到面板数据目录，启动时检测 ELF 头、设可执行位 |
| Docker 多阶段构建 | `Dockerfile`、`docker-compose.yml`、`start.sh` 的 hook | 未转变者容器镜像的 Dockerfile 可以照 GSM 的多阶段模式搭，蒸汽卷 + 跨容器桥接网络的拓扑直接抄 |
| 引导向导流程（前端） | `client/src/components/OnboardingWizard.tsx` | UI 流程可参考：第一步 SteamCMD 路径、第二步下载……本项目前端串起来用 |

**C 类——「通用游戏抽象」严禁抄**
- `server/src/modules/game/GameManager.ts` 和 `routes/games.ts`、`routes/minecraft.ts` 这一类「为 40+ 款游戏提供泛化抽象」的代码：**不抄**。这层抽象不解决未转变者的任何问题（Mod 浏览器 / RCON 通道 / Workshop 元数据），反而会拖进来 2000 行跟未转变者无关的泛化逻辑。
- 同理：`server/src/modules/game/othergame/minecraft-server-api.ts`、`factorio-deployer.ts`、`mrpack-server-api.ts`、`tmodloader-server-api.ts` 等针对其他游戏的专门实现：**不抄**。

**白名单 / 黑名单汇总**（细节看 §6.4）：
- ✅ 白名单（可抄）：字段 schema 形态、SteamCMD 安装 API 形态、PTY 自举、Docker 多阶段布局、引导向导流程、插件协议模板（`example-plugin/`）
- ❌ 黑名单（不抄）：泛化的游戏管理抽象（`GameManager.ts`）、其他游戏的专门实现、未转变者那一行具体的 tip/port **值**

### 3.3 Figma 设计源头（结构化权威）

`claudedocs/figma-exports/` 里的 PNG 只是**渲染后的截图快照**，不是设计源头。权威结构化数据在 `docs/architecture/design-system-mapping.md` —— 该文件由 `figwright` MCP 拉真 Figma 写入，**任何人前端实现时先看它、不要凭 PNG 猜**。

系统架构权威在 `docs/architecture/architecture-spec.md` —— C4 模型组件图粒度，含模块接口契约、数据库 schema、安全架构、数据流。**任何后端模块实现时先看它，不要凭 CLAUDE.md §4 的 SOP 猜模块边界**。

引用的关键事实：
- **18 张 Figma Page**（v1 可路由的 8 张 + 系统设置 + shadcn 主题参考 + Components 页 + Icon Refs）
- **21 个 Component**（Sidebar / StatCard / Card / Button Set / Badge Set / Toast Set / ConfirmDialog / ToolbarBtn / ModCard / DataRow / PlayerTable / Input / Select / Switch / Checkbox / ConfigDialog / FileCard 等）
- **4 个 Component Set**（Button 4 变体、Badge 3 变体、Toast 3 变体、Switch ON/OFF 拆错——代码不学）
- **12 个 Paint Style**（token 名 `bg/sidebar` / `bg/content` / `bg/card` / `border/default` / `border/strokes` / `text/primary` / `text/secondary` / `text/muted` / `accent/primary` / `accent/hover` / `status/online` / `status/warning` / `status/danger`——精确 RGB 在 mapping 表 §1）
- **Inter 字体三档字重**（Regular / Medium / Semi Bold，Medium 是主力）
- **路由映射**：v1 8 张页面 + Files 收回 P0 + Settings 放 P1

> 实现层铁律：颜色 / 间距 / 字号 / 组件名 **必须从 mapping 表来**，**不**从 PNG 截图读估算。Figma 改完后 `design-system-mapping.md` 同步改，最后动代码。

---

## 4. Unturned 开服标准作业流程（"可以复制"的样板）

> 这一章是「可以复制」的全部样板。  
> 每个服务端管理功能都要对到本章里某个样板上，**不能重新发明**。  
> 文件树里标 `<!--REPLACE-->` 的位置，是 PR 唯一能改的点。

### 4.1 一个服（一个 ServerID）的目录布局

```
Servers/
└── <ServerID>/                    <!--REPLACE: 服务端 ID-->
    ├── Server/                    # 启动时读的文件
    │   ├── Commands.dat           # 启动参数  (§4.3)
    │   ├── Adminlist.dat          # 每行一个 SteamID64 的管理员名单
    │   ├── Blacklist.dat          # 每行一个 SteamID64 的黑名单
    │   ├── Whitelist.dat          # 每行一个 SteamID64 的白名单（要开启 Whitelisted 才生效）
    │   └── WorkshopDownloadConfig.json  # Mod 订阅清单  (§4.4)
    ├── Config.txt                 # ≥3.25.8.0 版的游戏玩法/浏览器配置（参考文档 §2）
    ├── Rocket/                    # RocketMod（老的、兼容用）
    │   ├── Rocket.config.xml      # RocketMod 总配置  (§4.5)
    │   └── Plugins/<Name>/Configuration.xml  # 每个 RocketMod 插件自己的配置
    ├── openmod/                   # OpenMod（新的、推荐）
    │   ├── openmod.yaml           # OpenMod 总配置  (§4.6)
    │   └── plugins/<Id>/config.yaml  # 每个 OpenMod 插件自己的配置
    ├── Workshop/                  # SteamCMD 下载下来的（或者符号链接过来的）Workshop 内容
    │   ├── Maps/
    │   └── Content/
    ├── Bundles/
    │   └── Workshop/              # 手动放的 .unity3d 包
    └── Logs/                      # 滚动切分的日志（面板要 tail 这目录）
```

### 4.2 安装 + 启动（Docker / systemd 模板）

```bash
# 第一步：用 SteamCMD 装服务端（幂等、匿名、AppID 1110390）
steamcmd +login anonymous \
         +force_install_dir /opt/unturned \
         +app_update 1110390 validate \
         +quit

# 第二步：装运行时前置依赖（Debian/Ubuntu；不能跳过——Unturned 用 Unity 2020.3 LTS Mono）
sudo apt-get install -y mono-complete lib32gcc-s1

# 第三步：启动一个服。多个服就重复这一步，每服不同 ID 和端口
/opt/unturned/ServerHelper.sh +InternetServer/<ServerID> -ThreadedConsole
# 默认端口：UDP 27015（游戏）+ UDP 27016（查询 = 游戏+1）+ TCP 游戏+2（RocketMod RCON）
```

**硬规则**：
- 一个 ServerID 一个进程。多个 ServerID 共用同一个 U3DS 安装目录（这才是省 10GB×N 的关键）。
- **不要再用老命令行的 `-port -map -pvp` 参数**——目前 U3DS 顶多把它们当遗留别名用，**所有可配置项都走 `Commands.dat`**。参 §6 验证项 #1。
- Mono **必须装**。证据：原来以为"不需要 Mono"的假设已经被推翻，详见 `claudedocs/research_verification_tracker.md` 里那条"Mono 假设被推翻"。

### 4.3 `Commands.dat` 样板（参数权威表见 `claudedocs/reference_config_files.md` §1）

```
Name My Unturned Server          # 服务器名
Port 27015                       # 游戏端口（同时占用 +1 查询端口）
MaxPlayers 16                    # 最大玩家数
Map PEI                          # 地图
Mode Normal                      # 难度
Owner 76561198XXXXXXXXX         # 服务器主人（你的 Steam64 位 ID）
Perspective Both                 # 视角限制：First/Third/Both/Vehicle
Chatrate 0.25                    # 聊天冷却秒数
Cycle 3600                       # 昼夜循环秒数（3600=现实一小时=游戏一天）
Timeout 750                      # ping 超时毫秒
Queue_Size 0                     # 排队上限
Filter                           # 名字过滤（过滤非英文/字母数字）
Whitelisted                      # 白名单模式（开之后只有 Permit 过的能进）
Gold                             # 仅 Gold 会员可进
Hide_Admins                      # 不在玩家列表显示管理员标签
Sync                             # 跨服存档同步
Cheats                           # 启用作弊指令
GSLT <your_gslt_here>            # 游戏服务端登录令牌，去 steamcommunity.com/dev/managegameservers 用 AppID 304930 申请
Log Y Y Y N                      # 日志开关：聊天/加入退出/死亡/反作弊
Votify N 60 60 30 60 1           # 投票配置
```

**解析器契约**：每行 `指令 值`（单独一个词就是开关）；用 `#` 或 `;` 起注释；**必须保留未知键**——面板不能把不认识的指令给删了。

### 4.4 `WorkshopDownloadConfig.json` 样板

```json
{
  "File_IDs":                       [/* uint64 数组，存 Mod 的 Workshop 文件 ID */],
  "Ignore_Children_File_IDs":       [],
  "Query_Cache_Max_Age_Seconds":    600,
  "Max_Query_Retries":              2,
  "Use_Cached_Downloads":           true,
  "Should_Monitor_Updates":         true,
  "Shutdown_Update_Detected_Timer": 600,
  "Shutdown_Update_Detected_Message": "Workshop file update detected, shutdown in: {0}",
  "Shutdown_Kick_Message":          "Shutdown for Workshop file update."
}
```

**规则**：
- 面板**只能写** `File_IDs`，以及用户主动切换的 `Should_Monitor_Updates` 跟那几条计时器字段。其他字段在面板里**只读展示**。
- **每次写之前**必须先复制一个备份：`cp WorkshopDownloadConfig.json WorkshopDownloadConfig.json.bak.<UTC-ISO 时间戳>`。
- 配置文件形状的权威定义在 U3-SDK 的 `Assets/Runtime/Assembly-CSharp/Unturned/Provider/WorkshopDownloadConfig.cs`（仅供查阅，不是要复制过来，参 §3.1）。

### 4.5 RCON 通道链路（后端写在 `manager-server/src/modules/rcon/`）

```
1. 自动探测 OpenMod 端口
   读 Servers/<ID>/openmod.yaml，看 rcon.port（默认 25545）

2. 尝试用 OpenMod 的 Valve Source RCON 连
   凭证 = "SteamID:密码" 格式（OpenMod 特有）
   通过 npm 库 rcon-srcds 连
   连接成功 → 第 4 步
   连不上 → 第 3 步

3. 回落：用 RocketMod 的 Telnet RCON
   端口 = 游戏端口 + 2
   发送 "login <密码>\r\n"，等 "OK" 之类的成功响应
   认证失败 → 上报"RCON 不可用"错误，带诊断信息

4. 缓存当前工作的模式 60 秒
   60 秒内不会再探测，直接复用上次成功的协议
```

- RCON 凭证格式对 OpenMod 来说是 `SteamID:密码`（写成"ID"+"冒号"+"PASSWORD"）。
- **服务器主人专属指令**（面板必须鉴权到主人才能用）：`Owner`、`Cheats` 切开关、`Shutdown`（不同服可能不一样）。
- **危险指令**（UI 上**必须二次确认**才让用）：`Shutdown`、`Ban`、`Slay`、`ResetConfig`、`Unadmin`、`Unban`、`Cheats`（一旦开了所有作弊指令都能用）。

### 4.6 重启 / 改 Mod 的流水线（**唯一能用的模式**——没有热重载）

```
用户在 UI 上点"确认修改 Mod 列表"
    ↓
后端：先备份 WorkshopDownloadConfig.json → 加 .bak.<ISO 时间戳>
    ↓
后端：原子写新文件（旧文件要么全成功要么全失败）
    ↓
后端：可能要改 Commands.dat（如改主人、改密码）→ 同样原子写
    ↓
后端：远程指令 RCON "Save"   ——强制把玩家数据刷到磁盘
    ↓
后端：远程指令 RCON "Shutdown 30 <重启原因>"   ——广播 30 秒后优雅关服
    ↓
后端（或 systemd / docker compose）：等进程退出，再拉起新的
    ↓
后端：轮询 A2S_INFO 直到返回"服务端就绪"，超时 30 秒就报错
    ↓
后端：重新评估状态机（参 §4.7）→ 通过 WebSocket 广播"已恢复"事件给前端
```

**禁用反模式**：
- 尝试在不重启的情况下换 Mod
- 承诺"无停机换 Mod"
- 自动执行 `rocket reload`

### 4.7 服务端状态机（架构决策第 5 条）

```
停止 → 启动中 → 跑进程 → 运行中
运行中 → 保存+关服中 → 退出 → 停止
运行中 ←→ 降级运行  （RCON 失联但进程还在 → 降级；恢复 → 回运行中；救不回来 → 停止）
任何状态 → 强制停止   （kill -9 / 手动；最后兜底，要发告警）
```

有个 `activeOperation` 字段专门防止"用户点完自动重启的同时又点了一次手动重启"的竞态。

### 4.8 Steam 创意工坊 Mod 元数据怎么拿（前端 Mods 页面用）

- **第一档（默认、零凭证）**：`https://steamcommunity.com/sharedfiles/filedetails/?id=<Mod ID>&xml=1` → 解析返回的 XML → 渲染卡片（标题、作者、描述、预览图、文件大小、更新时间）。完全够用。
- **第二档（可选）**：用户在面板设置里填自己的 WebAPI Key → 调 `IPublishedFileService/GetDetails`，能拿到依赖关系、评分、完整标签。
- **第三档（不会做）**：用服务端那边的 Steam GameServerUGC 接口（需要把 U3DS 的 GSLT 共享给面板）——安全和反滥用成本太高，列在"不做除非有人坚持"清单里。

### 4.9 实时控制台

- 后端同时 tail 两路：
  - 日志文件 `Servers/<ID>/Logs/*.log`
  - spawn 出来的子进程的 stdout（推荐用 PTY，没有的话可以参考 GSM 里的 `data/lib/pty_linux_x64` 自举办法）
- 通过 `ws` 推给浏览器，**单向**（前端不能反过来发指令；发指令走单独的 RCON 链路）。
- 不能提供 "eval" 那种前端能直接执行任意命令的接口。

---

## 5. 开发工作流

### 5.1 新会话必读顺序
1. `CLAUDE.md`（就是这份）
2. Serena 记忆（在 `~/.claude/projects/.../memory/`）：`architecture-decisions`、`project-overview`、`session-research-findings`、`unturned-server-technical-reference`
3. `claudedocs/reference_config_files.md`（后端所有文件路径都靠它）
4. `claudedocs/reference_console_commands.md`（后端所有 RCON 助手都封装其中的某条）
5. `claudedocs/research_verification_tracker.md`（承诺"能跑"之前，先查哪几项还没实机验过）
6. `claudedocs/figma-exports/`（UI 长相对不对的目标——slate 深色 + emerald-500 点睛）

### 5.2 提交规范
- 分支名：`feat/<范围>`、`fix/<范围>`、`refactor/<范围>`、`docs/<范围>`、`chore/<范围>`
- 提交前缀：`feat:`、`fix:`、`refactor:`、`docs:`、`chore:`（用 pre-commit 钩子强制，后续要加）
- 每个非平凡的决策写一份 ADR（架构决策记录），放在 `docs/adr/NNNN-标题.md`。同一个 PR 里更新对应的 Serena 记忆。

### 5.3 验证门槛

每个 PR 必须通过：

| 门槛 | 工具 | 通过标准 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | 零错误 |
| 代码风格 | eslint + prettier | 零警告 |
| 单元测试 | 前端 vitest、后端 jest | 改到的文件行覆盖率 ≥ 80% |
| E2E 冒烟 | playwright（每个改到的功能至少一个用例） | 跑通主流程 |
| 接口契约校验 | ajv 加在所有 API 边界 | 通过 |

### 5.4 每个功能 PR 必须带的 5 件套
- [ ] 在 `shared/api/<功能名>.yaml` 里加一份 OpenAPI 片段
- [ ] 如动了数据库 schema，加迁移脚本
- [ ] RCON 助手**用录制回放来测**（不是连真服务）
- [ ] UI 组件加 Storybook 或截图测试
- [ ] 如加了新的字段/命令，去更新 `claudedocs/` 里对应的参考文档

### 5.5 完成定义（Definition of Done）
- [ ] 代码读起来像普通英语，注释只在"意图不那么显然"的地方加
- [ ] 没引入 `any`
- [ ] 没提交任何密钥（`.env*` 已加 git 忽略，配置从 compose 环境变量来）
- [ ] `.research/` 下任何文件都没动过
- [ ] 本文件规定的任何一条红线都没违反

---

## 6. 风险地图与验证门槛

### 6.1 真·需要实机验证的 3 件事（在真 U3DS 上跑过才能当真）

来源：`claudedocs/research_verification_tracker.md` 里"真·需实机验证"那一节。

| # | 未知项 | 上线默认采取的行为 | 验证办法 |
|---|---|---|---|
| 1 | 老版本命令行参数（`-port -map -pvp`）还能不能覆盖 `Commands.dat`？ | 面板**只写 `Commands.dat`**；UI 上提示"老版本命令行参数不再支持" | 同时在 `Commands.dat` 里设 `Port 27015`、启动参数加 `-port 27016`；看实际监听哪个端口 |
| 2 | OpenMod 的 `reload` 在生产环境到底稳不稳？ | 默认：保存 `openmod` 配置后，UI 上提示"需重启生效"；额外加个"立即 reload"的开关（实验性） | 装 5 个常用 OpenMod 插件，每个 reload 10 轮，看内存变化和 RCON 响应 |
| 3 | Mod 的 `meta.dat` 里的 `Version` 字段，服务端运行时到底跟客户端对不对版本？ | Mod 卡片里的版本号**只做信息展示，不当守门** | 改 `meta.dat` 里 `Version` 成 `999.999.999`，看连接行为和服务端日志 |

### 6.2 已知不确定（先按当前认知做，错了再改）
- **Steam WebAPI 的 `GetPublishedFileDetails` 接口**：文档说不一定要 API Key，社区库的实践也支持不带 Key 调。**默认不带 Key 调**，用户能自己在设置里填一个换更好的接口。
- **OpenMod RCON 用户格式**：`SteamID:密码`。在面板数据库里**加密存储**；打印日志时**绝不能**带密码部分。
- **`Config.txt` 字段完整性**：官方没发布过一个稳定的字段清单。**按"键-值"通用格式解析**，UI 上做通用渲染。

### 6.3 禁用模式（带理由）

| 禁用模式 | 理由 |
|---|---|
| 编译 `.research/U3-SDK` 然后链入 | 编译出来是客户端不是服务端，链接器会找错符号 |
| 抄 GSM 的 `GameManager.ts` 当起点 | 它的耦合是给 40+ 款通用游戏写的，抄过来会污染未转变者专用的 Mod 工作流 |
| 直接抄 `installgame.json` 那行 tip/port 的**值**到本项目 | tip 是 Windows 变通方案、端口直接抄的 Rust，都不对；只抄字段形态 |
| 抄 GSM 里 minecraft-server-api / factorio-deployer / mrpack-server-api / tmodloader-server-api | 这些是给其他游戏写的，未转变者用不到 |
| 用 Socket.IO | 钉死用 `ws` 才跟 `rcon-srcds` 合拍、后端依赖更少 |
| 给每个服起一个 U3DS 容器 | 违反架构决策第 2 条（共装省 10GB/服） |
| 用 pushrax 那个 `node-rcon` | 2021 年没维护了，用 `rcon-srcds` |
| 承诺"无停机换 Mod" | 热重载不存在，参官方 Issue `U3-SDK/Issues/#1794` |
| 自动跑 `rocket reload` | OpenMod reload 仅作可选，RocketMod reload 直接禁用（U3-SDK/Issues/#1794） |
| 明文存密码 | 应用层用户用 Argon2id；RCON 凭证用 AES-GCM 落库 |

### 6.4 GSM 可抄白名单（颗粒度细化）

> §3.2 已说过「通用工作流可以带入未转变者场景抄」。本节把白名单摊到文件级 + 行级，方便 PR 评审时按图索骥。

| 可抄对象 | GSM 仓里位置 | 抄的姿势（变化点要标注） |
|---|---|---|
| **服务端元数据字段 schema** | `server/data/games/installgame.json` 第 134 行（Unturned） | 抄字段集（`game_nameCN`/`appid`/`tip`/`ports[]`/`image`/`url`/`system[]`/`memory`/`start_command{Windows,Linux}`/`cloud{}`/`docs`/`login_anonymous`）；不抄那行的值——本项目只有一款游戏，但字段集是 Steam 服务端元数据的通用描述，将来想接第二款也有地方放 |
| **SteamCMD 安装 API 形态** | `server/src/routes/steamcmd.ts`（`GET /status` / `POST /install` / `POST /manual-path`） | 路径和返回形态可以照搬；命令本体换成 `+app_update 1110390 validate`；别抄它调用通用安装器的逻辑 |
| **SteamCMD 安装引导（前端组件）** | `client/src/components/onboarding/SteamCMDOnboardingStep.tsx` | 界面分步、Windows/Linux 路径分支、`/root/steamcmd` 默认值、Docker 容器环境的不可改提示——这一套交互可沿用 |
| **PTY 二进制自举脚本** | `start.sh` 第 36–60 行（`ARCH` 判断 → `chmod +x` → ELF 头校验 → 无效则删除并提示重下） | 未转变者没有内置 PTY 桥，所以这条**整体抄**，目的是挂 `node-pty` 时能在面板数据目录自举 PTY 二进制 |
| **Dockerfile 多阶段构建模式** | `Dockerfile`（13 KB） | 第一阶段打包面板源码、第二阶段用 `node:20-slim` 运行镜像的范式可沿用；U3DS 镜像层用 `cm2network/steamcmd` 基础镜像 |
| **docker-compose 拓扑** | `docker-compose.yml` | 两容器同桥接网络 + 共卷挂载 + SteamCMD 容器放侧车（或合并为单容器同时跑面板和服务端） |
| **插件协议模板** | `server/data/plugins/example-plugin/` + 配套的 README | 不抄插件逻辑（GSM 那个示范插件跟未转变者无关），但抄插件的「文件清单形态」和「勾子函数签名」——本项目将来要让第三方扩展就照这个模板发 |
| **引导向导整体编排** | `client/src/components/OnboardingWizard.tsx` | 一步一步走的方式、本地缓存进度、最终一次性提交的逻辑都值得参照 |

**踩过的坑（直接照搬前要确认）**：
1. `installgame.json` 给未转变者配的端口 `28015/28016` —— 别用，是直接抄 Rust 的。未转变者实际是 `27015/27016`（详见 §4.2）。
2. `installgame.json` 那条 tip「`Unturned.exe -batchmode -nographics`」—— Windows 端的事，Linux 上根本不启动 `Unturned.exe`，启动的是 `ServerHelper.sh`。
3. GSM 的 PTY 自举假定有 `data/lib/pty_linux_x64`、`pty_linux_arm64` 两个静态二进制——这些二进制在它的镜像里。本项目要么自己打包进镜像，要么启动时网络下载，要落实这个决策。
4. `installgame.json` 出现的 `cloud` 字段（厂商推广图片）——本项目用不上，跟着 schema 抄过去就行，值留空。

---

## 7. 沟通规则

### 7.1 必须问用户的情况
- 产品需求级模糊（比如「创意工坊浏览器要不要顺带做 Modrinth 和 CurseForge？」）
- 想动 §2 的技术栈铁律
- 想违反已有的 ADR
- 想动 `.research/` 下的任何文件（基本都拒绝——让用户去开新的研究工单）

### 7.2 直接做、别问的情况
- 后端/前端内部的代码组织（文件分哪个目录）
- `shared/` 里工具函数选型（比如金额、时间格式化器选哪个库）
- 错误提示的措辞（先按周边风格对齐再说）

### 7.3 Serena 记忆纪律
- 项目记忆写在 Serena 里，落在 `~/.claude/projects/.../memory/`。
- **文件名是 kebab-case 短横线连接短描述**。
- **一条记忆一个事实**，正文要是纯事实陈述，不要带"这条修正了之前的..."那种描述。
- **写之前**先 search 查重；**写之后**给 `MEMORY.md` 加一行索引。

---

*最近修订：2026-08-06，由 `/sc:load + /sc:design — CLAUDE.md 引导流程`产出。  
本文档是项目宪法，直到下一份 ADR 推翻其中的某条为止。*
