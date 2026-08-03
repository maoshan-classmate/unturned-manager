# RCON 库补充调研：Node.js 生态系统

> 来源：deep-research agent 完成于 2026-08-03

## 核心结论

**Unturned 没有内置 RCON 协议。RCON 由插件框架提供。不存在专门的 "unturned-rcon" npm 包。**

| 框架 | RCON 协议 | Node.js 方案 |
|---|---|---|
| OpenMod | Valve Source RCON (TCP 二进制) | `rcon-srcds` npm |
| RocketMod/LDM | Telnet (明文行) | `net` 模块（几十行代码） |

---

## Node.js RCON 库推荐

### 🥇 rcon-srcds（首选）
- **npm**：`rcon-srcds` | **GitHub**：EnriqCG/rcon-srcds
- **语言**：TypeScript，零依赖
- **协议**：Valve Source RCON（支持多包响应）
- **特点**：最活跃维护，async/await API，良好的超时处理
- **适用**：OpenMod RCON

```js
import { Rcon } from 'rcon-srcds';
const rcon = new Rcon({ host: '127.0.0.1', port: 25545 });
await rcon.authenticate('ServerOwner:Jingle');
const players = await rcon.execute('Players');
```

### 🥈 @fabricio-191/valve-server-query（最全面）
- **npm**：`@fabricio-191/valve-server-query`
- **语言**：TypeScript, 258 commits
- **协议**：A2S_INFO + A2S_PLAYER + A2S_RULES + RCON（完整 Valve 协议套件）
- **适用**：既需要 RCON 又需要服务器状态查询（玩家数/地图/maxplayers）

### 🥉 node-rcon（原始方案）
- **npm**：`rcon` | **GitHub**：pushrax/node-rcon
- **语言**：JavaScript, 53 commits
- **状态**：维护不活跃（最后发布 ~2021）
- **备选**：ts-rcon（TypeScript 重写）, working-rcon（跨游戏兼容性）

### RocketMod Telnet Fallback
```js
const net = require('net');
const client = net.createConnection({ host: '127.0.0.1', port: 27117 }, () => {
  client.write('login YourPassword\n');
  client.write('Players\n');
});
client.on('data', (data) => console.log(data.toString()));
```

---

## 其他语言参考

| 语言 | 推荐库 | 说明 |
|---|---|---|
| Go | gorcon/rcon (120★ MIT) | 测试过 Project Zomboid/Rust/ARK/CS:GO/Minecraft 等 |
| C# | CoreRCON (NuGet v5.4.2) | .NET Standard, 测试过 CS2/TF2/Minecraft/ARK/Palworld |
| Python | python-valve (200★, 不再维护) | 备选 conqp/rcon (归档) |
| C++ | rconpp (16★, 2026-03 更新) | 现代 C++ |

---

## Web 面板参考项目

| 项目 | 类型 | 说明 |
|---|---|---|
| **RCON Web Admin** | Node.js Web 面板 (通用) | 功能最全的通用 RCON Web 面板：多服务器/多用户/自动化/响应式 UI。可适配 Unturned + OpenMod。 |
| **Pustalorc/UnturnedServerManager** | C# 桌面应用 | Unturned 专用。非 Web。但 Workshop/RCON/多服务器管理逻辑可参考。 |
| **LinuxGSM untserver** | Bash | 命令行管理。与 GameServerApp (商业) 集成的 Web 面板方法。 |

## 关键结论

- 对 **OpenMod** → `rcon-srcds` (npm)
- 对 **RocketMod** → Node.js `net` 模块 (纯 Telnet)
- **不存在** Unturned Web RCON 面板的即用型开源方案 → 差异化空间
- 最接近的起点：fork RCON Web Admin 或用 rcon-srcds + @fabricio-191/valve-server-query 从零构建

## Steam WebAPI Workshop 补充

- `ISteamRemoteStorage/GetPublishedFileDetails/v1` **可能**不需要 API Key（xPaw 文档中参数表不含 key）
- **确定不需要登录的方案**：`https://steamcommunity.com/sharedfiles/filedetails/?id=<ID>&xml=1`（XML 格式，无需认证）
- Steam WebAPI Key 获取：`steamcommunity.com/dev/apikey`（免费，10万次/天，需 Steam 消费 $5+ 的账号）
- `IPublishedFileService/GetDetails` 功能最全（含 children/dependencies），但需要 Key

## RocketMod / OpenMod 插件配置可视化

- **RocketMod**：`Rocket/Plugins/<Name>/Configuration.xml`（XML，部分新插件 JSON），**不建议热 reload**（已知破坏插件）
- **OpenMod**：`openmod/plugins/<Id>/config.yaml`（YAML），**官方支持热 reload**（前提是插件不缓存配置值）
- 两者都没有标准 Schema 定义工具——面板需要通用 XML/YAML→表单渲染器
- 修改配置后 OpenMod 可通过 RCON 执行 `openmod reload <PluginId>` 使其生效
