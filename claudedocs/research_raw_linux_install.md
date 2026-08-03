# 子 Agent #1 产物：Unturned Linux 服务端安装与启动（原始交付）

> 来源：deep-research agent 完成于 2026-08-03

## 1. SteamCMD 安装

**Ubuntu/Debian**:
```bash
sudo dpkg --add-architecture i386; sudo apt update
sudo apt install lib32gcc-s1 steamcmd
```

**手动安装 (通用)**:
```bash
mkdir ~/steamcmd && cd ~/steamcmd
curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar zxvf -
```

**Docker**: `cm2network/steamcmd`。Alpine 需额外 bash + libstdc++。置信度：高。

## 2. 下载 U3DS

| 用途 | AppID | 登录 |
|------|-------|------|
| Unturned Dedicated Server | **1110390** | **anonymous** |
| Unturned 客户端 (GSLT) | 304930 | -- |

```bash
steamcmd +login anonymous +force_install_dir /opt/unturned +app_update 1110390 validate +quit
```

AppID 1110390 自发布未变，anonymous 可用。置信度：高。

## 3. 目录结构

```
U3DS/
├── ServerHelper.sh          # Linux 启动入口
├── Unturned_Data/            # Unity 运行时 DLL
├── Servers/
│   └── <ServerID>/
│       ├── Config.txt        # 游戏玩法/难度/浏览器/GSLT (≥3.25.8.0)
│       ├── Server/
│       │   ├── Commands.dat  # 名称/地图/人数/密码/管理员
│       │   ├── Adminlist.dat
│       │   ├── Blacklist.dat / Whitelist.dat
│       │   └── WorkshopDownloadConfig.json
│       └── Level/            # 地图存档
```

Config.json 是旧格式（<3.25.8.0），已废弃。置信度：高。

## 4. 运行时：无需 Mono/.NET SDK

当前 (2026) U3DS 是 Unity headless 构建，内嵌脚本运行时。不需要安装系统级 Mono 或 .NET 8 SDK。只需 lib32gcc-s1。标志：存在 Unturned_Data/Managed/。置信度：中高。

## 5. 启动

```bash
./ServerHelper.sh +InternetServer/MyServer -ThreadedConsole
```

| 参数 | 说明 |
|------|------|
| `+InternetServer/MyServer` | Internet 模式，ServerID=MyServer |
| `+LanServer/MyServer` | LAN 模式 |
| `-ThreadedConsole` | Linux 控制台输入优化，推荐 |

旧 CLI 参数 (-port/-map/-pvp 等) 当前版本写到 Commands.dat，不写命令行。端口默认 UDP 27015 (游戏) + 27016 (查询)。置信度：高。

## 6. systemd Unit

```ini
[Unit]
Description=Unturned Dedicated Server (MyServer)
After=network.target

[Service]
Type=forking
User=unturned
WorkingDirectory=/opt/unturned
ExecStartPre=/usr/games/steamcmd +login anonymous +force_install_dir /opt/unturned +app_update 1110390 +quit
ExecStart=/usr/bin/screen -dmS unturned-myserver /opt/unturned/ServerHelper.sh +InternetServer/MyServer -ThreadedConsole
ExecStop=/bin/bash -c 'screen -S unturned-myserver -p 0 -X stuff "save^Mshutdown^M"; tail --pid=$MAINPID -f /dev/null'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 7. Config.txt 关键段

| 段 | 控制 |
|------|------|
| Browser | 描述/图标/缩略图/链接/**Login_Token (GSLT)** |
| Server | VAC_Secure / BattlEye_Secure / ping / 超时 / 定时重启 |
| Items | 生成概率/消失 |
| Vehicles | 生成/耐久/品质 |
| Zombies | 血量/伤害/密度 |
| Players | 血量/体力/死亡掉落 |
| Barricades/Structures | 建筑限制/衰减 |

实用开关: -LogGameplayConfig, -NoLevelConfigOverrides, -GameplayConfigFile= 等。置信度：高。

## 8. 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 卡 Loading level | 首次生成大图需 5-10min | 等待 |
| 启动崩溃 | Commands.dat 格式错误 | 删除后重启自动生成 |
| 服务器列表不可见 | 未配 GSLT | Config.txt Browser 段设 Login_Token |
| Server Code 每次变 | 未配 GSLT | 同上，用 AppID 304930 在 steamcommunity.com/dev/managegameservers 生成 |
| BattlEye 拒绝 | 客户端 BattlEye 损坏 | 客户端验证游戏文件，不要关服务端 BattlEye_Secure |
| Mod 冲突 | Workshop mod 有问题 | 清空 WorkshopDownloadConfig.json 裸启，逐个加回 |

## 9. 权威来源

| # | URL | 标题 | 类型 |
|---|-----|------|------|
| 1 | docs.smartlydressedgames.com/en/stable/servers/steamcmd.html | Using SteamCMD | 官方 |
| 2 | docs.smartlydressedgames.com/en/latest/servers/server-configuration.html | Server Configuration | 官方 |
| 3 | docs.smartlydressedgames.com/en/stable/servers/server-hosting.html | Setting up a Server | 官方 |
| 4 | developer.valvesoftware.com/wiki/SteamCMD | SteamCMD Linux | Valve 官方 |
| 5 | developer.valvesoftware.com/wiki/Dedicated_Servers_List | Dedicated Servers List | Valve 官方 |
| 6 | unturned.wiki.gg/wiki/Linux_dedicated_server | Linux dedicated server | 社区官方 Wiki |
| 7 | gameserverkings.com | Unturned Config Overview (2026-08-01) | 托管商 |

## 10. 待确认

1. .NET 8 迁移的确切版本号和 SDG 官方公告
2. Alpine Linux (musl) 兼容性
3. 旧 CLI 参数 (-port/-map) 是否仍可覆盖 Commands.dat
4. serverconfig.txt 在当前版本不是标准文件名
