import { Router } from "express";
import type { IMetricsService, MetricsWindow } from "@unturned-manager/shared";
import { MetricsQuerySchema } from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * 系统指标路由——Dashboard 资源图后端支撑。
 *
 * 端点：GET /api/system/metrics?serverId=xxx&window=1m|5m|15m
 *
 * **全局资源**：指标是全进程一份（多实例共装下不分 ServerID），不挂在
 * `/api/servers/:id/` 下——与其他全局工具接口（`/api/u3ds`、`/api/steamcmd`、
 * `/api/items`）同级。
 *
 * 鉴权：JWT（与其他面板端点一致）
 * 入参：query 参数 serverId（可选，仅响应回传用）+ window（可选，默认 5m）
 */
export function createMetricsRouter(metricsService: IMetricsService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const serverId =
        typeof req.query.serverId === "string" ? req.query.serverId : "";
      const parsed = MetricsQuerySchema.safeParse(req.query);
      const window: MetricsWindow = parsed.success ? parsed.data.window : "5m";
      const result = await metricsService.getMetrics(serverId, window);
      res.json({ data: result });
    }),
  );

  return router;
}