import { Router } from "express";
import type {
  IPtyManager,
  ISessionManager,
  PersistedTerminalSession,
  ServerId,
} from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * 终端会话路由（1:1 GSM3 `routes/terminal.ts:44` 形态）。
 *
 * 单一端点：`GET /api/sessions` → `{ active: PersistedTerminalSession[], saved: PersistedTerminalSession[] }`
 *
 * active = 当前 PTY 进程在跑且 JSON 里有记录的会话（isActive=true）；
 * saved  = JSON 里有记录但 PTY 已退出的会话（isActive=false；前端显示「终端已断开」toast）。
 *
 * 合并去重逻辑对齐 GSM3 `TerminalPage.tsx:875-908`：前端拿两份数据自行去重。
 */
export function createSessionsRouter(
  sessionManager: ISessionManager,
  ptyManager: IPtyManager,
): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const saved = sessionManager.getSavedSessions();

      // 筛选 PTY 当前在跑的会话
      const active: PersistedTerminalSession[] = saved
        .filter((s) => ptyManager.isRunning(s.id as ServerId))
        .map((s) => ({ ...s, isActive: true }));

      // saved 排除已在 active 的（PTY 还活的不算「已断开」）
      const activeIds = new Set(active.map((s) => s.id));
      const savedOnly = saved.filter((s) => !activeIds.has(s.id));

      res.json({ data: { active, saved: savedOnly } });
    }),
  );

  return router;
}