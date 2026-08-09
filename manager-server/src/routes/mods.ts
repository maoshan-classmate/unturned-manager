import { Router } from 'express';
import {
  ModDownloadRequestSchema,
  ModApplyRequestSchema,
  type IServerManager,
  type IWorkshopMetadataService,
  type IWorkshopAcfService,
  type IWorkshopDeleteService,
  type IConfigService,
  type ISteamCmdManager,
  type ServerId,
  type WorkshopFileId,
} from '@unturned-manager/shared';
import { AppError } from '../utils/AppError.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * 模组服务器操作路由（v2.3 — 浏览端点已拆到 mod-browse.ts）
 *
 * 路径：/api/servers/:id/mods
 * - GET    /downloaded      已下载列表（acf 扫描 + batch 元数据补全 + applied 合并）
 * - POST   /download        下载到 staging（同步等待 SteamCMD 退出）
 * - POST   /apply           应用 Mod 变更 + 重启流水线
 * - DELETE /:fileId         删除 Mod（acf + content + File_IDs）
 * - GET    /acf             读 acf 列表（真源）
 *
 * BUG-6 修复：GET /downloaded 增 `applied` 字段（是否在 File_IDs 中）
 * BUG-5 修复：前端可用 `applied` 区分「已下载」vs「已应用」
 *
 * 全局浏览（搜索/详情/批量）：见 mod-browse.ts → /api/mods
 */
export function createModsRouter(
  serverManager: IServerManager,
  workshopMeta: IWorkshopMetadataService,
  acfService: IWorkshopAcfService,
  deleteService: IWorkshopDeleteService,
  steamCmd: ISteamCmdManager,
  configService: IConfigService,
): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticateToken);

  // ── 工具：从 serverId 查 installDir ────────────────────
  const resolveInstallDir = async (serverId: string): Promise<string> => {
    const servers = await serverManager.listServers();
    const cfg = servers.find((s) => s.id === serverId);
    if (!cfg) {
      throw new AppError('server-not-found', `服务端 ${serverId} 不存在`, 404);
    }
    return cfg.installDir;
  };

  // ── 1. GET /downloaded ──────────────────────────────
  // BUG-6 修复：合并 File_IDs（applied 状态）+ acf 元数据（timeupdated/size）
  // BUG-5 修复：applied=true 即「已下载且已应用」；applied=false 即「已下载待应用」
  router.get(
    '/mods/downloaded',
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as ServerId;
      await resolveInstallDir(serverId);
      const items = await acfService.listItems(serverId);
      const fileIds = items.map((i) => i.fileId);

      // 读 File_IDs（WorkshopDownloadConfig.json）—— 决定 applied
      const config = await configService.readWorkshopConfig(serverId);
      const fileIdsSet = new Set<string>(config.File_IDs as string[]);

      const metas = fileIds.length > 0 ? await workshopMeta.batchGetDetails(fileIds) : [];
      const metaMap = new Map(metas.map((m) => [m.fileId, m]));
      const merged = items.map((item) => ({
        fileId: item.fileId,
        timeupdated: item.timeupdated,
        size: item.size,
        manifest: item.manifest,
        title: metaMap.get(item.fileId)?.title,
        author: metaMap.get(item.fileId)?.author,
        authorName: metaMap.get(item.fileId)?.authorName,
        previewUrl: metaMap.get(item.fileId)?.previewUrl,
        applied: fileIdsSet.has(item.fileId as string),  // ★ BUG-6 修复
      }));
      res.json({ data: merged });
    }),
  );

  // ── 5. POST /download ────────────────────────────────
  router.post(
    '/mods/download',
    validate(ModDownloadRequestSchema),
    asyncHandler(async (req, res) => {
      const { fileId } = req.body as { fileId: WorkshopFileId };
      const serverId = req.params.id as ServerId;
      const installDir = await resolveInstallDir(serverId);

      // 先查 mod 元数据（实时，不缓存）拿 modTitle
      let modTitle: string | undefined;
      try {
        const meta = await workshopMeta.getModDetails(fileId);
        modTitle = meta?.title;
      } catch {
        // 元数据查不到不影响下载流程
      }

      // 调 SteamCMD 下载到 staging
      try {
        await steamCmd.downloadWorkshopItem(installDir, [fileId]);
      } catch (err) {
        res.status(502).json({
          error: {
            code: 'download_failed',
            message: err instanceof Error ? err.message : 'SteamCMD 下载失败',
          },
        });
        return;
      }

      // 读 staging acf 拿 size/timeupdated
      const acfItem = await acfService.parseStagingItem(serverId, fileId);

      res.json({
        data: {
          success: true,
          fileId,
          modTitle,
          ...(acfItem ? { acfItem } : {}),
        },
      });
    }),
  );

  // ── 6. POST /apply ───────────────────────────────────
  router.post(
    '/mods/apply',
    validate(ModApplyRequestSchema),
    asyncHandler(async (req, res) => {
      const { fileIds } = req.body as { fileIds: WorkshopFileId[] };
      const serverId = req.params.id as ServerId;
      // 委托 ServerManager.applyModChanges 走完整 SOP 流水线
      const promise = serverManager.applyModChanges(serverId, fileIds);
      const operationId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      res.status(202).json({ data: { operationId, status: 'running' } });
      // 异步执行（错误通过 audit + WS 广播）
      void promise.catch(() => undefined);
    }),
  );

  // ── 7. DELETE /:fileId ───────────────────────────────
  router.delete(
    '/mods/:fileId',
    asyncHandler(async (req, res) => {
      const fileId = req.params.fileId as WorkshopFileId;
      const serverId = req.params.id as ServerId;
      // 前置：U3DS 必须 STOPPED
      const op = serverManager.getActiveOperation(serverId);
      if (op.type !== 'none') {
        res.status(409).json({
          error: {
            code: 'server_busy',
            message: `服务端正在执行 ${op.type} 操作，无法删除 Mod`,
          },
        });
        return;
      }
      const result = await deleteService.deleteMod(serverId, fileId);
      res.json({ data: result });
    }),
  );

  // ── 8. GET /acf ──────────────────────────────────────
  router.get(
    '/mods/acf',
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as ServerId;
      await resolveInstallDir(serverId);
      const items = await acfService.listItems(serverId);
      res.json({
        data: {
          items,
          acfPath: '', // 内部路径不暴露
          parsedAt: new Date().toISOString(),
        },
      });
    }),
  );

  return router;
}
