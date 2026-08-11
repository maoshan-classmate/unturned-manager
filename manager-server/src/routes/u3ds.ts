import { Router } from "express";
import type { IU3dsStatusProvider } from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * Unturned 服务端（U3DS）状态路由——纯读、无参数。
 *
 * 与 /steamcmd/status 同形态：GET + 鉴权 + 返回 `{ data: 状态 }`。
 * 端点无请求体无查询参数，**不挂 validate()**——与现有 SteamCMD 状态路由一致。
 */
export function createU3dsRouter(u3dsStatus: IU3dsStatusProvider): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/status",
    asyncHandler(async (_req, res) => {
      const status = await u3dsStatus.getStatus();
      res.json({ data: status });
    }),
  );

  return router;
}