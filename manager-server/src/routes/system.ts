import { Router } from "express";
import type { ISystemInfoService } from "@unturned-manager/shared";
import { SystemInfoQuerySchema } from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * 主机信息路由——Dashboard 主机信息卡后端支撑。
 *
 * 端点：GET /api/system/info?serverId=
 *
 * 与 /api/system/metrics 同级——全进程一份资源，不挂在 /api/servers/:id 下。
 * 鉴权：JWT
 * 入参：query 参数 serverId（可选，仅用于读取该实例端口）
 * 响应：{ data: SystemInfo }
 */
export function createSystemRouter(systemInfoService: ISystemInfoService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/info",
    asyncHandler(async (req, res) => {
      const parsed = SystemInfoQuerySchema.safeParse(req.query);
      const serverId = parsed.success ? parsed.data.serverId : undefined;
      const info = await systemInfoService.getSystemInfo(serverId);
      res.json({ data: info });
    }),
  );

  return router;
}