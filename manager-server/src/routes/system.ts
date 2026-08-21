import { Router } from "express";
import net from "node:net";
import type { ISystemInfoService, ISteamCmdManager } from "@unturned-manager/shared";
import { SystemInfoQuerySchema } from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/** TCP 探活——5s 超时；返回 { ok, latencyMs, error? } */
function tcpProbe(
  host: string,
  port = 443,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (r: { ok: boolean; latencyMs: number; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(5000);
    socket.once("connect", () => done({ ok: true, latencyMs: Date.now() - start }));
    socket.once("timeout", () => done({ ok: false, latencyMs: Date.now() - start, error: "超时" }));
    socket.once("error", (err) =>
      done({ ok: false, latencyMs: Date.now() - start, error: err.message }),
    );
    socket.connect(port, host);
  });
}

/**
 * 主机信息路由——Dashboard 主机信息卡后端支撑。
 *
 * 端点：GET /api/system/info?serverId=
 * 鉴权：JWT
 */
export function createSystemRouter(systemInfoService: ISystemInfoService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/info",
    asyncHandler(async (req, res) => {
      const parsed = SystemInfoQuerySchema.safeParse(req.query);
      const serverId = parsed.success ? parsed.data.serverId : undefined;
      res.json({ data: await systemInfoService.getSystemInfo(serverId) });
    }),
  );

  return router;
}

/**
 * 系统诊断路由——Steam mod 下载连通性诊断。
 *
 * 端点：POST /api/system/test-mod-download
 * 鉴权：JWT
 *
 * 测三件事：
 * 1. api.steampowered.com TCP 连通性（元数据 API 是否可达）
 * 2. steamcontent.com TCP 连通性（内容 CDN 是否可达——这是 GFW 阻断点）
 * 3. SteamCMD 安装状态 + 版本
 *
 * 仅做 TCP 层探活不实际下载——避免重复造测试 mod 占用 staging。
 * 真实端到端下载测试：去 ModsPage 走真实下载流程。
 */
export function createSystemDiagnosticsRouter(
  steamCmdManager: ISteamCmdManager,
): Router {
  const router = Router();
  router.use(authenticateToken);

  router.post(
    "/test-mod-download",
    asyncHandler(async (_req, res) => {
      const [apiSteampowered, steamcontent] = await Promise.all([
        tcpProbe("api.steampowered.com"),
        tcpProbe("steamcontent.com"),
      ]);
      const status = await steamCmdManager.getStatus();
      res.json({
        data: {
          network: { apiSteampowered, steamcontent },
          steamcmd: {
            installed: status.isInstalled,
            version: status.version,
            installPath: status.installPath,
          },
        },
      });
    }),
  );

  return router;
}