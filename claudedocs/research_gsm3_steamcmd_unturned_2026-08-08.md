# 调研报告：GSM3 的 SteamCMD + Unturned 开服路径

> **日期**：2026-08-08
> **调研对象**：`.research/GameServerManager`（通用游戏管理面板，Go + TypeScript 实现，只读分析）
> **目的**：提取 GSM3 通过 SteamCMD 安装/更新游戏服务端的通用流水线，筛选出对 Unturned 有效的部分
> **性质**：调研结论 + 可借鉴资产清单
> **置信度**：源码实证（高）；Unturned 端口值是已知错误，已标注

---

## 1. 核心结论（TL;DR）

GSM3 的 SteamCMD 安装流水线是一个**通用框架**——从 `installgame.json` 读取游戏元数据，生成 `app_update <appid>` 命令，通过 PTY 终端执行。Unturned 在这个框架里只是一个条目，没有专门逻辑。

**可借鉴资产**：
1. SteamCMD 的 `force_install_dir` + `login anonymous` + `app_update` + `quit` 脚本生成模式
2. PTY 实时输出流（比 spawn stdout 更稳定）
3. Docker 多阶段构建中的 i386/Mono/Unity 依赖清单
4. 安装前 SteamCMD Linux 运行时检测（`ldd linux32/steamcmd`）
5. 操作锁竞态门控模式

**不能照搬**：
- `installgame.json` 中 Unturned 的端口是错的（28015/28016，实际是 27015/27016）
- tip 是 Windows 专有（`Unturned.exe -batchmode -nographics`），Linux 走 `ServerHelper.sh`
- 没有 `start_command` 字段用于 Linux

---

## 2. GSM3 的 SteamCMD 通用安装流水线

### 2.1 命令生成（`gameDeployment.ts:71-87`）

```typescript
function getSteamUpdateCommand(appId: string, branch?: string, betaPassword?: string, validate?: boolean): string {
  const normalizedBranch = normalizeSteamBranch(branch)
  let command = `app_update ${appId}`           // ← 核心指令

  if (normalizedBranch !== 'public') {
    command += ` -beta ${quoteArg(normalizedBranch)}`
    if (betaPassword?.trim()) {
      command += ` -betapassword ${quoteArg(betaPassword.trim())}`
    }
  }

  if (validate) command += ' validate'
  return command
}
```

**Unturned 调用时**（从 `installgame.json` 的 `appid: "1110390"` 传入）：
```bash
steamcmd +force_install_dir /root/games/Unturned +login anonymous +app_update 1110390 validate +quit
```

### 2.2 脚本文件模式（`steamcmdRunScript.ts:54-108`）

GSM3 **不拼接命令行字符串**，而是先生成临时脚本文件，再让 SteamCMD 通过 `+runscript` 执行：

```bash
# 生成的 commands.txt 内容：
@ShutdownOnFailedCommand 1
@NoPromptForPassword 1
force_install_dir "/root/games/Unturned"
login anonymous
app_update 1110390 validate
quit
```

然后执行：
```bash
steamcmd.sh -logdir /tmp/gsm3-steamcmd/tasks/<uuid>/logs +runscript /tmp/gsm3-steamcmd/tasks/<uuid>/commands.txt
```

**优点**：避免命令行转义问题、可审计、脚本文件最多存活 35 分钟后自动清理。

### 2.3 PTY 终端执行（`gameDeployment.ts:1793-1844`）

GSM3 用 PTY 伪终端（非简单的 `child_process.spawn`）执行 SteamCMD，原因：
- SteamCMD 的进度条依赖 TTY 检测
- PTY 保证实时逐行输出（无缓冲）
- 支持交互式输入（Steam Guard 验证码场景）

```typescript
const createResult = await terminalManager.createPty(virtualSocket, {
  sessionId, cols: 80, rows: 24, workingDirectory: steamcmdDir
}, {
  command: [steamcmdPath, ...args],
  redactValues: [steamPassword, betaPassword].filter(Boolean),
  onExit: (code, signal) => {
    if (code === 0) { /* 提交实例配置 */ }
    else { /* 删除失败的实例 */ }
  }
})
```

### 2.4 操作锁模式（`gameDeployment.ts:1337-1352`）

```typescript
installOperationToken = `steam-install-${Date.now()}-${random}`
if (!instanceManager.acquireOperationLock(instanceId, token, 'Steam 服务端安装或更新')) {
  return res.status(409).json({ error: '该实例正在执行其他操作' })
}
```

**对应到我们的架构**：`ServerManager.activeOperation` 字段 + `transition()` 方法，完全同模式。

### 2.5 实例状态门控（`gameDeployment.ts:1007-1011`）

```typescript
if (instance.status !== 'stopped' && instance.status !== 'error') {
  return res.status(400).json({ error: '请先停止实例再更新服务端' })
}
```

**对应到我们的 SOP**：`validate / 更新已加载 Mod / 更新 U3DS 二进制 必须停服`——同一条铁律。

---

## 3. installgame.json 中的 Unturned 条目

**文件**：`server/data/games/installgame.json:134-160`

```json
"Unturned": {
  "game_nameCN": "未转变者",
  "appid": "1110390",
  "tip": "Windows请使用输出流转，启动进程设置为<路径>\\Unturned.exe  -batchmode -nographics",
  "image": "https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/304930/header.jpg",
  "url": "https://store.steampowered.com/app/304930/Unturned/",
  "system": ["Windows", "Linux"],
  "ports": [
    { "port": 28015, "protocol": "tcp/udp" },
    { "port": 28016, "protocol": "tcp/udp" }
  ]
}
```

### 已知问题（已记录在 `prohibitions.md`）

| 字段 | GSM3 的值 | 正确值 | 说明 |
|---|---|---|---|
| `ports[0].port` | `28015` | `27015` | 这是 Rust 的默认端口，不是 Unturned |
| `ports[1].port` | `28016` | `27016` | 同上 |

### GSM3 的 Unturned 启动命令（来源：外部文档）

`installgame.json` 没有 `start_command`，但 GSM3 的配套文档（`docs.gsm.xiaozhuhouses.asia/.../未转变者食用说明.html`）给出了操作流程：

**启动脚本**：`ExampleServer.sh`

这是 U3DS 安装目录下自带的默认启动脚本（SteamCMD `app_update 1110390` 后自动生成）。GSM3 让用户手动填入这个作为"启动参数"。

**GSM3 的完整开服流程**（从外部文档提取）：

```
1. SteamCMD 安装 U3DS（app_update 1110390）
2. 首次启动: ExampleServer.sh
   → 生成 ~/U3DS/Servers/Myserver/Server/Commands.dat（默认配置）
3. 编辑 Commands.dat（Name/Port/Map/MaxPlayers/GSLT 等）
4. 从单机复制 Config.json 到 ~/U3DS/Servers/Myserver/Config.json
5. 再次启动: ExampleServer.sh → 服务器运行
```

**与我们的差异**：

| 维度 | GSM3 | 本项目 |
|---|---|---|
| 启动脚本 | `ExampleServer.sh`（单服，GSM3 命名为 Myserver） | `ExampleServer.sh`（单服，U3DS 原生默认 Default） |
| 配置文件 | `Config.json`（旧格式） | `Config.txt`（≥3.25.8.0 新格式） |
| 应用 Mod | "直接启动即可，不需要更新 steamcmd" | SOP 规定的下载→staging→停服→移动→重启流水线 |
| 端口 | 28015-28016（文档写死） | 27015/27016（Commands.dat 动态配置） |
| `tip` | `Unturned.exe -batchmode -nographics` | Linux 应走 `ExampleServer.sh`（GSM3 未提供 Linux 启动命令） |

### 缺失项

- **无 `start_command`**：GSM3 的 Unturned 条目没有定义启动命令。GSM3 的 `resolvePlatformStartCommand()` 会尝试从"实例市场"API 获取，失败则返回 `"none"`
- **无 RCON 配置**
- **无 Workshop 管理**
- **无 A2S 查询**

---

## 4. Docker 构建中的关键依赖

GSM3 的 Dockerfile（`Dockerfile:1-354`）采用 5 阶段构建：`dependencies → tools → base → builder → runtime`。

### 4.1 对 Unturned 有效的系统依赖（AMD64 专属）

```dockerfile
# i386 运行时（SteamCMD 32 位 + Unity 32 位游戏）
dpkg --add-architecture i386
lib32gcc-s1 libc6-i386 lib32stdc++6 libncurses6:i386
libbz2-1.0:i386 libstdc++6:i386 libssl3:i386

# Unity 游戏服务端（Unturned 用 Unity 2020.3 LTS Mono）
libsdl2-2.0-0 libsdl2-2.0-0:i386
libpulse0 libpulse0:i386
libfontconfig1 libfontconfig1:i386
libudev1 libudev1:i386
libvulkan1 libvulkan1:i386

# Mono 依赖（libgdiplus 是 Unity Mono 的硬依赖）
libgdiplus

# GUI 库（Unity headless 仍需 X11 库，即使无 GUI）
libx11-6 libxt6 libgtk-3-0 libxrandr2 libxcursor1 libxi6
```

### 4.2 SteamCMD 预安装（Dockerfile:246-263）

```dockerfile
# 下载 → 解压 → 首次初始化 → 创建 steamclient.so 符号链接
mkdir -p ${STEAMCMD_DIR}
wget steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
tar -xzvf steamcmd_linux.tar.gz
./steamcmd.sh +quit    # 首次运行完成 self-update
ln -sf ${STEAMCMD_DIR}/linux32/steamclient.so ~/.steam/sdk32/steamclient.so
ln -sf ${STEAMCMD_DIR}/linux64/steamclient.so ~/.steam/sdk64/steamclient.so
```

### 4.3 PTY 二进制自举（start.sh:45-67）

```bash
# 预置 PTY 二进制到 data/lib/，由 ptyAssetCli.js 管理架构选择
if [ "$ARCH" = "x86_64" ]; then
  PTY_FILE="$RUNTIME_LIB_DIR/pty_linux_x64"
fi
# 验证 ELF → chmod +x 或删除后由服务端自动重新下载
```

**对应到我们的架构**：Phase 5（PTY 自举）可借鉴此模式——在 Dockerfile 中预置架构匹配的 PTY 二进制，start.sh 验证完整性。

---

## 5. Linux SteamCMD 运行时检测（`gameDeployment.ts:538-600`）

GSM3 在安装/更新前执行 Linux 环境预检：

```typescript
async function checkLinuxSteamCMDRuntime(steamcmdDir: string) {
  // 1. 检查 linux32/steamcmd 是否存在
  const linux32Steamcmd = path.join(steamcmdDir, 'linux32', 'steamcmd')

  // 2. 查 ELF loader ld-linux.so.2 是否存在（4 个候选路径）
  const loaderCandidates = [
    '/lib/ld-linux.so.2', '/lib32/ld-linux.so.2',
    '/lib/i386-linux-gnu/ld-linux.so.2', '/usr/lib/i386-linux-gnu/ld-linux.so.2'
  ]

  // 3. ldd 检测缺失的 32 位库
  ldd linux32/steamcmd
  // 输出含 "not found" → 生成修复命令（按发行版区分 apt/dnf/pacman/zypper）
}
```

**返回结构**（给前端展示用）：
```json
{
  "message": "当前 Linux 系统缺少 32 位 ELF loader...",
  "fixCommands": ["dpkg --add-architecture i386", "apt-get install -y libc6:i386 ..."]
}
```

**对应到我们的架构**：可以在安装向导的 SteamCMD 配置步骤增加预检，提前发现依赖缺失。

---

## 6. 可借鉴资产汇总

### 6.1 直接可借鉴的代码模式

| GSM3 资产 | 位置 | 借鉴内容 | 对应本项目的用途 |
|---|---|---|---|
| `getSteamUpdateCommand()` | `gameDeployment.ts:71-87` | `app_update <id> [-beta] [validate]` 命令构建 | `SteamCmdManager.updateU3DS()` / `downloadWorkshopItem()` |
| `createSteamCMDRunScript()` | `steamcmdRunScript.ts:54-108` | 脚本文件 → `+runscript` 执行（安全、可审计） | 替代裸 `spawn` 拼接命令行 |
| `checkLinuxSteamCMDRuntime()` | `gameDeployment.ts:538-600` | `ldd` 检测 + 按发行版生成修复命令 | 安装向导预检步骤 |
| `acquireOperationLock()` | `gameDeployment.ts:1337-1352` | token-based 操作锁 + 409 冲突响应 | `ServerManager.activeOperation`（已有同模式） |
| 实例状态门控 | `gameDeployment.ts:1007-1011` | `status !== 'stopped' → 400 拒绝` | SOP §重启/改 Mod 流水线（已有铁律） |
| SteamCMD 安装脚本（Dockerfile） | `Dockerfile:246-263` | wget → tar → `+quit` 初始化 → steamclient.so 符号链接 | 我们的 Dockerfile |
| PTY 二进制管理 | `start.sh:45-67` + `ptyAssetCli.js` | 架构感知的预置 + 运行时自动下载回落 | Phase 5 PTY 自举 |

### 6.2 系统依赖清单（Dockerfile 提取）

以下是从 GSM3 Dockerfile 提取的、已验证对 Unity 游戏（Unturned）有效的依赖清单：

```
# i386 架构支持
dpkg --add-architecture i386

# SteamCMD 32 位运行时
libc6:i386 libstdc++6:i386 libgcc-s1:i386 lib32gcc-s1
libc6-i386 lib32stdc++6 libncurses6:i386

# Unity 引擎依赖（Unturned 用 Unity 2020.3 LTS）
libsdl2-2.0-0 libsdl2-2.0-0:i386
libpulse0 libpulse0:i386
libfontconfig1 libfontconfig1:i386
libvulkan1 libvulkan1:i386
libudev1 libudev1:i386

# Mono 依赖（Unity Mono 脚本后端）
libgdiplus

# X11 客户端库（Unity headless 模式仍需）
libx11-6 libxt6 libgtk-3-0
libxrandr2 libxcursor1 libxi6 libxtst6
```

### 6.3 不可借鉴的（GSM3 缺失项）

| 缺失能力 | 说明 |
|---|---|
| 游戏启动命令 | `installgame.json` 没有 Unturned 的 Linux 启动命令 |
| 端口配置 | 端口值是错的（28015 是 Rust 的），且没有 RCON 端口概念 |
| RCON 通信 | 完全没有 |
| A2S 状态查询 | 完全没有 |
| Workshop Mod 管理 | 完全没有 |
| 配置文件管理 | Connections.dat / Config.txt 等零支持 |
| Multi-ServerID 共享安装 | 没有这个概念（GSM3 每实例独立安装目录） |

---

## 7. 对本项目的具体落地建议

### 7.1 Dockerfile 依赖清单

**直接采用** GSM3 的 i386/Mono/Unity 依赖清单，这是经过生产验证的。补充 `mono-complete`（我们的 SOP 要求）。

### 7.2 SteamCMD 命令生成

**借鉴** `getSteamUpdateCommand()` 和 `createSteamCMDRunScript()` 的模式：
- U3DS 安装：`app_update 1110390 validate`
- Workshop 下载：`workshop_download_item 304930 <id>`（⚠️ 2026-08-11 修正：必须用游戏本体 304930，非服务端 1110390；staging 路径用 `force_install_dir` 指定）
- 用脚本文件 + `+runscript` 替代字符串拼接（更安全）

### 7.3 PTY 自举

**借鉴** `start.sh` 的 PTY 预置 + 运行时下载回落模式。在 Dockerfile 中随镜像分发 PTY 二进制，start.sh 入口做 ELF 校验。

### 7.4 操作锁

**已有同模式**，无需修改。`ServerManager.activeOperation` 就是 GSM3 的 `acquireOperationLock` 对应物。

### 7.5 不采用的部分

- 不采用 GSM3 的"实例市场"API（外部依赖，不可控）
- 不采用 `installgame.json` 的端口值（明确是错误的）
- 不采用 Windows tip（我们是 Linux 专有）
- 不采用 SSE 流式推送（我们用 WebSocket）

---

## 8. 参考文件索引

| 内容 | GSM3 文件 |
|---|---|
| Unturned 游戏元数据 | `server/data/games/installgame.json:134-160` |
| SteamCMD 安装/管理 | `server/src/modules/steamcmd/SteamCMDManager.ts` |
| 游戏安装流水线 | `server/src/routes/gameDeployment.ts` |
| SteamCMD 脚本生成 | `server/src/utils/steamcmdRunScript.ts` |
| Docker 构建 | `Dockerfile` |
| Docker 部署拓扑 | `docker-compose.yml` |
| 容器启动脚本 | `start.sh` |
| SteamCMD Web 路由 | `server/src/routes/steamcmd.ts` |

---

*本报告为调研产出，仅提供事实与建议；后续架构决策请在 `/sc:design` 完成，实现在 `/sc:implement` 完成。*
