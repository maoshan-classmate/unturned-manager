# 子 Agent #5 产物：同类游戏服务端 Web 面板（原始交付）

> 来源：deep-research agent 完成于 2026-08-03

## 竞品速查

| 面板 | 开源 | 许可证 | 前端 | 后端 | 守护进程 | 内置 Workshop 浏览器 |
|---|---|---|---|---|---|---|
| **Pterodactyl** | ✅ | MIT | React+TS+Tailwind | PHP(Laravel) | Wings(Go) | ❌ |
| **Pelican** | ✅ | AGPL-3.0 | FilamentPHP(Blade) | PHP(Laravel) | Wings(Go) | ❌ |
| **AMP** | ❌ | 商业 $10-40 | 原生 HTML/JS | .NET/C# | 无(原生进程) | ✅ (2.7 Deimos) |
| **PufferPanel** | ✅ | Apache-2.0 | Vue.js | Go(单体) | pufferd(同二进制) | ❌ |
| **TCAdmin** | ❌ | 商业 $7.95/月起 | 原生 HTML/.aspx | .NET/C# | Remote Agent | 插件化 |
| **Crafty Controller** | ✅ | GPL-3.0 | AdminLTE(jQuery) | Python(Tornado) | 无(子进程) | ❌ |
| **LinuxGSM** | ✅ | MIT | 无 Web UI | Bash | tmux | ❌ |

## 关键发现

1. **Pterodactyl** (9.1k★ MIT)：最成熟开源方案。Panel(React+PHP) + Wings(Go) + Docker。Egg 模板系统管理 SteamCMD。WebSocket 实时控制台。50+ 粒度权限 (admin/subuser)。**但无面板级 RCON 抽象，无 Workshop 浏览器。**

2. **Pelican** (2.2k★ AGPLv3)：Pterodactyl 社区 Fork (2024)。FilamentPHP 替代 React SPA。兼容 Ptr Eggs。更活跃。

3. **AMP** (.NET 商业)：**唯一内置 Steam Workshop 浏览器的面板** (2.7 Deimos)。还支持 Modrinth/CurseForge。ADS 实例管理器 + 每 server 独立 AMP。无 Docker 依赖。

4. **PufferPanel** (1.7k★ Apache-2.0)：Go 单体二进制 + Vue.js。最轻量。

5. **TCAdmin** (商业)：GSP 行业标准。.NET+Windows 重。Mod Manager + Workshop 插件。

6. **Crafty Controller** (Python)：Minecraft 专用，SteamCMD "即将推出"。与本项目相关性低。

7. **LinuxGSM** (Bash MIT)：142+ 游戏，SteamCMD 极度完善。**无 Web UI**。

8. **Unturned 专用 Web 面板**：不存在活跃开源项目。社区靠 Pterodactyl Egg + RocketMod/OpenMod。

## 前端技术栈参考

| 面板 | 前端 |
|---|---|
| Pterodactyl | React + TypeScript + Tailwind |
| Pelican | FilamentPHP (Laravel Blade + Tailwind) |
| PufferPanel | Vue.js |
| AMP/TCAdmin/Crafty | 传统非 SPA |

## RCON/控制台 最佳实践

- Pterodactyl/Pelican: WebSocket 实时推送 (Wings→Panel ConsoleOutputEvent)
- AMP: WebSocket/HTTP + 内置 RCON 支持 + 定时调度
- 其他: 轮询或进程 stdout 流

## 来源 (18条，详见原始交付)
