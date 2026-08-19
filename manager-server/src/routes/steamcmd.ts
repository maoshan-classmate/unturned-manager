import { Router } from "express";
import { z } from "zod";
import type { ISteamCmdManager } from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";

const UpdateSchema = z.object({
  installDir: z.string().min(1, "安装路径不能为空"),
});

const DownloadSchema = z.object({
  installDir: z.string().min(1),
  itemIds: z.array(z.string()).min(1),
});

/** B-1 修复：check-update / reinstall 端点 installDir 可选（不传则走 SteamCmdManager 探测） */
const CheckUpdateSchema = z.object({
  installDir: z.string().min(1).optional(),
});

const ReinstallSchema = z.object({
  installDir: z.string().min(1).optional(),
});

/** 前端 SteamCmdPathDialog 路径编辑端点（此前缺失 → 404，本次补上） */
const InstallPathSchema = z.object({
  installPath: z.string().min(1, "安装路径不能为空"),
});

export function createSteamCmdRouter(
  steamCmdManager: ISteamCmdManager,
): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/status",
    asyncHandler(async (_req, res) => {
      const status = await steamCmdManager.getStatus();
      res.json({ data: status });
    }),
  );

  router.post(
    "/update",
    validate(UpdateSchema),
    asyncHandler(async (req, res) => {
      const { installDir } = req.body as { installDir: string };
      try {
        // updateU3DS spawn 后立即返回 jobId，HTTP 202 不等待 30min
        const jobId = await steamCmdManager.updateU3DS(installDir);
        res.status(202).json({ data: { jobId } });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw err;
      }
    }),
  );

  // 卡 C #6：Workshop 内容下载（下载到 staging，可不停服；应用由卡 B 流水线）
  router.post(
    "/download-workshop",
    validate(DownloadSchema),
    asyncHandler(async (req, res) => {
      const { installDir, itemIds } = req.body as {
        installDir: string;
        itemIds: string[];
      };
      // 与另外 4 个异步端点一致返回 jobId——
      // 未来调用方按 jobId 精确订阅 WS 进度/完成/失败
      const jobId = await steamCmdManager.downloadWorkshopItem(
        installDir,
        itemIds,
      );
      res.status(202).json({ data: { jobId } });
    }),
  );

  // ── B-1 检查更新 + 重装 ─────────────────────────
  // checkUpdate spawn 后立即返回 jobId，结果通过 WS `steamcmd_progress`
  // 携带 latestVersion 字段广播（前端订阅后弹 toast「U3DS 最新版本: xxx」）
  router.post(
    "/check-update",
    validate(CheckUpdateSchema),
    asyncHandler(async (req, res) => {
      const { installDir } = req.body as { installDir?: string };
      try {
        const jobId = await steamCmdManager.checkUpdate(installDir);
        res.status(202).json({ data: { jobId } });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw err;
      }
    }),
  );

  // ── 安装 U3DS（前端引导按钮）───────────────────────────
  // 用户点击前端「安装 U3DS」按钮触发，不自动触发（SteamCMD + U3DS 由用户决定）
  router.post(
    "/install-u3ds",
    validate(UpdateSchema),
    asyncHandler(async (req, res) => {
      const { installDir } = req.body as { installDir: string };
      try {
        // installU3DS spawn 后立即返回 jobId，进度/完成/失败走 WS
        const jobId = await steamCmdManager.installU3DS(installDir);
        res.status(202).json({ data: { jobId } });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(
          "u3ds-install-failed",
          err instanceof Error ? err.message : "Unturned 服务端安装失败",
          500,
        );
      }
    }),
  );

  router.post(
    "/reinstall",
    validate(ReinstallSchema),
    asyncHandler(async (req, res) => {
      const { installDir } = req.body as { installDir?: string };
      try {
        // Phase 0 异步化：reinstall 改为立即返回 jobId，下载/解压/初始化在后台跑
        const jobId = await steamCmdManager.reinstall(installDir);
        res.status(202).json({ data: { jobId } });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw err;
      }
    }),
  );

  // ★ 前端 SteamCmdPathDialog 路径编辑端点（此前缺失 → 404，本次补上）。
  // 设置后 SteamCmdManager 用它解析可执行（resolveExecutable），重启回落 STEAMCMD_DIR env。
  router.patch(
    "/install-path",
    validate(InstallPathSchema),
    asyncHandler(async (req, res) => {
      const { installPath } = req.body as { installPath: string };
      steamCmdManager.setInstallPath(installPath);
      res.json({ data: { ok: true } });
    }),
  );

  return router;
}
