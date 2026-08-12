/**
 * LDM Mod 框架 Phase 1 路由——5 端点。
 *
 * 挂载：
 *   - /api/servers/:id/ldm/...   →  createLdmServerRouter（discovery + commands）
 *   - /api/ldm/...               →  createLdmCommunityRouter（community + PAT test）
 *
 * 依赖通过 composition-root 注入（DI 容器）。
 */
import { Router } from 'express';
import {
  PluginCommandRequestSchema,
  type ILdmDiscoveryService,
  type ILdmPluginCommandsService,
  type ILdmPluginSourceService,
  type ServerId,
} from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';

// ─── 服务端路由（per-server）───────────────────────────────

/**
 * 服务端 LDM 路由：/api/servers/:id/ldm ...
 *
 * - GET  /installed     列出已装插件（LdmDiscoveryService）
 * - POST /load-plugin   加载插件（PTY 写 /rocket load）
 * - POST /unload-plugin 卸载插件（PTY 写 /rocket unload）
 */
export function createLdmServerRouter(deps: {
  discovery: ILdmDiscoveryService;
  commands: ILdmPluginCommandsService;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticateToken);

  // GET /installed
  router.get(
    '/installed',
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError('server-id-missing', '实例 ID 缺失', 400);
      const result = await deps.discovery.listInstalledPlugins(serverId as ServerId);
      res.json({
        data: {
          serverId,
          plugins: result.plugins,
          ldmNotDetected: result.ldmNotDetected,
          detectedAtIso: new Date().toISOString(),
        },
      });
    }),
  );

  // POST /load-plugin
  router.post(
    '/load-plugin',
    validate(PluginCommandRequestSchema, 'body'),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError('server-id-missing', '实例 ID 缺失', 400);
      const { pluginName } = req.body as { pluginName: string };
      const result = await deps.commands.loadPlugin(serverId as ServerId, pluginName);
      res.json({
        data: {
          serverId,
          pluginName,
          outcome: result.outcome,
          ldmOutput: result.ldmOutput,
        },
      });
    }),
  );

  // POST /unload-plugin
  router.post(
    '/unload-plugin',
    validate(PluginCommandRequestSchema, 'body'),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError('server-id-missing', '实例 ID 缺失', 400);
      const { pluginName } = req.body as { pluginName: string };
      const result = await deps.commands.unloadPlugin(serverId as ServerId, pluginName);
      res.json({
        data: {
          serverId,
          pluginName,
          outcome: result.outcome,
          ldmOutput: result.ldmOutput,
        },
      });
    }),
  );

  return router;
}

// ─── 全局路由（community / PAT）───────────────────────────

/**
 * 全局 LDM 路由：/api/ldm ...
 *
 * - GET  /community-plugins      拉取 LDM-Community 列表
 * - POST /community-plugins/test-pat  测试 GitHub PAT
 */
export function createLdmCommunityRouter(svc: ILdmPluginSourceService): Router {
  const router = Router();
  router.use(authenticateToken);

  // GET /community-plugins
  router.get(
    '/community-plugins',
    asyncHandler(async (req, res) => {
      // PAT 从 header 读（X-Github-Pat）—— 不入 store，仅当前请求使用
      const pat = (req.headers['x-github-pat'] as string | undefined) ?? null;
      const result = await svc.listCommunityPlugins(pat);
      res.json({ data: result });
    }),
  );

  // POST /community-plugins/test-pat
  router.post(
    '/community-plugins/test-pat',
    asyncHandler(async (req, res) => {
      const { pat } = req.body as { pat: string };
      const result = await svc.testPat(pat);
      res.json({ data: result });
    }),
  );

  return router;
}
