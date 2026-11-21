import { Router } from "express";
import { z } from "zod";
import type { IPlayerService, ServerId } from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/** 玩家操作请求校验——SteamID 是 10–20 位数字字符串 */
const ActionSchema = z.object({
  steamId: z
    .string()
    .regex(/^\d{10,20}$/, "玩家标识格式不正确"),
  action: z.enum(["admin", "unadmin", "kick", "ban", "unban"]),
  reason: z.string().max(200, "原因不能超过 200 字").optional(),
  durationMinutes: z
    .number()
    .int("封禁时长必须是整数")
    .min(0, "封禁时长不能为负数")
    .max(525600, "封禁时长不能超过一年")
    .optional(),
});

/**
 * 玩家管理路由——挂在 /api/servers/:id/players 下。
 *
 * GET  /                  玩家列表（在线玩家 + 管理员/黑名单）
 * POST /action            执行管理命令（admin/unadmin/kick/ban/unban）
 */
export function createPlayersRouter(playerService: IPlayerService): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticateToken);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const serverId = (req.params.id ?? "") as ServerId;
      res.json({ data: await playerService.getPlayers(serverId) });
    }),
  );

  router.post(
    "/action",
    validate(ActionSchema),
    asyncHandler(async (req, res) => {
      const serverId = (req.params.id ?? "") as ServerId;
      const result = await playerService.act(serverId, req.body);
      res.json({ data: result });
    }),
  );

  return router;
}
