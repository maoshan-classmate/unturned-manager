import { Router } from "express";
import { IncidentsQuerySchema } from "@unturned-manager/shared";
import type { IIncidentsService, ServerId } from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * ServerID 事件流路由——Dashboard Status Block 支撑。
 *
 * 端点：GET /api/servers/:id/incidents?limit=50
 *
 * 鉴权：JWT（与其他面板端点一致）
 * 入参：query 参数 limit（可选，1–200，默认 50）
 * 响应：{ serverId, total, incidents[] }（按时间倒序）
 */
export function createIncidentsRouter(
  incidentsService: IIncidentsService,
): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticateToken);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const serverId = (req.params.id ?? "") as ServerId;
      const parsed = IncidentsQuerySchema.safeParse(req.query);
      const limit = parsed.success ? parsed.data.limit : undefined;
      const result = incidentsService.getIncidents(serverId, limit);
      res.json({ data: result });
    }),
  );

  return router;
}
