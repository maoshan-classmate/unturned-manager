// 手动测试服务器——挂载全部路由，使用文件 DB（数据持久化）
// 启动：npx tsx tests/e2e/test-server.ts
import express from 'express';
import { createServer } from 'http';
import Database from 'better-sqlite3';
import * as argon2 from 'argon2';
import path from 'path';
import fs from 'fs';
import { resolveInstallDir } from '../../src/modules/server/pathResolver.js';

// e2e 用内存 DB——保证每次启动干净（文件 DB 会残留上次测试数据导致唯一键冲突）
// 手动调试如需持久化，可改回文件 DB
const db = new Database(':memory:');
db.pragma('journal_mode = MEMORY');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS refresh_tokens (jti TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_enc TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

// ADR-0003 B2：实例身份=目录存在性。清空 Servers/——防上次 run 残留 Commands.dat
// 导致 createServer 幂等检查误触发 409，保证每次 e2e 目录真源干净。
fs.rmSync(path.join(resolveInstallDir(), 'Servers'), { recursive: true, force: true });

const existing = db.prepare('SELECT id FROM users LIMIT 1').get() as unknown | undefined;
if (!existing) {
  const hash = await argon2.hash('admin123');
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hash);
  console.log('✅ 已创建测试用户 admin / admin123');
}

const { buildContainer } = await import('../../src/composition-root.js');
const { setAuthService } = await import('../../src/middleware/auth.js');
const { wsBroadcaster } = await import('../../src/ws/gateway.js');
const { createAuthRouter } = await import('../../src/routes/auth.js');
const { createServersRouter } = await import('../../src/routes/servers.js');
const { createModsRouter } = await import('../../src/routes/mods.js');
const { createModBrowseRouter } = await import('../../src/routes/mod-browse.js');
const { createRconRouter } = await import('../../src/routes/rcon.js');
const { createConfigRouter } = await import('../../src/routes/config.js');
const { createFilesRouter } = await import('../../src/routes/files.js');
const { createPlayersRouter } = await import('../../src/routes/players.js');
const { createSteamCmdRouter } = await import('../../src/routes/steamcmd.js');
const { createWorkshopRouter } = await import('../../src/routes/workshop.js');
const { createSettingsRouter } = await import('../../src/routes/settings.js');
const { errorHandler } = await import('../../src/middleware/errorHandler.js');
const { noCache } = await import('../../src/middleware/noCache.js');

const container = buildContainer(db);
setAuthService(container.authService as never);

const app = express();
const server = createServer(app);

// 禁用 ETag + 全局 no-cache
app.set('etag', false);
app.use(noCache);

app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

// 健康检查
app.get('/api/health', (_req, res) => { res.json({ status: 'ok', db: ':memory:' }); });

// 全部路由
app.use('/api/auth', createAuthRouter(container.authService));
app.use('/api/servers', createServersRouter(container.serverManager));
app.use('/api/mods', createModBrowseRouter(container.workshopMeta));
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
app.use(errorHandler);

// WebSocket
wsBroadcaster.init(server, container.authService as import('../../src/modules/auth/AuthService.js').AuthService);

const PORT = parseInt(process.env.TEST_PORT || '3099', 10);
server.listen(PORT, () => {
  console.log(`\n✅ 后端已启动: http://localhost:${PORT}`);
  console.log(`   用户名: admin  密码: admin123`);
  console.log(`   API:    http://localhost:${PORT}/api/health`);
  console.log(`   WS:     ws://localhost:${PORT}/ws`);
});
