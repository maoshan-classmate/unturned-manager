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
        await steamCmdManager.updateU3DS(installDir);
        res.status(202).json({
          data: {
            message: "U3DS 更新已启动，进度由 WS steamcmd_progress 推送",
          },
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("运行")) {
          throw new AppError("operation_conflict", err.message, 409);
        }
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
      await steamCmdManager.downloadWorkshopItem(installDir, itemIds);
      res.status(202).json({ data: { message: "Mod 下载已启动" } });
    }),
  );

  // ── B-1 修复：检查更新 + 重装 ─────────────────────────
  // 抄 GSM3 routes/steamcmd.ts:34-130 端点形态（响应结构对齐本项目 { data } 包装）
  router.post(
    "/check-update",
    validate(CheckUpdateSchema),
    asyncHandler(async (req, res) => {
      const { installDir } = req.body as { installDir?: string };
      try {
        const info = await steamCmdManager.checkUpdate(installDir);
        res.json({ data: info });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(
          "steamcmd-check-failed",
          err instanceof Error ? err.message : "检查更新失败",
          500,
        );
      }
    }),
  );

  // ── B-3 修复：安装 U3DS（前端引导按钮）── 抄 GSM3 installOnline 模式
  // 用户点击前端「安装 U3DS」按钮触发，**不**自动触发（SteamCMD + U3DS 由用户决定）
  router.post(
    "/install-u3ds",
    validate(UpdateSchema),
    asyncHandler(async (req, res) => {
      const { installDir } = req.body as { installDir: string };
      try {
        // BUG-2 异步化：installU3DS spawn 后立即返回 jobId，进度/完成/失败走 WS
        const jobId = await steamCmdManager.installU3DS(installDir);
        res.status(202).json({
          data: {
            jobId,
            message: "U3DS 安装已启动，进度由 WS steamcmd_progress 推送",
          },
        });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(
          "u3ds-install-failed",
          err instanceof Error ? err.message : "U3DS 安装失败",
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
        await steamCmdManager.reinstall(installDir);
        res.status(202).json({
          data: {
            message: "SteamCMD 重装已启动，进度由 WS steamcmd_progress 推送",
          },
        });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(
          "steamcmd-reinstall-failed",
          err instanceof Error ? err.message : "重装失败",
          500,
        );
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
      res.json({ data: { message: "SteamCMD 路径已保存" } });
    }),
  );

  return router;
}
