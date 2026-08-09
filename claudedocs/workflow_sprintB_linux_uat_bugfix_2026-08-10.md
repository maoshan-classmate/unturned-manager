# Sprint B — Linux UAT 10 项 BUG 修复工作流

> **文档类型**：Sprint 工作流（一次性命命，Sprint 完成即删除）
> **产生日期**：2026-08-10
> **触发来源**：`Linux实机测试BUG汇总.txt`（Linux 物理机实测）
> **作者**：Claude Code（/sc:troubleshoot 触发）
> **范围**：服务器设置页 / 仪表盘 / 模组管理 / 配置页面 / Docker 部署

---

## 0. TL;DR（必须先看）

| 维度 | 数量 |
|---|---|
| 总 BUG 数 | 10 |
| 🔴 P0（阻塞主流程） | 3（BUG-1 / BUG-3,7 / BUG-8） |
| 🟠 P1（功能不闭环） | 3（BUG-2 / BUG-5 / BUG-6） |
| 🟡 P2（增强体验） | 4（BUG-1 附 / BUG-4 / BUG-9 / BUG-10） |
| 计划工期 | Sprint A 1.5d + Sprint B 4.5d + Sprint C 5.5d ≈ 11.5 人日 |
| 必须用户拍板 | 4 项（见 §6） |

**前置必要条件**：BUG-3/7 必须**先于**其他 BUG 修复——它是"启动链路"的根，不通则 BUG-5/6 没法验证。

---

## 1. BUG 一览（含代码级根因 + 修复定位）

### 🔴 BUG-3/7：启动按钮 500 找不到 U3DS（架构级根因）

**报错原文**：`未检测到 U3DS 启动脚本（ServerHelper.sh/ExampleServer.sh）：/opt/unturned`

**调用栈**（验证证据）：
```
[用户] 点 Dashboard/ServerSetup 启动按钮
  ↓
[前端] DashboardPage → ServerControlCard.handleStart
  ↓ POST /api/servers/:id/start
[后端] routes/servers.ts:38-44  createServersRouter().post('/:id/start')
  ↓ serverManager.start(serverId)
[核心] ServerManager.spawnU3DS(id, installDir)         ServerManager.ts:383-398
  ↓ detectStartScript(installDir)                     startScript.ts:51-64
  ↓ fs.readdir('/opt/unturned') → ENOENT / 空目录
  ↓ throw AppError('start-script-not-found', ..., 500)
```

**根因**（3 层叠加）：

1. **Dockerfile:110** `RUN mkdir -p /opt/unturned` **只创建空目录**，从未装 U3DS 二进制
2. **SteamCmdManager.ts:65-71** `install()` 是 stub，注释自欺欺人："SteamCMD 安装通常由 docker 镜像自带"——但镜像根本没装
3. **U3dsCard.tsx:34** `apiClient.post('/steamcmd/update', ...)` 调的是**更新**不是**安装**——前端缺少"安装 U3DS"入口

**Dockerfile 镜像内**：
- `node:20-slim` **不包含** mono-complete（§ unturned-sop.md 铁律）
- **没有任何** `steamcmd +app_update 1110390` 步骤

**修复方案**（选 B 面板引导式，和 BUG-2 联动）：

```typescript
// 新建 manager-server/src/routes/steamcmd.ts (追加)
router.post(
  '/install-u3ds',
  validate(UpdateSchema),
  asyncHandler(async (req, res) => {
    const { installDir } = req.body as { installDir: string };
    try {
      await steamCmdManager.installU3DS(installDir);   // 新方法
      res.status(202).json({ data: { message: 'U3DS 安装已启动，进度由 WS steamcmd_progress 推送' } });
    } catch (err) {
      if (err instanceof Error && err.message.includes('运行')) {
        throw new AppError('operation_conflict', err.message, 409);
      }
      throw err;
    }
  }),
);
```

```typescript
// SteamCmdManager.ts 新增方法 installU3DS
async installU3DS(installDir: string): Promise<void> {
  // 1. 前置检查：所有实例 STOPPED（同 updateU3DS）
  const activeIds = this.activeProbe();
  if (activeIds.length > 0) {
    throw new AppError('servers-active', `以下服务端仍在运行：${activeIds.join(', ')}`, 409);
  }
  if (this.activeJobs.has(installDir)) {
    throw new AppError('steamcmd-busy', '该 installDir 已有 SteamCMD 任务在跑', 409);
  }

  const exePath = this.steamCmdPath ?? this.findSteamCmd();
  if (!exePath || !fs.existsSync(exePath)) {
    throw new AppError('steamcmd-not-found', 'SteamCMD 未安装', 500);
  }

  this.activeJobs.add(installDir);
  try {
    // 2. runscript（与 updateU3DS 同模板，仅去 validate）
    const scriptContent = [
      '@ShutdownOnFailedCommand 1',
      '@NoPromptForPassword 1',
      `force_install_dir "${installDir}"`,
      'login anonymous',
      // ★ 关键：install 走 +app_update，不加 validate（首次没东西可校验）
      `app_update ${U3DS_APPID}`,
      'quit',
    ].join('\n');
    const scriptPath = path.join(installDir, '.steamcmd-install.scf');
    await fs.promises.mkdir(installDir, { recursive: true });
    await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

    const jobId = `steamcmd-install-${installDir}`;
    this.broadcastProgress('installing', 0, 'spawned');

    // 3. spawn + 解析 stdout（与 updateU3DS 完全一致）
    const pid = await this.processSupervisor.spawn(jobId as never, exePath, ['+runscript', scriptPath], path.dirname(exePath));
    this.loggerUpdate().info({ installDir, pid }, 'SteamCMD install 进程已 spawn');

    this.processSupervisor.onStdout(jobId as never, (line: string) => {
      const { stage, percent } = this.parseProgressLine(line);
      this.broadcaster.broadcast({ type: 'steamcmd_progress', stage, percent } as never);
    });

    try {
      await this.processSupervisor.waitForExit(jobId as never, UPDATE_TIMEOUT_MS);
    } finally {
      try { await fs.promises.unlink(scriptPath); } catch { /* noop */ }
    }

    // 4. 安装后置检查：ServerHelper.sh / ExampleServer.sh 必出现
    const script = await detectStartScript(installDir);
    if (!script) {
      throw new AppError('install-script-missing', `U3DS 安装完成但未检测到启动脚本（${installDir}）`, 500);
    }

    this.broadcastProgress('completed', 100, 'completed');
    this.loggerUpdate().info({ installDir, script }, 'SteamCMD install 完成');
  } catch (err) {
    this.broadcastProgress('failed', 0, 'failed');
    throw err;
  } finally {
    this.activeJobs.delete(installDir);
  }
}
```

**前端联动**（U3dsCard.tsx 改造）：
- `「安装 U3DS」` 按钮 → 调 `POST /steamcmd/install-u3ds`，**首次弹 2 步确认**（首次安装会下 10GB）
- 进度通过 **BUG-2 修复的 `useSteamCmdProgress`** hook 订阅

**Docker 镜像联动**（必须）：
- Dockerfile Stage 1 增 `mono-complete`（unturned-sop.md 铁律依赖）
- **不**在 build 阶段自动装 U3DS（保留「用户首次启动按按钮装」的体验）

---

### 🔴 BUG-1：SteamCMD 检查更新 404

**调用方**：`SteamCmdCard.tsx:49` → `POST /steamcmd/check-update`

**实际后端路由**（`routes/steamcmd.ts:18-58`）：只有 `/status`、`POST /update`、`POST /download-workshop`——**无 `/check-update`**

**根因**：前后端契约脱节，前端先于后端实现。

**修复方案**（后端补端点）：

```typescript
// routes/steamcmd.ts 追加
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

const CheckUpdateSchema = z.object({
  installDir: z.string().min(1, '安装路径不能为空').optional(),
});

router.post(
  '/check-update',
  validate(CheckUpdateSchema),
  asyncHandler(async (req, res) => {
    const exePath = steamCmdManager.getSteamCmdPath();   // 新增 public getter
    if (!exePath) throw new AppError('steamcmd-not-found', 'SteamCMD 未安装', 404);

    // 调 steamcmd +app_info_print 1110390 解析当前 buildid
    const { stdout } = await execFileAsync(exePath, ['+login', 'anonymous', '+app_info_print', '1110390', '+quit'], {
      timeout: 30_000,
    });
    const versionMatch = stdout.match(/buildid[\s"]+(\d+)/);
    const currentBuildId = versionMatch ? versionMatch[1] : null;

    // 调 Steam WebAPI 拿最新 buildid（IPublishedFileService 不返回 Steam app 版本）
    // 实际：SteamCMD 自带 +app_update 后内置版本比较，直接用 SteamCMD 返回的版本字符串
    const latestVersion = stdout.match(/name[\s"]+([^"\n]+)/)?.[1]?.trim() ?? 'unknown';

    res.json({ data: { currentBuildId, latestVersion, lastChecked: new Date().toISOString() } });
  }),
);
```

**附加**：BUG-1 附 — `SteamCmdCard.tsx:35` `POST /steamcmd/reinstall` 同样 404（SteamCmdManager.install() 是 stub）。**优先级低**，可在同一 PR 顺手补 `/reinstall` 端点且实际实现 `install()`（判断是首次还是重装，分别调 install 或 reinstall runscript）。

---

### 🔴 BUG-8：计划任务添加 404（新模块）

**调用方**：`ScheduledTaskDialog.tsx:78` `POST /servers/${serverId}/scheduled-tasks`

**实际后端**：`index.ts:86-105` 共 8 个路由挂载，**`/scheduled-tasks` 端点不存在**

**根因**：Sprint 4 前端先实装 UI，后端没跟上。

**修复方案**（工作量最大，需新模块）：

```
新建 manager-server/src/modules/scheduled-tasks/
├── ScheduledTasksService.ts        # CRUD + 内存调度器
├── ScheduledTasksService.test.ts   # ≥80% 覆盖
└── cron.ts                          # 5 字段 cron 表达式校验（不依赖 node-cron）

新建 manager-server/src/routes/scheduled-tasks.ts
挂载: app.use('/api/servers', createScheduledTasksRouter(...))

数据库: db/migrations/004-scheduled-tasks.sql
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,           -- uuid
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    minute TEXT NOT NULL,
    hour TEXT NOT NULL,
    day TEXT NOT NULL,
    month TEXT NOT NULL,
    weekday TEXT NOT NULL,
    shell_command TEXT NOT NULL,   -- 注意 snake_case 列名
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
```

**接口契约**（对齐 `shared/schemas/serverSetup.ts` 的 `scheduledTaskSchema`）：
```typescript
interface IScheduledTasksService {
  list(serverId: ServerId): Promise<ScheduledTask[]>;
  get(serverId: ServerId, id: string): Promise<ScheduledTask>;
  create(serverId: ServerId, input: ScheduledTaskInput): Promise<ScheduledTask>;
  update(serverId: ServerId, id: string, patch: Partial<ScheduledTaskInput>): Promise<ScheduledTask>;
  delete(serverId: ServerId, id: string): Promise<void>;
  setEnabled(serverId: ServerId, id: string, enabled: boolean): Promise<ScheduledTask>;
}

interface ScheduledTask {
  id: string;
  serverId: ServerId;
  name: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
  shellCommand: string;
  enabled: boolean;
}
```

**调度器设计**（**不**依赖 node-cron）：
- 1Hz 内存计时器 + `nextRunTime(task)` 算下一次触发
- 触发后调 `RconManager.execute(serverId, task.shellCommand)`（沙箱执行 RCON 命令）
- RCON 不可达 → 跳过本次，记 warn 日志
- UI 状态由 `listActiveServerIds()` 推算（跟随 ServerManager 状态）

**风险**：cron 调度器在 Docker 容器内——**容器重启后丢失内存态**。必须**重启时从 DB 重建**。`ServerManager` 启动后 `ScheduledTasksService.bootstrap()` 读 DB 全部 enabled 任务。

**建议优先级**：**降级到 Sprint C 末**或 Sprint 5 后再启动（涉及数据库迁移 +1 + 调度器守护）。

---

### 🟠 BUG-2：安装 U3DS 无进度展示

**调用方**：`U3dsCard.tsx:34`（update）/ 后续 installU3DS

**事件流**（已验证）：
- 后端 `SteamCmdManager.ts:117` `broadcastProgress('spawned', 0, 'spawned')`
- `SteamCmdManager.ts:132-137` 每次 stdout 解析后 `broadcast({type:'steamcmd_progress', stage, percent})`
- `SteamCmdManager.ts:198-205` 同款 download 路径
- `SteamCmdManager.ts:246-254` 终态广播

**前端订阅情况**（`grep steamcmd_progress` manager-web）：
- **0 命中**。前端 0 订阅。

**WS 通道现状**（已验证）：
- `WebSocketContext.tsx:7-8` 只暴露 `connected: boolean`，**不向子组件分发事件**
- `useConsole.ts:38-104` 是**独立 ws 连接**（不复用 WebSocketContext），内含 ws.onmessage 过滤 `console_line`
- WS gateway `gateway.ts:67-69` 默认 `eventTypes: null` = 接收所有类型

**根因**：上游广播通道已建好，前端订阅缺失。

**修复方案**（**新增独立 hook**，不动 WebSocketContext）：

```typescript
// 新建 manager-web/src/hooks/useSteamCmdProgress.ts
import { useState, useEffect, useRef } from 'react';
import { ensureAccessToken } from '../api/client.js';

interface SteamCmdProgress {
  stage: string;          // 'downloading' | 'validating' | 'installed' | 'preallocating' | 'checking' | 'updating' | 'update complete' | 'deprecated' | 'spawned' | 'completed' | 'failed'
  percent?: number;        // 0-100
  timestamp: string;
  jobId?: string;          // 'steamcmd-install-/opt/unturned' | 'steamcmd-update-/opt/unturned' | 'steamcmd-download-/opt/unturned'
}

/**
 * 订阅 SteamCMD 安装/更新/下载进度，复用 useConsole 同款建连模式（独立 ws + 退避重连）。
 * 多任务并发时按 jobId 区分；未传 jobId 监听全部。
 */
export function useSteamCmdProgress(jobId?: string): SteamCmdProgress | null {
  const [progress, setProgress] = useState<SteamCmdProgress | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryDelay = useRef(1000);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function connect() {
      const token = await ensureAccessToken();
      if (!token || cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay.current = 1000;
        // 订阅所有事件类型（不加过滤）
        ws.send(JSON.stringify({ type: 'subscribe', serverIds: [], eventTypes: null }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== 'steamcmd_progress') return;
          // jobId 过滤（可选）
          if (jobId && msg.jobId !== jobId) return;
          setProgress({
            stage: msg.stage,
            percent: msg.percent,
            timestamp: new Date().toISOString(),
            jobId: msg.jobId,
          });
        } catch {/* noop */}
      };

      ws.onclose = () => {
        if (cancelled) return;
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [jobId]);

  return progress;
}
```

**U3dsCard 改造**：
```typescript
const progress = useSteamCmdProgress(installDir ? `steamcmd-install-${installDir}` : undefined);

useEffect(() => {
  if (!progress) return;
  if (progress.stage === 'completed') {
    toast.success(`U3DS 安装完成（${progress.percent ?? 100}%）`);
  } else if (progress.stage === 'failed') {
    toast.error('U3DS 安装失败');
  } else {
    toast.loading(`U3DS 安装中… ${progress.stage}${progress.percent != null ? ` ${progress.percent}%` : ''}`, { id: 'u3ds-install' });
  }
}, [progress]);
```

**后端配套**：broadcast 必带 `jobId` 字段（当前 `SteamCmdManager.ts:130-137` 没带，需补）：
```typescript
this.broadcaster.broadcast({
  type: 'steamcmd_progress',
  jobId,                    // ★ 新增
  stage: broadcast.stage,
  percent: broadcast.percent,
} as never);
```

---

### 🟠 BUG-5：模组下载成功但按钮不消失

**调用方**：`ModsPage.tsx:179-207 handleDownload` 调 `POST /servers/:id/mods/download` → 200 toast

**ModCard.tsx:42-45** 当前 props：
```typescript
{ fileId, title, description, previewUrl, subscriptions, voteScore, loading, onDownload, onDetails }
```
**无 `downloaded?: boolean` 字段**

**根因**：
1. **browse 流**（`/mods/search`）与 **downloaded 流**（`/servers/:id/mods/downloaded`）**完全分离**
2. 下载成功后无任何 query 刷新
3. ModCard 不接受已下载状态

**修复方案**：

```typescript
// ModsPage.tsx 改造
const { data: downloaded, refetch: refetchDownloaded } = useQuery({
  queryKey: ['mods', 'downloaded', serverId],
  queryFn: async () => {
    const res = await apiClient.get<{ data: DownloadedMod[] }>(`/servers/${serverId}/mods/downloaded`);
    return res.data.data;
  },
  refetchOnMount: 'always',
  enabled: !!serverId,
});

const downloadedSet = useMemo(() => new Set((downloaded ?? []).map((d) => d.fileId)), [downloaded]);

const handleDownload = async (fileId: string) => {
  setDownloading((prev) => ({ ...prev, [fileId]: true }));
  try {
    if (!serverId) { toast.error('没有可用的服务器实例'); return; }
    const res = await apiClient.post<{ data: { success: boolean; modTitle?: string } }>(
      `/servers/${serverId}/mods/download`,
      { fileId },
    );
    if (res.data.data.success) {
      toast.success(`${res.data.data.modTitle ?? 'Mod'} 下载成功`);
      setDetailFileId(null);
      await refetchDownloaded();   // ★ 关键：刷新 downloaded 列表
    }
  } catch (err) {
    toast.error(getApiError(err, '下载失败'));
  } finally {
    setDownloading((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
  }
};

// 渲染处：
{(browse?.rows ?? []).map((mod) => (
  <ModCard
    key={mod.fileId}
    fileId={mod.fileId}
    title={mod.title}
    description={mod.description}
    previewUrl={mod.previewUrl}
    subscriptions={mod.subscriptions}
    voteScore={mod.voteScore}
    loading={!!downloading[mod.fileId]}
    downloaded={downloadedSet.has(mod.fileId)}   // ★ 新增 prop
    onDownload={handleDownload}
    onDetails={(id) => setDetailFileId(id)}
  />
))}
```

```typescript
// ModCard.tsx 改造
interface ModCardProps {
  // ... existing
  /** 是否已下载（来自 /mods/downloaded） */
  downloaded?: boolean;
}

// Button 渲染：
<Button
  size="sm"
  variant={downloaded ? 'outline' : 'default'}
  onClick={() => !downloaded && onDownload?.(fileId)}
  disabled={loading || downloaded}
  className="h-7 text-[11px] gap-1 px-3"
>
  {downloaded ? <Check size={12} /> : <Plus size={12} />}
  {downloaded ? '已下载' : '下载'}
</Button>
```

**ModDetailDialog.tsx 同样改造**（弹窗里也调 onDownload）。

---

### 🟠 BUG-6：Workshop Tab 无法查看已下载 mod

**调用方**：`ConfigPage.tsx:127` `GET /servers/:id/mods/downloaded`

**后端实现**（`routes/mods.ts:54-75`）：调 `acfService.listItems(serverId)` 扫描 `appworkshop_1110390.acf`

**根因**（3 层叠加）：

1. ACF 文件**仅**在 SteamCMD 完成 `workshop_download_item` 后由 SteamCMD 自动生成
2. 因为 BUG-5 修复前用户从未成功下载过任何 Mod → 文件不存在 → `listItems` 返回 `[]`
3. 前端 `ConfigPage.tsx:131` 强行把 status 标 `enabled as const` —— **状态字段语义错**

**修复方案**（分两步）：

**Step 1: 修真源状态**
```typescript
// shared/contracts/workshop.ts 加字段
interface DownloadedMod {
  fileId: string;
  title?: string;
  authorName?: string;
  // ... existing
  applied: boolean;          // ★ 是否在 File_IDs 中
  downloadTime?: number;      // ACF timeupdated
  size?: number;              // ACF size
}

// routes/mods.ts 改
const fileIdsInConfig = await configService.readWorkshopFileIds(serverId);   // 新方法
const merged = items.map((item) => ({
  fileId: item.fileId,
  timeupdated: item.timeupdated,
  size: item.size,
  manifest: item.manifest,
  title: metaMap.get(item.fileId)?.title,
  author: metaMap.get(item.fileId)?.author,
  authorName: metaMap.get(item.fileId)?.authorName,
  previewUrl: metaMap.get(item.fileId)?.previewUrl,
  applied: fileIdsInConfig.includes(item.fileId),    // ★
}));
```

**Step 2: 前端 3 态渲染**
```typescript
// ConfigPage.tsx
interface WorkshopRow {
  fileId: string;
  name: string;
  status: 'enabled' | 'disabled' | 'pending_apply';   // ★ 改 disable 类型 + 加 pending_apply
  applied: boolean;
}
const setWorkshopRows = items.map((item) => ({
  fileId: item.fileId,
  name: item.title || item.fileId,
  status: item.applied ? 'enabled' : 'pending_apply',   // ★ 用 applied 字段
  applied: item.applied,
  selected: false,
}));

// 状态徽章改 3 态
function StatusBadge({ status }: { status: WorkshopRow['status'] }) {
  const map = {
    enabled: 'bg-emerald-500',
    disabled: 'bg-slate-500',
    pending_apply: 'bg-amber-500',        // 待应用
  };
  const text = {
    enabled: '已启用',
    disabled: '未启用',
    pending_apply: '待应用',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded text-[10px] font-medium text-white ${map[status]}`}>{text[status]}</span>;
}
```

**配套**：
- `configService` 补 `readWorkshopFileIds(serverId): Promise<string[]>`
- `WorkshopTab` 行操作「禁用」按钮在 `pending_apply` 态下要 disable（不能直接禁用未应用 Mod）

---

### 🟡 BUG-9：SteamCMD 已安装但版本不展示

**前端类型**（`SteamCmdCard.tsx:13-15`）：`interface SteamCmdStatus { isInstalled; installPath?; version?; ... }` —— `version` 是可选

**后端**（`SteamCmdManager.ts:54-63 getStatus()`）：
```typescript
return {
  isInstalled,
  installPath: exePath ?? undefined,
  lastChecked: new Date().toISOString(),
  // ← version 字段从未填充！
};
```

**根因**：契约写 `version` 但实现没填。

**修复方案**（修改最小）：

```typescript
// SteamCmdManager.ts 改造 getStatus
async getStatus(): Promise<SteamCmdStatus> {
  const exePath = this.steamCmdPath ?? this.findSteamCmd();
  const isInstalled = exePath !== null && fs.existsSync(exePath);

  // 拼装版本：spawn `steamcmd +version` 解析
  let version: string | undefined;
  if (isInstalled) {
    try {
      const { stdout } = await execFileAsync(exePath, ['+version', '+quit'], { timeout: 10_000 });
      // SteamCMD v2 输出形如："Steam Console Client (Linux) Version 1719583862 ..."
      const match = stdout.match(/Version\s+(\d+)\s*-\s*([^\n]+)/) || stdout.match(/Version\s+(\d+)/);
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
    version,
    lastChecked: new Date().toISOString(),
  };
}
```

**前端无需改动**（`status.version` 已渲染显示）。

---

### 🟡 BUG-4：docker-compose 挂载目录不自动生成

**现状**（`docker-compose.yml:46-52`）：
```yaml
volumes:
  - panel-data:/data
  - unturned-data:/opt/unturned
  - steamcmd-data:/opt/steamcmd

volumes:
  panel-data:
  unturned-data:
  steamcmd-data:
```

**分析**：用的是**命名卷**（named volume），Docker compose up 自动创建。**但**用户可能期望的是**宿主机可见的 bind mount**（`./data/`）。

**修复方案**：改 bind mount + README 文档指引

```yaml
# docker-compose.yml 改造
services:
  panel:
    volumes:
      - ./data/panel:/data
      - ./data/unturned:/opt/unturned
      - ./data/steamcmd:/opt/steamcmd
# 移除底部 volumes: 段
```

**对应 README 增加**：
```bash
# 首次启动前必须建目录（否则 root 自动创建，权限是 root）
mkdir -p data/panel data/unturned data/steamcmd
chown -R 1000:1000 data/  # 镜像内 node 用户 uid=1000
```

**或者**：留在命名卷（用户原状），但 README 写清楚 `docker volume inspect unturned-manager_panel-data` 查看位置。

**取舍建议**：**保留命名卷**（避免权限坑），但 README 写明查看命令。

---

### 🟡 BUG-10：Dockerfile 镜像源慢

**现状**（Dockerfile 全文已读）：
- `FROM node:20-slim` / `FROM node:20` ← 官方源
- `apt-get update` ← deb.debian.org
- `npm ci` ← registry.npmjs.org
- `wget https://steamcdn-a.akamaihd.net/...` ← SteamCMD 走 akamai（**不能换**）

**根因**：无国内镜像源。

**修复方案**（三层镜像源替换，不动 SteamCMD）：

```dockerfile
# ━━━ Stage 1: base ━━━
FROM node:20-slim AS base

ENV DEBIAN_FRONTEND=noninteractive

# ★ 国内 apt 镜像（清华源，按 Debian 12 bookworm；旧版 bullseye 改 mirrors.tuna.tsinghua.edu.cn）
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list

# ★ apt 超时
RUN echo 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";' > /etc/apt/apt.conf.d/99timeout

RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
    lib32gcc-s1 libc6-i386 lib32stdc++6 \
    libncurses6:i386 libbz2-1.0:i386 libstdc++6:i386 libssl3:i386 \
    libsdl2-2.0-0 libsdl2-2.0-0:i386 \
    libpulse0 libpulse0:i386 \
    libfontconfig1 libfontconfig1:i386 \
    libudev1 libudev1:i386 \
    libvulkan1 libvulkan1:i386 \
    libgdiplus \
    libx11-6 libxt6 libgtk-3-0 libxrandr2 libxcursor1 libxi6 libxtst6 \
    # ★ 新增 mono-complete（BUG-3/7 联动必需）
    mono-complete \
    procps net-tools \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# SteamCMD 安装（保持原状，akamai 必需）
RUN mkdir -p /opt/steamcmd \
  && cd /opt/steamcmd \
  && wget -q https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
  && tar -xzf steamcmd_linux.tar.gz \
  && rm steamcmd_linux.tar.gz \
  && ./steamcmd.sh +quit \
  && mkdir -p ~/.steam/sdk32 ~/.steam/sdk64 \
  && ln -sf /opt/steamcmd/linux32/steamclient.so ~/.steam/sdk32/steamclient.so \
  && ln -sf /opt/steamcmd/linux64/steamclient.so ~/.steam/sdk64/steamclient.so

# ━━━ Stage 2: builder ━━━
FROM node:20 AS builder

# ★ npmmirror 镜像
RUN npm config set registry https://registry.npmmirror.com

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY manager-server/package.json manager-server/
COPY manager-web/package.json manager-web/

# ★ --prefer-offline 加速
RUN npm ci --prefer-offline --no-audit --omit=optional

COPY shared/ shared/
COPY manager-server/ manager-server/
COPY manager-web/ manager-web/

RUN npm run build -w manager-web

# ━━━ Stage 3: runtime ━━━
FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# ★ 同样换 apt 源
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    SERVER_PORT=3001 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    DB_PATH=/data/unturned-manager.db \
    DATA_DIR=/data \
    INSTALL_DIR=/opt/unturned \
    STEAMCMD_DIR=/opt/steamcmd \
    CORS_ORIGIN=*

WORKDIR /app

COPY --from=base /usr/lib/i386-linux-gnu /usr/lib/i386-linux-gnu
COPY --from=base /usr/lib/x86_64-linux-gnu/libgdiplus* /usr/lib/x86_64-linux-gnu/
COPY --from=base /opt/steamcmd /opt/steamcmd
COPY --from=base /root/.steam /root/.steam
# ★ 复制 mono（BUG-3/7 联动）
COPY --from=base /usr/bin/mono /usr/bin/mono
COPY --from=base /usr/lib/mono /usr/lib/mono

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/manager-server/package.json ./manager-server/package.json
COPY --from=builder /app/manager-server/src ./manager-server/src
COPY --from=builder /app/manager-web/dist ./public

RUN mkdir -p /data /opt/unturned

EXPOSE 3001
EXPOSE 27015/udp 27016/udp 25545

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://localhost:3001/api/health || exit 1

CMD ["node", "--import", "tsx", "manager-server/src/index.ts"]
```

---

## 2. BUG 联动矩阵（重要！）

```
                BUG-1  BUG-2  BUG-3,7  BUG-4  BUG-5  BUG-6  BUG-8  BUG-9  BUG-10
BUG-1            ─
BUG-2            X     ─      前置
BUG-3,7                 ─
BUG-4                          ─                ─
BUG-5                                  ─        前置
BUG-6                                  前置     ─
BUG-8            ─     ─      ─       ─       ─      ─      ─
BUG-9            ─     ─      ─       ─       ─      ─      ─      ─
BUG-10           ─     ─      前置    ─       ─      ─      ─      ─      ─
```

**关键路径**：
- **BUG-3/7 必须先**——不修就没法启动 → BUG-5/6 无法验证
- **BUG-3/7 + BUG-10 联动**：Docker 镜像必须装 mono-complete + 换 apt 源
- **BUG-3/7 + BUG-2 联动**：装 U3DS 必须有进度展示
- **BUG-5 → BUG-6 联动**：下载修好才能看到已下载列表

---

## 3. Sprint 计划（owner 视角）

### Sprint A — 止血 1.5 天

| 任务 | 工时 | 验收 | 风险 |
|---|---|---|---|
| A1. BUG-9 修 `SteamCmdManager.getStatus()` 加 version | 0.5d | `GET /steamcmd/status` 返回 version 字段 | 低 |
| A2. BUG-1 补 `/steamcmd/check-update` + `/reinstall` 路由 | 1d | 前端两个按钮 200 | 中（需新增 execFile 调用） |

**合并 PR**：`fix/steamcmd-version-and-check-update` → main

### Sprint B — 核心闭环 4.5 天

| 任务 | 工时 | 验收 | 依赖 |
|---|---|---|---|
| B1. 镜像换源 + 装 mono（BUG-10 + BUG-3 联动） | 1d | `docker build` 在国内网络 < 5min | — |
| B2. 后端 `installU3DS` 端点 + SteamCmdManager 新方法（BUG-3 一个解） | 1d | `POST /steamcmd/install-u3ds` 200 + WS 进度 | B1 |
| B3. 前端 `useSteamCmdProgress` hook + U3dsCard 装按钮（BUG-2 修） | 1d | 装 U3DS 进度条实时显示 | B2 |
| B4. ModsPage `useQuery(downloaded)` + ModCard `downloaded` prop（BUG-5） | 1d | 刷新后已下载 mod 按钮变「已下载」 | B2 |
| B5. ConfigPage Workshop Tab 3 态 + ConfigService `readWorkshopFileIds`（BUG-6） | 0.5d | pending_apply 状态正确展示 | B4 |

**合并 PR**：`sprintB-linux-uat-bugfix-1` → main

### Sprint C — 增量增强 5.5 天

| 任务 | 工时 | 验收 | 依赖 |
|---|---|---|---|
| C1. BUG-8 计划任务模块（5 文件 + 1 迁移） | 5d | 添加/删除/启停全部 200，调度器触发 RCON | — |
| C2. BUG-4 docker-compose bind mount 文档化 | 0.5d | README 写明查看命令 | — |

**合并 PR**：`sprintB-linux-uat-bugfix-2` → main

### 总工期

| Sprint | 工时 | 累计 |
|---|---|---|
| A | 1.5d | 1.5d |
| B | 4.5d | 6d |
| C | 5.5d | 11.5d |

---

## 4. PR 模板（每个 PR 必带 5 件套）

```markdown
## 变更说明
- BUG-xxx — 简述

## 根因
- (粘贴 §1 的"根因"小节)

## 改动清单
- [ ] 后端
- [ ] 前端
- [ ] 共享（schema/contracts）
- [ ] DB 迁移（如果涉及）
- [ ] 文档

## 验证
- [ ] `tsc --noEmit` 零错误
- [ ] Lint 零警告
- [ ] `vitest` / `jest` ≥80% 覆盖
- [ ] Playwright e2e 用例
- [ ] 手动 Linux UAT 跑通

## 关联
- Closes #??
- Depends on PR #??
```

---

## 5. 每个 BUG 的提交 checklist

| BUG | 触达文件 | 验收测试 |
|---|---|---|
| 1 | `manager-server/src/routes/steamcmd.ts` | `curl -X POST http://localhost:3001/api/steamcmd/check-update -H "Authorization: Bearer $TOKEN"` |
| 2 | `manager-web/src/hooks/useSteamCmdProgress.ts` (新) + `manager-web/src/components/server-setup/U3dsCard.tsx` + `manager-server/src/modules/steamcmd/SteamCmdManager.ts` (broadcast 加 jobId) | 手动装 U3DS 看进度条 |
| 3/7 | `Dockerfile` (mono + 镜像源) + `manager-server/src/routes/steamcmd.ts` (新端点) + `manager-server/src/modules/steamcmd/SteamCmdManager.ts` (新方法) + `manager-web/src/components/server-setup/U3dsCard.tsx` (前端入口) | 全新容器启动 → 安装 U3DS → 启动实例 200 |
| 4 | `docker-compose.yml` 或 README | `docker compose up -d` 后 `docker volume ls` 看见 |
| 5 | `manager-web/src/pages/ModsPage.tsx` + `manager-web/src/components/mods/ModCard.tsx` + `manager-web/src/components/mods/ModDetailDialog.tsx` | 下载 → 按钮变「已下载」 |
| 6 | `shared/contracts/workshop.ts` + `manager-server/src/routes/mods.ts` + `manager-server/src/modules/config/ConfigService.ts` (新方法) + `manager-web/src/pages/ConfigPage.tsx` | 装 Mod → 状态「待应用」 → apply → 状态「已启用」 |
| 8 | 新模块（5 文件） + 1 迁移 + `manager-server/src/index.ts` 挂载 | 增删改查 4 端点全 200 |
| 9 | `manager-server/src/modules/steamcmd/SteamCmdManager.ts` | `GET /steamcmd/status` 返回 version |
| 10 | `Dockerfile` | `docker build` 时间下降 |

---

## 6. 必须用户拍板的 4 项决策

| # | 决策点 | 选项 | 影响 |
|---|---|---|---|
| 1 | BUG-3/7 修复方案选 A/B/C | A=镜像自动装(10GB 镜像)<br>B=**面板引导式**(推荐，BUG-2 联动)<br>C=文档引导 | 镜像大小、SteamCMD 凭证、build 时间 |
| 2 | BUG-4 留命名卷 vs 改 bind mount | 命名卷(**当前**)+README 写明查看命令<br>bind mount (`./data/`)+ 权限处理 | 宿主机可见性 vs 权限坑 |
| 3 | BUG-10 国内镜像源用哪家 | 阿里云 mirrors.aliyun.com<br>**清华 mirrors.tuna.tsinghua.edu.cn**(推荐)<br>网易 mirrors.163.com | 团队 CI 镜像拉取速度 |
| 4 | BUG-8 计划任务优先级 | 跟着 Sprint C (5.5d)<br>降级到 Sprint 5 之后 | 数据库迁移 +1 |

---

## 7. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| BUG-3 因 mono 体积导致镜像膨胀 | 高 | 镜像 +1.5GB | multi-stage 只 COPY 必需 binary |
| BUG-8 调度器重启后状态丢失 | 中 | 用户感知失忆 | bootstrap 从 DB 重建 |
| BUG-6 状态字段名冲突（前端已用 `status`，后端用 `applied`） | 低 | TS 编译失败 | 先改 contract 后改前端 |
| BUG-2 WS jobId 字段后端没带 | 中 | 多人多任务进度串台 | 后端 broadcast 同步加 jobId |
| BUG-10 镜像源换后 sha256 校验 | 低 | 镜像 hash 变动 | CI 重新生成 SBOM |

---

## 8. 完成定义（Sprint B 闭环后）

- [ ] Sprint A / B / C 三个 PR 全部 merge
- [ ] Linux UAT 重跑 10 项 BUG 全部 200
- [ ] Playwright e2e 覆盖：装 U3DS 全流程 + 下载 Mod 全流程 + 计划任务全流程
- [ ] 镜像 build 时间从 X 分钟降到 Y 分钟
- [ ] 文档：本文档完成后 `git rm workflow_sprintB_linux_uat_bugfix_2026-08-10.md`（按 § 生命周期规则）
- [ ] update CLAUDE.md §6 git commit 文档过时检测（如有 .md 改动）

---

## 9. 参考资料

| 文档 | 关联 |
|---|---|
| `docs/architecture/architecture-spec.md` §1.4 Workshop 内容下载 | BUG-3/7、BUG-5 决策 |
| `claudedocs/reference_console_commands.md` | SteamCMD 命令格式 |
| `claudedocs/reference_config_files.md` | WorkshopDownloadConfig.json 字段 |
| `claudedocs/research_gsm3_steamcmd_unturned_2026-08-08.md` | GSM3 SteamCMD 抄录姿势 |
| `.claude/rules/unturned-sop.md` | U3DS 启动 + Mono 依赖铁律 |
| `.claude/rules/development.md` § 验证门槛 / § PR 5 件套 | 本 Sprint 必对齐 |
| `.claude/rules/communication.md` § Serena 记忆 | Sprint 完成后写记忆 |

---

**Sprint owner**：开发组
**Reviewer**：架构组 + 测试组
**预估 merge 日期**：Sprint A 2026-08-11 / Sprint B 2026-08-15 / Sprint C 2026-08-22

---

> 📌 **完成后**：本文档按 `document-organization.md` § 生命周期 → `git rm`，因为是 Sprint 工作流而非活参考。
