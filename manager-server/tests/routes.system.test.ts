/**
 * 主机信息路由单测。
 *
 * 端点：GET /api/system/info?serverId=
 * 策略：mock ISystemInfoService + supertest 跑真实路由（不验 JWT——setAuthService 装桩）。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { createSystemRouter, createSystemDiagnosticsRouter } from "../src/routes/system.js";
import { setAuthService } from "../src/middleware/auth.js";
import type { ISystemInfoService, SystemInfo } from "@unturned-manager/shared";

beforeAll(() => {
  setAuthService({
    validateAccessToken: () => ({ userId: 1, username: "test", role: "admin" }),
  } as unknown as Parameters<typeof setAuthService>[0]);
});

function makeInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    hostname: "host-01",
    distro: "Debian GNU/Linux",
    release: "12",
    arch: "x64",
    kernel: "6.1.0-13-amd64",
    platform: "linux",
    cpu: { brand: "Intel Xeon", physicalCores: 4, cores: 8, speed: 2.6 },
    memTotalMB: 16384,
    diskTotalBytes: 250 * 1024 ** 3,
    diskUsedBytes: 140 * 1024 ** 3,
    gamePort: null,
    queryPort: null,
    ...overrides,
  };
}

describe("GET /api/system/info — 鉴权", () => {
  it("未提供 Authorization 头返回 401", async () => {
    const svc = { getSystemInfo: vi.fn() } as unknown as ISystemInfoService;
    const app = express();
    app.use(createSystemRouter(svc));
    const res = await request(app).get("/info");
    expect(res.status).toBe(401);
    expect(svc.getSystemInfo).not.toHaveBeenCalled();
  });
});

describe("GET /api/system/info — 正常路径", () => {
  it("无 serverId 参数返回完整主机信息，端口字段为空", async () => {
    const info = makeInfo();
    const svc = {
      getSystemInfo: vi.fn().mockResolvedValue(info),
    } as unknown as ISystemInfoService;
    const app = express();
    app.use(createSystemRouter(svc));
    const res = await request(app)
      .get("/info")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.data.hostname).toBe("host-01");
    expect(res.body.data.gamePort).toBeNull();
    expect(svc.getSystemInfo).toHaveBeenCalledWith(undefined);
  });

  it("传入 serverId 时透传至 service，端口字段反映该实例", async () => {
    const info = makeInfo({ gamePort: 27015, queryPort: 27016 });
    const svc = {
      getSystemInfo: vi.fn().mockResolvedValue(info),
    } as unknown as ISystemInfoService;
    const app = express();
    app.use(createSystemRouter(svc));
    const res = await request(app)
      .get("/info?serverId=MyServer")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.data.gamePort).toBe(27015);
    expect(res.body.data.queryPort).toBe(27016);
    expect(svc.getSystemInfo).toHaveBeenCalledWith("MyServer");
  });
});

describe("GET /api/system/info — 入参校验", () => {
  it("非法类型 serverId（数组）走 safeParse 兜底，调用 service 传 undefined", async () => {
    const info = makeInfo();
    const svc = {
      getSystemInfo: vi.fn().mockResolvedValue(info),
    } as unknown as ISystemInfoService;
    const app = express();
    app.use(createSystemRouter(svc));
    const res = await request(app)
      .get("/info?serverId=a&serverId=b")
      .set("Authorization", "Bearer test-token");

    // Zod serverId 不是数组——safeParse 失败，service 用兜底 undefined
    expect(res.status).toBe(200);
    expect(svc.getSystemInfo).toHaveBeenCalledWith(undefined);
  });
});

describe("POST /api/system/test-mod-download — Steam mod 下载诊断", () => {
  function makeApp(steamCmdStatus: { isInstalled: boolean; version?: string; installPath?: string }) {
    const steamCmd = {
      getStatus: vi.fn().mockResolvedValue(steamCmdStatus),
    } as unknown as Parameters<typeof createSystemDiagnosticsRouter>[0];
    const app = express();
    app.use(express.json());
    app.use("/api/system", createSystemDiagnosticsRouter(steamCmd));
    return { app, steamCmd };
  }

  it("返回网络 + SteamCMD 状态完整结构", async () => {
    const { app } = makeApp({ isInstalled: true, version: "1785799152", installPath: "/opt/steamcmd" });
    const res = await request(app)
      .post("/api/system/test-mod-download")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      network: {
        apiSteampowered: expect.objectContaining({ ok: expect.any(Boolean), latencyMs: expect.any(Number) }),
        steamcontent: expect.objectContaining({ ok: expect.any(Boolean), latencyMs: expect.any(Number) }),
      },
      steamcmd: { installed: true, version: "1785799152", installPath: "/opt/steamcmd" },
    });
  });

  it("未提供 Authorization 头返回 401", async () => {
    const { app } = makeApp({ isInstalled: false });
    const res = await request(app).post("/api/system/test-mod-download");
    expect(res.status).toBe(401);
  });

  it("SteamCMD 未安装时 installed=false", async () => {
    const { app, steamCmd } = makeApp({ isInstalled: false });
    const res = await request(app)
      .post("/api/system/test-mod-download")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.data.steamcmd.installed).toBe(false);
    expect(steamCmd.getStatus).toHaveBeenCalled();
  });
});