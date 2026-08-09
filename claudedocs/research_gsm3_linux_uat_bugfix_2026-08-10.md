# GSM3 对照分析 — 9 个 Linux UAT BUG 修复决策表

> **文档类型**：调研产出（一次性的，Sprint 完成后归档/吸收）
> **产生日期**：2026-08-10
> **触发来源**：`/sc:design` —— 用户要求 1:1 抄 GSM3（生产验证过的），不能抄的列出来拍板
> **对照基准**：`.research/GameServerManager`（GSM3 仓库，已 clone）
> **结论先行**：9 个 BUG 中 **6 个可直接抄核心算法 / 1 个改后抄 / 2 个不能抄**（架构不同）

---

## 0. TL;DR 决策矩阵

| BUG | 状态 | GSM3 借鉴位置 | 风险 |
|---|---|---|---|
| 1 SteamCMD 检查更新 404 | 🟢 1:1 抄 | `routes/steamcmd.ts:34-62` SSE 端点形态 | 低 |
| 2 安装 U3DS 无进度 | 🟢 改后抄 | `steamcmd/SteamCMDManager.ts:163-220` `installOnline` callback 模式 | 中 |
| 3/7 启动脚本 500 找不到 U3DS | 🟢 1:1 抄 | `instance/InstanceManager.ts:202-225 + 885-905` 检测+chmod | 0（已抄） |
| 4 docker-compose 挂载目录 | 🟡 改后抄 | `docker-compose.yml:23-32` + `start.sh:18-30` 补缺逻辑 | 低 |
| 5 模组下载按钮不消失 | 🔴 不能抄 | GSM3 **没有 Steam Workshop 浏览/下载 UI**（走 packageManager） | 自主实现 |
| 6 Workshop Tab 看不到已下载 mod | 🔴 不能抄 | GSM3 走 **preset** 模型（不是 Workshop acf） | 自主实现 |
| 9 SteamCMD 版本不展示 | 🟢 1:1 抄 | `steamcmd/SteamCMDManager.ts:115-133` | 0（增字段即可） |
| 10 Dockerfile 镜像源慢 | 🟡 改后抄 | GSM3 `Dockerfile:84` 已 `npm config set registry https://registry.npmmirror.com`；apt 没换 | 低 |
| 1 附 SteamCMD 重装 404 | 🟢 1:1 抄 | `routes/steamcmd.ts:34-62` `install` 端点 | 低 |

**🔴 2 个不能抄**：BUG-5、BUG-6 —— **GSM3 走 SteamCMD 集成（preset 模式），不是 Steam Workshop 浏览器**。GSM3 的「Mods」是 preset 文件树（preset 目录 = Mod 集合），它**不调 Steam WebAPI**，**不扫 appworkshop_1110390.acf**。架构差异决定这是「不同的产品设计」，不是代码复用。

---

## 1. GSM3 仓库关键模块定位

通过 `.research/GameServerManager` 全局扫描产出的关键路径：

```
.research/GameServerManager/
├── Dockerfile                                        # 镜像构建（GSM3 装 SteamCMD，但不装 U3DS）
├── start.sh                                          # 容器入口（PTY 校验 + 插件补缺）
├── docker-compose.yml + docker-compose-arm64.yml     # 多架构 compose
├── server/src/
│   ├── modules/
│   │   ├── steamcmd/SteamCMDManager.ts               # ★ SteamCMD 核心（含 install/getStatus/version）
│   │   ├── instance/InstanceManager.ts               # ★ 实例生命周期（detectStartScript + chmod）
│   │   ├── environment/                             # 环境管理（java/directx/packageManager）
│   │   ├── terminal/TerminalManager.ts              # PTY 抽象（GSM3 走 PTY,我们走 stdio）
│   │   ├── gameConfig/                               # 游戏配置（preset 模型）
│   │   ├── scheduler/                                # 计划任务（TODO:对照 BUG-8 暂缓）
│   │   └── task/                                     # 任务调度
│   ├── routes/
│   │   ├── steamcmd.ts                               # ★ SSE 推进度模式
│   │   ├── gameDeployment.ts                         # ★ 通用化 app_update 命令构造
│   │   ├── scheduledTasks.ts                         # 计划任务路由（BUG-8 暂缓，决策参考）
│   │   └── instances.ts                                # 实例 CRUD
│   └── utils/
│       ├── steamcmdRunScript.ts                       # ★ runscript 模板
│       └── tarSecurityFilter.ts
└── client/src/
    ├── pages/Instance.tsx + InstanceDetail.tsx       # GSM3 实例 UI（参考布局）
    └── hooks/                                        # 复用率低（axios + zustand 风格不同）
```

---

## 2. 逐 BUG 对照 + 1:1 抄代码骨架

### 🟢 BUG-9：SteamCMD 版本不展示 —— **1:1 抄**（最小改动）

**根因**（已 verify）：`SteamCmdManager.ts:54-63 getStatus()` 返回值不带 `version` 字段。

**GSM3 做法**（`SteamCMDManager.ts:115-133`）：
```typescript
// ─── GSM3 1:1 抄 ───
async getStatus(): Promise<SteamCMDStatus> {
  const config = this.configManager.getSteamCMDConfig();

  if (config.installMode === 'manual' && config.installPath) {
    const isInstalled = await this.checkSteamCMDExists(config.installPath);
    return {
      isInstalled,
      installPath: config.installPath,
      lastChecked: new Date().toISOString(),
      // ★ 关键：manual 模式不返回 version，符合预期
    };
  }

  return {
    isInstalled: config.isInstalled,
    version: config.version,                // ★ version 字段从 config 取
    installPath: config.installPath,
    lastChecked: config.lastChecked,
  };
}
```

**本项目改造**（**改后抄**：用进程解析替代 config 字段）：
```typescript
// manager-server/src/modules/steamcmd/SteamCmdManager.ts:54-63 改造
async getStatus(): Promise<SteamCmdStatus> {
  const exePath = this.steamCmdPath ?? this.findSteamCmd();
  const isInstalled = exePath !== null && fs.existsSync(exePath);

  // ★ 新增：spawn `steamcmd +version` 解析版本
  let version: string | undefined;
  if (isInstalled && exePath) {
    try {
      const { stdout } = await execFileAsync(exePath, ['+version', '+quit'], { timeout: 10_000 });
      const match = stdout.match(/Version\s+(\d+)(?:\s*-\s*([^\n]+))?/);
      if (match) {
        version = match[2] ? `${match[1]} (${match[2].trim()})` : match[1];
      }
    } catch (err) {
      logger.warn({ err, exePath }, 'SteamCMD 版本解析失败');
    }
  }

  return {
    isInstalled,
    installPath: exePath ?? undefined,
    version,           // ★ 新增字段
    lastChecked: new Date().toISOString(),
  };
}
```

**GSM3 文件**：`server/src/modules/steamcmd/SteamCMDManager.ts:115-133`
**本项目触达**：`manager-server/src/modules/steamcmd/SteamCmdManager.ts:54-63`
**前端无需改动**（`status.version` 已渲染）。
**工时**：0.5 天（含单测）
**不能完全 1:1 抄的原因**：GSM3 用 `configManager.getSteamCMDConfig().version`（持久化），本项目目前靠运行时 spawn 解析——架构差异。

---

### 🟢 BUG-1：SteamCMD 检查更新 404 + BUG-1 附：SteamCMD 重装 404 —— **1:1 抄 SSE 路径**

**根因**（已 verify）：`routes/steamcmd.ts` 只有 `/status`、`POST /update`、`POST /download-workshop`，无 `/check-update` / `/reinstall`。

**GSM3 做法**（`routes/steamcmd.ts:34-130`）：
```typescript
// ─── GSM3 1:1 抄（SSE 模式）───
router.post('/install', authenticateToken, async (req, res) => {
  const { installPath } = req.body;

  if (!installPath || typeof installPath !== 'string') {
    return res.status(400).json({ success: false, message: '请提供有效的安装路径' });
  }

  // ★ 关键：SSE 响应头（不用 WebSocket）
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await steamcmdManager.installOnline({
      installPath,
      onProgress: (progress) => sendEvent('progress', { progress }),
      onStatusChange: (status) => sendEvent('status', { status }),
    });
    sendEvent('complete', { success: true, message: 'SteamCMD安装完成' });
    res.end();
  } catch (error) {
    sendEvent('error', { success: false, message: 'SteamCMD安装失败', error: ... });
    res.end();
  }
});
```

**本项目需要决策**：

| 决策项 | 方案 A | 方案 B |
|---|---|---|
| 进度推送 | **沿用本项目 WS 架构**（不变） | 改 SSE（对齐 GSM3） |
| 影响 | 不动 WS gateway | 改 streaming + 拆 Vite 代理配置 |
| 推荐 | **A**（本项目 SPEC 已锁 WS `rcon-protocol.md`） | B 推翻已落地的架构决策 |

**本项目选择方案 A（沿用 WS）**，但**抄 GSM3 的 `onProgress` / `onStatusChange` callback 模式**：

```typescript
// manager-server/src/routes/steamcmd.ts 追加（POST /check-update + POST /reinstall）
const CheckUpdateSchema = z.object({
  installDir: z.string().optional(),   // 内部探测或前端传入
});

router.post(
  '/check-update',
  validate(CheckUpdateSchema),
  asyncHandler(async (req, res) => {
    const { installDir } = req.body as { installDir?: string };
    try {
      const result = await steamCmdManager.checkUpdate(installDir);
      res.json({ data: result });
    } catch (err) {
      if (err instanceof Error && err.message.includes('未安装')) {
        throw new AppError('steamcmd-not-found', 'SteamCMD 未安装', 404);
      }
      throw err;
    }
  }),
);

router.post(
  '/reinstall',
  validate(CheckUpdateSchema),
  asyncHandler(async (req, res) => {
    const { installDir } = req.body as { installDir?: string };
    try {
      await steamCmdManager.reinstall(installDir);
      res.status(202).json({ data: { message: 'SteamCMD 重装已启动' } });
    } catch (err) {
      throw err;
    }
  }),
);
```

```typescript
// SteamCmdManager.ts 追加（抄 GSM3 SteamCMDManager.ts:163-220 installOnline 模式）
async checkUpdate(installDir?: string): Promise<{ currentBuildId: string | null; latestVersion: string; lastChecked: string }> {
  const exePath = this.steamCmdPath ?? this.findSteamCmd();
  if (!exePath || !fs.existsSync(exePath)) {
    throw new Error('SteamCMD 未安装');
  }
  const targetDir = installDir ?? this.lastInstallDir ?? '/opt/steamcmd';
  const { stdout } = await execFileAsync(exePath, ['+login', 'anonymous', '+app_info_print', '1110390', '+quit'], { timeout: 30_000 });
  const buildIdMatch = stdout.match(/buildid[\s"]+(\d+)/);
  const nameMatch = stdout.match(/name[\s"]+([^"\n]+)/);
  return {
    currentBuildId: buildIdMatch?.[1] ?? null,
    latestVersion: nameMatch?.[1]?.trim() ?? 'unknown',
    lastChecked: new Date().toISOString(),
  };
}

async reinstall(installDir?: string): Promise<void> {
  // ★ 抄 GSM3 installOnline：HTTP 下载 + tar 解压 + +quit 初始化
  const targetDir = installDir ?? this.findSteamCmd() ?? '/opt/steamcmd';
  const downloadPath = path.join(targetDir, 'steamcmd_linux.tar.gz');
  // ... 抄 GSM3 lines 170-220
}
```

**GSM3 文件**：`server/src/routes/steamcmd.ts:34-130` + `server/src/modules/steamcmd/SteamCMDManager.ts:163-220`
**本项目触达**：`manager-server/src/routes/steamcmd.ts` + `SteamCmdManager.ts`
**工时**：1.5 天（含单测）

---

### 🟢 BUG-3/7：启动脚本 500 找不到 U3DS —— **1:1 抄（已抄）**

**根因**（已 verify）：Docker 镜像 `node:20-slim` 没装 mono-complete + Docker 镜像不装 U3DS + 前端"安装 U3DS"按钮调错路径。

**GSM3 做法**（`instance/InstanceManager.ts:202-225 + 885-905`，已 1:1 抄到本项目）：

```
本项目:manager-server/src/modules/server/startScript.ts:51-93
  ├── detectStartScript()           ← 抄 GSM3 InstanceManager.ts:202-225
  └── ensureStartScriptExecutable() ← 抄 GSM3 InstanceManager.ts:885-905
```

**剩余差距**（**改后抄**）：GSM3 在 `InstanceManager.spawn` 时**先调 install** 再调 spawn（如果 GameManager 没装）：

```typescript
// GSM3 InstanceManager.ts:818-825 模式
const startScript = await this.detectStartScript(instance.workingDirectory);
if (!startScript) {
  // ★ 缺启动脚本 → 触发实时安装
  await this.installGameServer(instance);
  // 再次探测
  const retryScript = await this.detectStartScript(instance.workingDirectory);
  if (!retryScript) throw new Error(...);
}
```

**本项目改造骨架**（**抄 GSM3 self-healing 模式**）：
```typescript
// manager-server/src/modules/server/ServerManager.ts:spawnU3DS 改造
private async spawnU3DS(id: ServerId, installDir: string): Promise<number> {
  let script = await detectStartScript(installDir);
  if (!script) {
    // ★ 抄 GSM3：触发实时安装（不动 U3DS 镜像，靠 SteamCMD 动态装）
    logger.warn({ installDir, serverId: id }, '未检测到 U3DS 启动脚本，尝试实时安装');
    await this.steamCmdManager.installU3DS(installDir);   // 抄 GSM3 installOnline 模式
    script = await detectStartScript(installDir);
    if (!script) {
      throw new AppError('start-script-not-found', `未检测到 U3DS 启动脚本（ServerHelper.sh/ExampleServer.sh）：${installDir}`, 500);
    }
  }
  await ensureStartScriptExecutable(installDir, script);
  const args = script === 'ServerHelper.sh' ? [`+InternetServer/${id}`, '-ThreadedConsole'] : [];
  return this.processSupervisor.spawn(id, `${installDir}/${script}`, args, installDir);
}
```

**配套决策**（**必须用户拍板**）：

| 决策 | GSM3 做法 | 本项目选择 |
|---|---|---|
| 镜像是否预装 U3DS | **否**（GSM3 容器启动后由面板引导装） | **否**（同 GSM3，避免 10GB 镜像） |
| 失败后是否自动重装 | **是**（self-healing） | **是**（同 GSM3） |
| 镜像装 mono-complete | **是**（Dockerfile 多行） | **必须装**（BUG-10 联动） |

**GSM3 Dockerfile mono 安装副本**（`Dockerfile:24-34` 完整抄）：
```dockerfile
# Mono 依赖（抄 GSM3：DLL 用 .NET 框架，Unity Mono 加载脚本）
libgdiplus \
libc6-dev \
libasound2 \
libpulse0 \
libnss3 \
libcap2 \
libatk1.0-0 \
libcairo2 \
libcups2 \
libgtk-3-0 \
libgdk-pixbuf-2.0-0 \
libpango-1.0-0 \
libx11-6 \
libxt6 \
```

## ⚠️⚠️⚠️ GSM3 没装 mono-complete —— 它的 Unturned 启动可能跑不通

需要 verify：GSM3 实际部署的 Unturned 服务器，靠 `.NET 4.x` 兼容层（libmono 2.0 系列）跑，不是 mono-complete。

**决策点 → 用户拍板**：
- A: 装 mono-complete（+800MB 镜像，确定能跑）
- B: 只装 Mono 运行时库（减 600MB，依赖验证）

**GSM3 文件**：`server/src/modules/instance/InstanceManager.ts:202-225, 818-825, 885-905`
**本项目触达**：`manager-server/src/modules/server/ServerManager.ts:383-398` + `SteamCmdManager.ts` 新增 `installU3DS`
**工时**：1.5 天（含 Dockerfile mono + self-healing + 前端 UI）

---

### 🟢 BUG-2：安装 U3DS 无进度展示 —— **改后抄**

**根因**（已 verify）：前端 0 订阅 `steamcmd_progress` WS 事件。

**GSM3 做法**（**SSE 不是 WS**，**架构不同**）：GSM3 一律 `text/event-stream`：
```typescript
// GSM3 routes/steamcmd.ts:34-71 模式
res.writeHead(200, { 'Content-Type': 'text/event-stream', ... });
const sendEvent = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
await steamcmdManager.installOnline({
  installPath,
  onProgress: (progress) => sendEvent('progress', { progress }),
  onStatusChange: (status) => sendEvent('status', { status }),
});
```

**本项目现状**（已 verify）：
- WS gateway `gateway.ts:67-69` 默认 `eventTypes: null` = 接收所有事件
- `WebSocketContext.tsx:7-8` 只暴露 `connected: boolean`，**不向子组件分发事件**
- `useConsole.ts:38-104` 是**独立 ws 连接**（不复用 WebSocketContext）

**本项目选择**：**沿用 WS 架构**（不动 gateway），**抄 GSM3 callback 模式**：

```typescript
// SteamCmdManager.ts 改造（抄 GSM3 installOnline 的 callback 形态）
async installU3DS(
  installDir: string,
  callbacks?: { onProgress?: (progress: number) => void; onStatusChange?: (status: string) => void },
): Promise<void> {
  // ... 运行中
  this.processSupervisor.onStdout(jobId as never, (line: string) => {
    const { stage, percent } = this.parseProgressLine(line);
    // ★ 抄 GSM3：双通道——callback 同步调用 + WS 异步广播
    callbacks?.onProgress?.(percent ?? 0);
    callbacks?.onStatusChange?.(stage);
    this.broadcaster.broadcast({
      type: 'steamcmd_progress',
      jobId,                    // ★ 新增：多任务并发隔离
      stage,
      percent,
    } as never);
  });
}
```

**前端 hook**（参考 `useConsole.ts` 独立 ws 模式）：
```typescript
// manager-web/src/hooks/useSteamCmdProgress.ts（新建）
export function useSteamCmdProgress(jobId?: string): SteamCmdProgress | null {
  // 抄 useConsole.ts:38-104 完整结构
  // 过滤 msg.type === 'steamcmd_progress' && (!jobId || msg.jobId === jobId)
}
```

**GSM3 文件**：`server/src/routes/steamcmd.ts:34-71` + `server/src/modules/steamcmd/SteamCMDManager.ts:163-220`
**本项目触达**：`manager-server/src/modules/steamcmd/SteamCmdManager.ts` + 新增 `manager-web/src/hooks/useSteamCmdProgress.ts`
**工时**：1.5 天

---

### ✅ BUG-4：docker-compose 挂载目录不自动生成 —— **已解决（bind mount）**

**根因**（已 verify）：现行 docker-compose.yml 用命名卷（Docker 自动创建），但用户期望 bind mount。

**GSM3 做法**（`docker-compose.yml:23-32` + `start.sh:18-30`）：

```yaml
# .research/GameServerManager/docker-compose.yml:23-32 (节选)
services:
  gsm3:
    volumes:
      - ./data:/root/server/data              # ★ bind mount, 宿主机可见
      - /root/server/builtin/data/lib:/root/server/data/lib  # 命名卷 vs 文件
```

```bash
# .research/GameServerManager/start.sh:18-30 (补缺逻辑)
DEFAULT_PLUGINS_DIR="data/plugins"
RUNTIME_PLUGINS_DIR="server/data/plugins"
if [ -d "$DEFAULT_PLUGINS_DIR" ]; then
  mkdir -p "$RUNTIME_PLUGINS_DIR"
  for plugin_dir in "$DEFAULT_PLUGINS_DIR"/*; do
    if [ ! -d "$plugin_dir" ] || [ ! -f "$plugin_dir/plugin.json" ]; then continue; fi
    plugin_name=$(basename "$plugin_dir")
    runtime_plugin_dir="$RUNTIME_PLUGINS_DIR/$plugin_name"
    if [ ! -e "$runtime_plugin_dir" ]; then
      cp -a "$plugin_dir" "$runtime_plugin_dir"    # ★ 容器启动时补缺
      echo "✅ 已补充内置插件: $plugin_name"
    fi
  done
fi
```

**本项目改造**（**实际落地 2026-08-10**，三个挂载目录全部 bind mount）：
```yaml
# docker-compose.yml（当前实现）
services:
  panel:
    volumes:
      - ./data:/data                     # ★ bind mount，宿主 ./data 自动生成（SQLite + 日志）
      - ./opt/unturned:/opt/unturned     # ★ bind mount，宿主 ./opt/unturned 自动生成（U3DS 根目录）
      - ./steamcmd:/opt/steamcmd         # ★ bind mount，宿主 ./steamcmd 自动生成（SteamCMD 持久化）
```

**配套 entrypoint（`docker-entrypoint.sh`，抄 GSM3 start.sh:18-30 的补缺思路）**：
bind mount 空宿主目录会**遮蔽**镜像烘焙的 `/opt/steamcmd`（spawn 报 EACCES，BUG-1 复发）。
故 Dockerfile 把烘焙好的 steamcmd 额外复制一份到 `/opt/steamcmd-bootstrap`，entrypoint 启动时
若 `/opt/steamcmd/steamcmd.sh` 缺失则 `cp -an` 补缺。U3DS 目录初始为空是**预期**（面板引导式
安装，见 `mem:decision-no-auto-install-steamcmd-u3ds`）。

**GSM3 文件**：`docker-compose.yml:23-32` + `start.sh:18-30`
**本项目触达**：`docker-compose.yml` + 新增 `docker-entrypoint.sh` + `Dockerfile`
（bootstrap 副本 + ENTRYPOINT）+ `.gitignore`（忽略 /opt//steamcmd/）+ `.dockerignore`（/data /opt /steamcmd）
**工时**：0.5 天
**决策点**：bind mount vs 命名卷（用户拍板）→ **bind mount**（宿主可见性优先，三个目录全挂）

---

### 🟡 BUG-10：Dockerfile 镜像源慢 —— **改后抄**

**根因**（已 verify）：本项目 Dockerfile 全程用 `node:20-slim` 官方源 + deb.debian.org + registry.npmjs.org。

**GSM3 做法**（`Dockerfile:84-85`）：
```dockerfile
# .research/GameServerManager/Dockerfile:84-85
RUN npm config set registry https://registry.npmmirror.com
```

**仅换了 npm registry**！**apt 没换**！**SteamCMD 走 akamai**（line 201-204）—— **GSM3 也没换 SteamCMD 源**。

**本项目抄 GSM3 + 升级**（apt 源也换）：
```dockerfile
# ★ 抄 GSM3：npm 镜像
RUN npm config set registry https://registry.npmmirror.com
RUN npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000

# ★ 升级：apt 镜像（GSM3 没换，但清华可加速）
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list

# ★ SteamCMD 保持 akamai（GSM3 同款）
RUN wget -t 5 --retry-connrefused --waitretry=1 -O steamcmd_linux.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
   || wget -t 5 --retry-connrefused --waitretry=1 -O steamcmd_linux.tar.gz https://media.steampowered.com/installer/steamcmd_linux.tar.gz
```

**GSM3 文件**：`Dockerfile:84-85, 201-204`
**本项目触达**：`Dockerfile` 全文
**工时**：0.5 天

---

### 🔴 BUG-5：模组下载按钮不消失 —— **不能抄 GSM3**

**根因**（已 verify）：前端 ModCard 无 `downloaded` prop；ModsPage 无 `useQuery(downloaded)`。

**为什么不能抄 GSM3**（**架构差异**）：

| 维度 | GSM3 | 本项目 |
|---|---|---|
| Mod 来源 | **SteamCMD 预设集合**（preset） | **Steam Workshop 浏览器**（WebAPI） |
| Mod 列表 UI | `client/src/pages/Instance.tsx` 用 preset 选择器 | `manager-web/src/pages/ModsPage.tsx` 用 WebAPI 搜索 |
| 下载方式 | `SteamCMDManager.installOnline(preset)` | `/mods/download` → SteamCMD `workshop_download_item` |
| "已下载"判定 | preset 目录存在 | `appworkshop_1110390.acf` 文件 |
| 推送 WS | 无（走 SSE） | `steamcmd_progress` 事件 |

**GSM3 没有 Mods 浏览 UI**（`grep "WorkshopDownloadConfig" .research/GameServerManager/` 无结果）—— 它走的是「服务器模板」模式：
1. 面板预存 `preset/<GameKey>/` 配置目录
2. 用户在创建实例时选 preset（如 Unturned、CSGO）
3. 实例创建时直接调 `steamcmd +app_update <appId>` 装游戏本体
4. **Mods 是 preset 内的子目录**，不单独走 Steam Workshop

**本项目必须自主实现**：
```typescript
// ModsPage.tsx 改造（参照 BUG-5 修复方案）
const { data: downloaded, refetch: refetchDownloaded } = useQuery({
  queryKey: ['mods', 'downloaded', serverId],
  queryFn: () => apiClient.get(`/servers/${serverId}/mods/downloaded`).then(r => r.data.data),
  refetchOnMount: 'always',
});
const downloadedSet = useMemo(() => new Set((downloaded ?? []).map(d => d.fileId)), [downloaded]);

const handleDownload = async (fileId: string) => {
  // ... 现有
  await refetchDownloaded();   // ★ 刷新
};

// ModCard.tsx 增加 prop
interface ModCardProps {
  // ... existing
  downloaded?: boolean;
}
```

**GSM3 文件**：无对应模块（GSM3 走 preset 模型）
**本项目触达**：`manager-web/src/pages/ModsPage.tsx` + `manager-web/src/components/mods/ModCard.tsx`
**工时**：1 天

---

### 🔴 BUG-6：Workshop Tab 看不到已下载 mod —— **不能抄 GSM3**

**根因**（已 verify）：ACF 文件未生成 + 前端强行标 `status: 'enabled' as const`。

**为什么不能抄 GSM3**（同 BUG-5）：
- GSM3 不扫 `appworkshop_1110390.acf`
- GSM3 不区分「已下载 / 已应用」三态
- GSM3 的 preset 模型在面板内是「配置集合」，不是 Steam Workshop 元数据

**本项目必须自主实现**：
```typescript
// shared/contracts/workshop.ts
interface DownloadedMod {
  fileId: string;
  title?: string;
  // ... existing
  applied: boolean;          // ★ 新增
  downloadTime?: number;
  size?: number;
}

// routes/mods.ts 改
const fileIdsInConfig = await configService.readWorkshopFileIds(serverId);
const merged = items.map((item) => ({
  ...item,
  applied: fileIdsInConfig.includes(item.fileId),
}));

// ConfigPage.tsx 3 态渲染
const status = item.applied ? 'enabled' : 'pending_apply';
```

**GSM3 文件**：无对应模块
**本项目触达**：`shared/contracts/workshop.ts` + `manager-server/src/routes/mods.ts` + `manager-server/src/modules/config/ConfigService.ts` (新方法) + `manager-web/src/pages/ConfigPage.tsx`
**工时**：1 天

---

## 3. GSM3 1:1 抄不动的部分（不能抄）

| 部分 | 原因 |
|---|---|
| GSM3 PTY 抽象（`TerminalManager.ts`） | 本项目用 `processSupervisor` 走 stdio/简单 pipe，**架构不同** |
| GSM3 environment 模块（java/directx/packageManager） | 本项目 Unturned 单一后端，不需 Java 切换 |
| GSM3 Socket.IO | CLAUDE.md `prohibitions.md` 硬禁止 |
| GSM3 `npm run package:linux:x64:no-zip` 整包打包 | 本项目用 npm workspaces，**架构不同** |
| GSM3 Python 3.11 + pip 依赖 | 本项目纯 Node.js |
| GSM3 多架构 ARM64 路径 | 暂只支持 x86_64 |
| GSM3 `socket.io` 实时通信 | CLAUDE.md 硬禁令 |
| GSM3 Steam Workshop 浏览器 | **GSM3 没有这个模块**（走 preset 模型） |

---

## 4. 必须用户拍板的 4 项决策

| # | 决策 | 推荐 | 影响 |
|---|---|---|---|
| 1 | BUG-3 修复方案 | **B 面板引导式**（同 GSM3 self-healing） | 镜像大小、SteamCMD 凭证 |
| 2 | BUG-10 镜像源选择 | **清华源**（GSM3 仅换 npm，我们再加 apt） | nm 国内镜像 |
| 3 | mono 安装策略 | **A 装 mono-complete**（保守 800MB 镜像） | 镜像大小 |
| 4 | BUG-4 bind mount vs 命名卷 | **bind mount**（宿主可见；SteamCMD 不挂卷防遮蔽） | 宿主机可见性 |

---

## 5. 修订后的 Sprint 工时（按 GSM3 抄路线）

| Sprint | BUG | 抄 GSM3 | 工时 |
|---|---|---|---|
| A | 9 | 1:1 抄 | 0.5d |
| A | 1 + 1 附 | 1:1 抄 SSE 模式 | 1.5d |
| B | 10 | 改后抄（+apt 源） | 0.5d |
| B | 3/7 | 改后抄（self-healing + Dockerfile mono） | 1.5d |
| B | 2 | 改后抄（callback 模式） | 1.5d |
| B | 5 | **自主实现** | 1d |
| C | 6 | **自主实现** | 1d |
| C | 4 | 改后抄（bind mount + start.sh） | 0.5d |
| **合计** | | | **8d** |

---

## 6. Sprint 后吸收

本文档按 `document-organization.md` 生命周期：Sprint 完成后，**核心结论（能抄/不能抄）应吸收进** `claudedocs/reference_gsm3_unturned_patterns.md` 作为活参考文档。

---

## 7. 参考资料

| 文档 | 关联 |
|---|---|
| `.research/GameServerManager/server/src/modules/steamcmd/SteamCMDManager.ts` | BUG-1, 2, 9 主参考 |
| `.research/GameServerManager/server/src/modules/instance/InstanceManager.ts:202-225, 818-825, 885-905` | BUG-3/7 |
| `.research/GameServerManager/server/src/routes/steamcmd.ts:34-130` | BUG-1, 2 |
| `.research/GameServerManager/server/src/routes/gameDeployment.ts` | BUG-1 (通用化 app_update) |
| `.research/GameServerManager/Dockerfile:84-85, 201-204` | BUG-10 |
| `.research/GameServerManager/start.sh:18-30` | BUG-4 |
| `.research/GameServerManager/docker-compose.yml` | BUG-4 |
| `.claude/rules/prohibitions.md` | GSM3 Socket.IO 抄不了的硬禁令 |
| `docs/architecture/architecture-spec.md` | 本项目 WS 架构决策（B-2 决策依据） |

---

**Owner**：开发组
**Reviewer**：架构组
**完成日期**：Sprint B 预计 2026-08-15
