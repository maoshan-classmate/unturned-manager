# unturned-manager

Unturned Linux 服务端的 Web 管理面板。在一台机器上同时跑多个服务端实例，浏览器点点鼠标就能装服务端、下 Mod、装插件、看日志、改配置。

## 这是什么

`unturned-manager` 是一个自托管的 Web 面板，用来管理 Unturned 专用服务端二进制（Steam AppID 1110390）。所有实例共用同一个服务端安装目录，省磁盘；面板通过持久控制台会话与各实例通信，所有命令都从浏览器发出，不需要 SSH。

面向场景：在家里或小机房开多个 Unturned 私服，长期运维。

不适合：你只是偶尔想和朋友开一局——直接用游戏内建的多人功能。

## 快速开始

需要：一台 Linux 机器（Ubuntu 22.04+ / Debian 11+ 已验证），Docker + Docker Compose，2 GB 以上空余磁盘。

```bash
git clone <仓库地址> unturned-manager
cd unturned-manager
cp .env.example .env
docker compose up -d --build
```

首次启动需要几分钟——Docker 会从镜像初始化 SteamCMD，并预拉取面板本体。启动完成后在浏览器打开：

```
http://<服务器IP>:3020
```

默认登录账号：`admin` / `123456`。**首次登录后立刻在「系统设置」改密码。**

## 首次使用

进入面板后，建议按顺序走一遍：

1. **「Server Setup」页面** → 点「安装服务端」按钮，面板会通过 SteamCMD 下载 Unturned 服务端二进制到 `/opt/unturned`。这是引导式的——不会自动跑。
2. **「Dashboard」页面** → 点「创建实例」，填实例名（如 `MyServer`）、端口（默认 27015）、你的 SteamID64（用作 Owner）。面板会自动建立实例目录、生成默认 `Commands.dat`。
3. **「Console」页面** → 选刚才创建的实例，点「启动」。你能看到 Unturned 服务端的实时输出。在终端里输入 `Players` 看在线玩家，输入 `Shutdown` 关服。
4. **「系统设置」页面** → 改 admin 密码、配置 Mod 浏览用的 Steam WebAPI Key。

## 常用操作

### 安装 Steam Workshop Mod

进入「Mods」页面，「浏览」标签搜索你想装的 Mod（按名称或 Steam 创意工坊 ID），勾选后点「下载」。面板会把 Mod 下载到实例目录的 staging 子目录。

下载完成 ≠ 生效。点实例卡片上的「重启」按钮，Unturned 会重新加载 Mod 列表——这一刻 Mod 才真正可用。面板在重启前会提示你确认。

### 上传 Mod / 配置文件

进入「Files」页面，选中实例目录的某个子目录（如 `Server/`、`Bundles/Workshop/`），右键「上传」把本地文件拖到面板。`Commands.dat`、`Config.txt`、LDM 插件的 `.dll` 都从这里传。

注意：`Commands.dat` 和 `Config.txt` 上传后会在下次服务端重启时生效。LDM 插件的 `.dll` 上传后是**即时生效**的——面板会自动通知服务端加载。

### 编辑服务端配置

「Config」页面分多个子页：

- **Commands.dat**——实例基础配置（名称、端口、玩家上限、地图、模式）。改动后保存，写到磁盘；下次重启生效。
- **Config.txt**——玩法/浏览器配置（视角、PvP、加载距离、过夜加速等）。
- **Mod 列表**——勾选启用哪些 Mod，等同于编辑 `WorkshopDownloadConfig.json`。保存后下次重启生效。
- **Mod 框架**——LDM（Legally-Distinct-Missile）插件管理：上传 .dll、加载/卸载插件、编辑框架配置。

### 改完 Mod / 配置后必须重启

Unturned 没有热重载。任何对 Mod 列表、`Commands.dat`、`Config.txt`、LDM 插件配置的改动，必须在「Dashboard」点实例的「重启」按钮才会真正生效。面板在改动后会提示你。

### 备份

实例的所有数据都在宿主机的 `./opt/unturned/Servers/<实例名>/` 下。要备份直接复制整个实例目录即可。面板数据（用户、设置、Mod 列表状态）在 `./data/` 下。

## 环境变量

复制 `.env.example` 为 `.env` 后可调整的变量：

| 变量 | 默认 | 含义 |
|---|---|---|
| `SERVER_PORT` | `3001` | 面板内部 HTTP 端口（容器内）。宿主机通过 `3020:3001` 映射访问 |
| `HOST` | `0.0.0.0` | 面板监听地址 |
| `LOG_LEVEL` | `info` | 日志级别（debug / info / warn / error） |
| `DB_PATH` | `/data/unturned-manager.db` | SQLite 数据库路径（容器内） |
| `DATA_DIR` | `/data` | 面板运行时数据目录 |
| `INSTALL_DIR` | `/opt/unturned` | Unturned 服务端安装根目录。**改这个值前必须确认目录已挂载到容器** |
| `STEAMCMD_DIR` | `/opt/steamcmd` | SteamCMD 安装路径 |
| `CORS_ORIGIN` | `*` | CORS 允许的来源。生产环境改成你的面板域名 |
| `JWT_SECRET` | （开发默认） | JWT 签名密钥。**生产必须改成至少 32 位随机字符串** |
| `ENCRYPTION_KEY` | （开发默认） | 落库凭证的 AES-GCM 加密密钥。**生产必须改成随机的 32 字节 Base64** |
| `ADMIN_PASSWORD` | （开发默认） | 首启 admin 账号密码。**生产必须改成强密码** |
| `HTTP_PROXY` / `HTTPS_PROXY` | 空 | 出站代理。如果你的网络到 Steam 不通需要走代理就填，否则留空 |

**修改 `.env` 后必须重启容器**：`docker compose up -d`（不是 `up --build`，除非镜像本身变了）。

## 常见问题

### 忘了 admin 密码

```bash
docker compose down
# 删掉数据库文件
rm -f ./data/unturned-manager.db
docker compose up -d
```

面板会重新初始化数据库，并从 `.env` 读取 `ADMIN_PASSWORD` 创建新密码。**注意：实例数据、Mod 列表、设置都会保留，因为这些不在 SQLite 里。**

### 「安装服务端」按钮点了但一直卡在下载中

打开实例的「Console」页面查看进度。如果一直 0%，通常是网络问题——Steam 下载 CDN 在某些地区不通。编辑 `.env` 填 `HTTP_PROXY` 和 `HTTPS_PROXY` 指向你的代理服务，重启容器后重试。

### 启动实例时控制台没输出

等 30 秒——Unturned 服务端首次启动会生成世界、加载 Mod，耗时较久。如果 1 分钟后仍无输出，检查「Dashboard」上的实例状态是不是「STARTING」——如果是「STOPPED」，去「Console」页面看最后几行日志的报错。

### 端口冲突

每个实例在 `Commands.dat` 的 `Port` 字段占一个 UDP 端口（默认 27015）。多实例每个要不同端口。要让面板外的玩家能连到你的实例，还需要在 `docker-compose.yml` 的 `ports` 段追加端口映射：

```yaml
ports:
  - "3020:3001"
  - "28015:27015/udp"
  - "28016:27016/udp"  # 第二个实例的端口
```

改完后 `docker compose up -d`（会自动重建）。

### 服务端崩溃后没自动重启

面板默认在 5 秒后硬重启实例。如果实例状态卡在「STOPPED」超过 10 秒，去「Console」看 `Server is ready` 或 `World saved` 这类标志有没有出现；如果没有就是启动失败，需要人工排查。

### 数据备份还原

```bash
# 备份
tar czf backup-$(date +%Y%m%d).tar.gz ./opt/unturned ./data

# 还原到新机器
tar xzf backup-20260820.tar.gz -C /path/to/unturned-manager
docker compose up -d
```

实例目录里的 `Servers/<实例名>/Workshop/Steam/content/304930/` 是 Mod 已下载的内容，备份它就能避免重下。

## 端口总览

| 端口 | 用途 |
|---|---|
| 3020 | 面板 Web（浏览器访问） |
| 3001 | 面板内部 HTTP（容器内，对应 3020） |
| 27015 | Unturned 实例默认游戏端口（UDP） |
| 27016 | Unturned 实例默认查询端口（UDP） |
| 25545 | Mod 框架（LDM）远程控制端口（可选） |

## 系统要求

- 操作系统：Linux（Ubuntu 22.04+ / Debian 11+ 已验证）。Windows / macOS 可运行但未充分测试。
- Docker 20.10+ 与 Docker Compose v2
- 磁盘：基础镜像约 4 GB；每个服务端实例 1-3 GB；每个 Mod 10 MB - 1 GB
- 内存：单个实例约 500 MB - 2 GB；多实例按需扩展

## 许可证

MIT。