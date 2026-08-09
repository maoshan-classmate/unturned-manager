// 全局绕过系统 HTTP_PROXY——所有 fetch() 直连不走代理。
// undici fetch 默认会读 HTTP_PROXY/HTTPS_PROXY 环境变量走代理，
// 代理访问 Steam 会超时（实测：走代理 504，直连 0.7s）。
// 强制删除代理环境变量，确保 node fetch 直连 Steam。
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connectTimeout: 30_000, headersTimeout: 30_000, bodyTimeout: 30_000 }));

import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { initDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { seedAdminUser } from './db/seed.js';
import { buildContainer } from './composition-root.js';
import { setAuthService, authenticateToken } from './middleware/auth.js';
import { wsBroadcaster } from './ws/gateway.js';

import { createAuthRouter } from './routes/auth.js';
import { createServersRouter } from './routes/servers.js';
import { createModsRouter } from './routes/mods.js';
import { createModBrowseRouter } from './routes/mod-browse.js';
import { createRconRouter } from './routes/rcon.js';
import { createConfigRouter } from './routes/config.js';
import { createFilesRouter } from './routes/files.js';
import { createPlayersRouter } from './routes/players.js';
import { createSteamCmdRouter } from './routes/steamcmd.js';
import { createWorkshopRouter } from './routes/workshop.js';
import { createSettingsRouter } from './routes/settings.js';
import { errorHandler } from './middleware/errorHandler.js';
import { noCache } from './middleware/noCache.js';

// ─── 初始化数据库 ──────────────────────────────────────
const db = initDb(config.dbPath);
runMigrations(db);
await seedAdminUser(db);

// ─── DI 容器 ───────────────────────────────────────────
const container = buildContainer(db);
setAuthService(container.authService as import('./modules/auth/AuthService.js').AuthService);

// ─── LogStreamer 接线（Phase 0 修复——日志流此前从未启动）──
for (const serverId of container.serverManager.listServersSync()) {
  container.logStreamer.startStreaming(serverId as never);
}
logger.info({ count: container.serverManager.listServersSync().length }, 'LogStreamer 已启动所有已加载服务器');

// ─── Express 应用 ──────────────────────────────────────
const app = express();
const server = createServer(app);

// 中间件塔
app.set('etag', false);
app.use(noCache);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));
// 二进制文件 raw 上传（不解析为 JSON）—— Phase 0 /files/raw 配套
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

// 请求日志
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url }, 'request');
  next();
});

// 健康检查（无需认证）
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// API 路由
app.use('/api/auth', createAuthRouter(container.authService));
app.use('/api/servers', createServersRouter(container.serverManager));
// 全局 Mod 浏览（Steam 创意工坊搜索/详情/批量——不依赖服务器实例）
app.use('/api/mods', createModBrowseRouter(container.workshopMeta));
// 服务器 Mod 操作（下载/已下载/应用/删除/acf——依赖服务器实例）
app.use('/api/servers/:id', createModsRouter(
  container.serverManager,
  container.workshopMeta,
  container.workshopAcf,
  container.workshopDelete,
  container.steamCmdManager,
  container.configService,
));
app.use('/api/servers', createRconRouter(container.rconManager));
app.use('/api/servers', createConfigRouter(container.configService));
app.use('/api/servers', createFilesRouter(container.filesService));
app.use('/api/servers', createPlayersRouter(container.rconManager));
app.use('/api/steamcmd', createSteamCmdRouter(container.steamCmdManager));
app.use('/api/workshop', createWorkshopRouter(container.workshopMeta));
app.use('/api/settings', createSettingsRouter(db));

// WebSocket
wsBroadcaster.init(server, container.authService as import('./modules/auth/AuthService.js').AuthService);

// ─── 前端静态托管（生产构建 + BrowserRouter SPA fallback）───
// 开发模式（vite dev server 走 5173 端口）此路径不存在 index.html，自动跳过。
// noCache 中间件已全局设 no-store，此处经 setHeaders 对哈希资源重设长期缓存。
const publicDir = path.resolve(process.cwd(), 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  // 静态资源：/assets/ 下 Vite 内容哈希文件名可长期缓存；其余 no-cache。
  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  // SPA fallback：非 /api、/ws 的 GET 全部回 index.html（BrowserRouter 前端路由）。
  app.get(/^\/(?!api(?:\/|$)|ws(?:\/|$)).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  logger.info({ publicDir }, '前端静态资源已挂载（生产模式）');
}

// 全局错误处理（必须注册在所有路由之后）
app.use(errorHandler);

// ─── 优雅关闭 ──────────────────────────────────────────
let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`收到 ${signal} 信号，开始优雅关闭...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('优雅关闭超时，强制退出');
    process.exit(1);
  }, 30000);

  try {
    await wsBroadcaster.destroy();
    await container.rconManager.destroy();
    await container.a2sClient.destroy();
    await container.processSupervisor.destroy();

    server.close();
    closeDb();

    logger.info('优雅关闭完成');
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '优雅关闭异常');
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

// ─── 启动 ──────────────────────────────────────────────
server.listen(config.port, config.host, () => {
  logger.info(`unturned-manager 后端已启动: http://${config.host}:${config.port}`);
  logger.info(`环境: ${config.nodeEnv}`);
});
