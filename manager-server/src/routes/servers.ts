import { Router } from "express";
import type { IServerManager } from "@unturned-manager/shared";
import {
  CreateServerSchema,
  ConfigureServerSchema,
  DeleteServerSchema,
} from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export function createServersRouter(serverManager: IServerManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const servers = await serverManager.listServers();
      res.json({ data: servers });
    }),
  );

  router.post(
    "/",
    validate(CreateServerSchema),
    asyncHandler(async (req, res) => {
      await serverManager.createServer(req.body);
      res.status(201).json({ data: { message: "服务端创建成功" } });
    }),
  );

  router.patch(
    "/:id",
    validate(ConfigureServerSchema),
    asyncHandler(async (req, res) => {
      await serverManager.configureServer(req.params.id as never, req.body);
      res.json({ data: { message: "配置已更新" } });
    }),
  );

  router.post(
    "/:id/start",
    asyncHandler(async (req, res) => {
      // ★ ADR-0004 Phase 2：立即返回 terminalSessionId + pid，不等 U3DS 就绪。
      // 前端拿 terminalSessionId 跳转控制台（Phase 3 xterm.js）。
      const result = await serverManager.start(req.params.id as never);
      res.status(202).json({
        data: {
          terminalSessionId: result.terminalSessionId,
          pid: result.pid,
        },
      });
    }),
  );

  router.post(
    "/:id/stop",
    asyncHandler(async (req, res) => {
      await serverManager.stop(req.params.id as never, "用户手动停止");
      res.status(202).json({ data: { message: "服务端正在停止" } });
    }),
  );

  router.post(
    "/:id/restart",
    asyncHandler(async (req, res) => {
      // ★ P2 #4 改动：手动重启走 restartAndApplyMods（preStartHook 把 staging Mod 移入 content）。
      // 与 LDM「应用变更」共用 applyChangesCore 流水线本体——保证行为可观测可重入。
      await serverManager.restartAndApplyMods(
        req.params.id as never,
        "用户手动重启",
      );
      res.status(202).json({ data: { message: "服务端正在重启" } });
    }),
  );

  router.delete(
    "/:id",
    validate(DeleteServerSchema, "params"),
    asyncHandler(async (req, res) => {
      await serverManager.removeServer(req.params.id as never);
      res.json({ data: { message: "服务端已删除" } });
    }),
  );

  return router;
}
