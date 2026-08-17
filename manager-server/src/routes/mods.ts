import { Router } from "express";
import {
  ModDownloadRequestSchema,
  type IServerManager,
  type IWorkshopMetadataService,
  type IWorkshopAcfService,
  type IWorkshopDeleteService,
  type IConfigService,
  type ISteamCmdManager,
  type ServerId,
  type WorkshopFileId,
} from "@unturned-manager/shared";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import { reqLangToSteam } from "../utils/lang.js";
import { authenticateToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * 模组服务器操作路由（v2.6 — 删除 /apply；写 File_IDs 改走 config.ts）
 *
 * 路径：/api/servers/:id/mods
 * - GET    /downloaded      已下载列表（acf 扫描 + batch 元数据补全 + applied 合并）
 * - POST   /download        下载到 staging（异步启动：202 + jobId，进度走 WS steamcmd_progress）
 * - DELETE /:fileId         删除 Mod（acf + content + File_IDs）
 * - GET    /acf             读 acf 列表（真源）
 *
 * v2.6 设计：保存 Mod 与重启解耦——PUT /api/servers/:id/config/workshop 单独负责
 * 写 File_IDs（可运行时运行中）；staging → content 移动由 ServerManager.startInternal
 * 在 U3DS STOPPED 时自动执行。流程详见 docs/architecture/mod-management-design.md §3。
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
      throw new AppError("server-not-found", `服务端 ${serverId} 不存在`, 404);
    }
    return cfg.installDir;
  };

  // ── 1. GET /downloaded ──────────────────────────────
  // BUG-6 修复：合并 File_IDs（applied 状态）+ acf 元数据（timeupdated/size）
  // BUG-5 修复：合并主 acf + staging acf——下载到 staging 待 apply 的 mod 也可见
  //   applied=true 即「已下载且已应用」；applied=false 即「已下载待应用」
  router.get(
    "/mods/downloaded",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as ServerId;
      await resolveInstallDir(serverId);

      // ★ BUG-5/6 修复：主 acf（已 apply）+ staging acf（刚下载待 apply）合并去重
      const mainItems = await acfService.listItems(serverId);
      const stagingItems = await acfService.listStagingItems(serverId);
      const itemsMap = new Map<string, (typeof mainItems)[number]>();
      for (const item of stagingItems)
        itemsMap.set(item.fileId as string, item);
      for (const item of mainItems) {
        if (!itemsMap.has(item.fileId as string))
          itemsMap.set(item.fileId as string, item);
      }
      const items = Array.from(itemsMap.values());
      const fileIds = items.map((i) => i.fileId);

      // 读 File_IDs（WorkshopDownloadConfig.json）—— 决定 applied
      const config = await configService.readWorkshopConfig(serverId);
      const fileIdsSet = new Set<string>(config.File_IDs as string[]);

      // ★ 容错：Steam WebAPI 不可达时元数据补全失败**不应**拖垮已下载列表
      //   （acf 数据真实存在，title/previewUrl 只是增强字段，缺失可接受）
      let metas: Awaited<
        ReturnType<IWorkshopMetadataService["batchGetDetails"]>
      > = [];
      try {
        metas =
          fileIds.length > 0
            ? await workshopMeta.batchGetDetails(fileIds, reqLangToSteam(req))
            : [];
      } catch (err) {
        logger.warn(
          { serverId, err },
          "batchGetDetails 失败——已下载列表降级返回（无元数据）",
        );
      }
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
        applied: fileIdsSet.has(item.fileId as string), // ★ BUG-6 修复
      }));
      res.json({ data: merged });
    }),
  );

  // ── 5. POST /download ────────────────────────────────
  router.post(
    "/mods/download",
    validate(ModDownloadRequestSchema),
    asyncHandler(async (req, res) => {
      // ★ 2026-08-14 兼容 fileId（单 mod）和 fileIds（批量）——统一转数组。
      const body = req.body as {
        fileId?: WorkshopFileId;
        fileIds?: WorkshopFileId[];
      };
      const fileIds: WorkshopFileId[] = body.fileIds
        ? body.fileIds
        : body.fileId
          ? [body.fileId]
          : [];
      if (fileIds.length === 0) {
        res.status(400).json({
          error: { code: "invalid_message", message: "缺少 fileId 或 fileIds" },
        });
        return;
      }
      const serverId = req.params.id as ServerId;
      const installDir = await resolveInstallDir(serverId);

      // 元数据补 modTitle（多个时取第一个）
      let modTitle: string | undefined;
      try {
        const meta = await workshopMeta.getModDetails(fileIds[0]!, reqLangToSteam(req));
        modTitle = meta?.title;
      } catch {
        // 元数据查不到不影响下载流程
      }

      // BUG-5/6 修复：下载**异步启动**——立刻返回 jobId + 队列感知。
      // ★ 2026-08-14 队列化：同 staging 连点 N 次全部进队串行跑，不再 409。
      let jobId: string;
      try {
        jobId = await steamCmd.downloadWorkshopItem(
          installDir,
          fileIds as string[],
          serverId,
        );
      } catch (err) {
        res.status(502).json({
          error: {
            code: "download_failed",
            message: err instanceof Error ? err.message : "SteamCMD 下载失败",
          },
        });
        return;
      }

      res.status(202).json({
        data: {
          jobId,
          fileIds,
          modTitle,
          message: "Mod 下载已启动，进度由 WS steamcmd_progress 推送",
        },
      });
    }),
  );

  // ── 6. DELETE /:fileId ───────────────────────────────
  router.delete(
    "/mods/:fileId",
    asyncHandler(async (req, res) => {
      const fileId = req.params.fileId as WorkshopFileId;
      const serverId = req.params.id as ServerId;
      // 前置：U3DS 必须 STOPPED
      const op = serverManager.getActiveOperation(serverId);
      if (op.type !== "none") {
        res.status(409).json({
          error: {
            code: "server_busy",
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
    "/mods/acf",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as ServerId;
      await resolveInstallDir(serverId);
      const items = await acfService.listItems(serverId);
      res.json({
        data: {
          items,
          acfPath: "", // 内部路径不暴露
          parsedAt: new Date().toISOString(),
        },
      });
    }),
  );

  return router;
}
