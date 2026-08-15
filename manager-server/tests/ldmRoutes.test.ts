/**
 * LDM 路由单元测试（Phase 2a 新增 4 端点）。
 *
 * 范围：routes/ldm.ts 加的 4 端点 happy path + 错误码
 *   - GET  /api/servers/:id/ldm/plugins/:name/config
 *   - PUT  /api/servers/:id/ldm/plugins/:name/config
 *   - PUT  /api/servers/:id/ldm/rocket-config
 *   - PUT  /api/servers/:id/ldm/permissions-config
 *
 * 策略：mock ILdmDiscoveryService / ILdmPluginCommandsService / ILdmConfigWriter，
 *       supertest 跑 express + 真实路由（不验 JWT——直接装 router，不走 auth）。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { createLdmServerRouter, createLdmCommunityRouter } from "../src/routes/ldm.js";
import { setAuthService } from "../src/middleware/auth.js";

// 全局 stub AuthService（让 authenticateToken 中间件放过测试请求）
beforeAll(() => {
  setAuthService({
    validateAccessToken: () => ({ userId: 1, username: "test", role: "admin" }),
  } as unknown as Parameters<typeof setAuthService>[0]);
});

// ─── Mock 依赖 ──────────────────────────────────────
const mockDiscovery = {
  listInstalledPlugins: vi.fn().mockResolvedValue({
    plugins: [],
    ldmNotDetected: false,
  }),
  getStatus: vi.fn().mockResolvedValue({
    serverId: "S1",
    ldmInstalled: true,
    rocketDirExists: true,
    pluginCount: 3,
    detectedAtIso: "2026-08-15T06:00:00.000Z",
  }),
  searchPlugins: vi.fn().mockResolvedValue([]),
};
const mockCommands = {
  loadPlugin: vi.fn().mockResolvedValue({
    outcome: "success",
    ldmOutput: "Plugin Uconomy loaded",
  }),
  unloadPlugin: vi.fn().mockResolvedValue({
    outcome: "success",
    ldmOutput: "Plugin Uconomy unloaded",
  }),
  reloadPermissions: vi.fn().mockResolvedValue({
    outcome: "success",
    ldmOutput: "Reloaded permissions",
  }),
  reloadPlugin: vi.fn().mockResolvedValue({
    outcome: "success",
    ldmOutput: "Reloading Uconomy",
  }),
  readLdmVersion: vi.fn().mockResolvedValue({
    ldmVersion: "4.9.3.18",
    gameVersion: "3.25.0.0",
    raw: "Rocket v4.9.3.18 for Unturned v3.25.0.0",
  }),
  readModulesState: vi.fn().mockResolvedValue({
    rocketUnturnedLoaded: true,
    raw: "Rocket.Unturned loaded",
  }),
};
const mockConfigWriter = {
  writeRocketConfig: vi.fn().mockResolvedValue({
    success: true,
    backupPath: "/Servers/S1/Rocket/Rocket.config.xml.bak.2026-08-15T06-00-00Z",
    writtenAtIso: "2026-08-15T06:00:00.000Z",
  }),
  writeRocketUnturnedConfig: vi.fn().mockResolvedValue({
    success: true,
    backupPath: "/Servers/S1/Rocket/Rocket.Unturned.config.xml.bak.2026-08-15T06-00-00Z",
    writtenAtIso: "2026-08-15T06:00:00.000Z",
  }),
  writePermissionsConfig: vi.fn().mockResolvedValue({
    success: true,
    backupPath: "/Servers/S1/Rocket/Permissions.config.xml.bak.2026-08-15T06-00-00Z",
    writtenAtIso: "2026-08-15T06:00:00.000Z",
  }),
  writePluginConfig: vi.fn().mockResolvedValue({
    success: true,
    backupPath: "/Servers/S1/Rocket/Plugins/Uconomy/Uconomy.configuration.xml.bak.2026-08-15T06-00-00Z",
    writtenAtIso: "2026-08-15T06:00:00.000Z",
  }),
};
const mockApplyService = {
  apply: vi.fn().mockResolvedValue({
    serverId: "S1",
    success: true,
    stage: "ready",
    startedAtIso: "2026-08-15T06:00:00.000Z",
    completedAtIso: "2026-08-15T06:00:05.000Z",
  }),
};
const mockSourceService = {
  listCommunityPlugins: vi.fn().mockResolvedValue({
    plugins: [],
    fetchedAtIso: "2026-08-15T06:00:00.000Z",
    stale: false,
  }),
  testPat: vi.fn().mockResolvedValue({
    ok: true,
    code: null,
    rateLimit: null,
    message: null,
  }),
  getPluginDetail: vi.fn().mockResolvedValue({
    slug: "XanderCodes/AppleAdminControl",
    name: "AppleAdminControl",
    author: "XanderCodes",
    description: "Admin control plugin",
    repoUrl: "https://github.com/XanderCodes/AppleAdminControl",
    latestVersion: "1.1.2",
    updatedAtIso: "2026-03-07T14:15:06Z",
    releasesUrl: "https://github.com/XanderCodes/AppleAdminControl/releases/latest",
    readmePreview: "AppleAdminControl is a plugin...",
  }),
};

// 构造 app（authenticateToken 中间件由 setAuthService 全局 stub 放行）
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/servers/:id/ldm",
    createLdmServerRouter({
      discovery: mockDiscovery,
      commands: mockCommands,
      configWriter: mockConfigWriter,
      applyService: mockApplyService,
    }),
  );
  // 全局错误 handler——把 AppError 序列化为 { error: { code, message } }
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { code?: string; message?: string; status?: number };
    res.status(e.status ?? 500).json({
      error: { code: e.code ?? "internal_error", message: e.message ?? "unknown" },
    });
  });
  return app;
}

function makeAppCommunity() {
  const app = express();
  app.use(express.json());
  app.use("/api/ldm", createLdmCommunityRouter(mockSourceService as never));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { code?: string; message?: string; status?: number };
    res.status(e.status ?? 500).json({
      error: { code: e.code ?? "internal_error", message: e.message ?? "unknown" },
    });
  });
  return app;
}

// ─── 测试 ──────────────────────────────────────────

describe("LDM 路由 — Phase 2a 4 端点", () => {
  it("PUT /rocket-config happy path: 调 configWriter.writeRocketConfig 返回成功响应", async () => {
    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/rocket-config")
      .set("Authorization", "Bearer test-token")
      .send({
        languageCode: "zh-CN",
        maxFrames: 60,
        automaticShutdownEnabled: false,
        automaticShutdownInterval: 86400,
        webPermissionsEnabled: false,
        webPermissionsUrl: "",
        webPermissionsInterval: 180,
        webConfigurationsEnabled: false,
        webConfigurationsUrl: "",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.file).toBe("Rocket.config.xml");
    expect(mockConfigWriter.writeRocketConfig).toHaveBeenCalledTimes(1);
  });

  it("PUT /rocket-unturned-config happy path: 调 configWriter.writeRocketUnturnedConfig（P0-3 回归）", async () => {
    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/rocket-unturned-config")
      .set("Authorization", "Bearer test-token")
      .send({
        automaticSaveEnabled: true,
        automaticSaveInterval: 1800,
        characterNameValidation: false,
        characterNameValidationRule: "([\\x00-\\AA]|[\\w_\\ \\.\\+\\-])+",
        logSuspiciousPlayerMovement: true,
        enableItemBlacklist: false,
        enableItemSpawnLimit: false,
        maxSpawnAmount: 10,
        enableVehicleBlacklist: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.file).toBe("Rocket.Unturned.config.xml");
    expect(mockConfigWriter.writeRocketUnturnedConfig).toHaveBeenCalledTimes(1);
  });

  it("PUT /rocket-unturned-config 错误码：Zod 校验失败 → 400", async () => {
    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/rocket-unturned-config")
      .set("Authorization", "Bearer test-token")
      .send({ automaticSaveEnabled: "not-bool" });
    expect(res.status).toBe(400);
  });

  it("PUT /permissions-config happy path: 调 configWriter.writePermissionsConfig", async () => {
    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/permissions-config")
      .set("Authorization", "Bearer test-token")
      .send({
        defaultGroup: "default",
        groups: [
          {
            id: "default",
            displayName: "Player",
            color: "white",
            members: [],
            priority: 100,
            permissions: [],
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(mockConfigWriter.writePermissionsConfig).toHaveBeenCalledTimes(1);
  });

  it("PUT /plugins/:name/config happy path: 调 configWriter.writePluginConfig", async () => {
    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/plugins/Uconomy/config")
      .set("Authorization", "Bearer test-token")
      .send({ raw: "<UconomyConfiguration><Balance>100</Balance></UconomyConfiguration>" });
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(mockConfigWriter.writePluginConfig).toHaveBeenCalledWith(
      "S1",
      "Uconomy",
      "<UconomyConfiguration><Balance>100</Balance></UconomyConfiguration>",
    );
  });

  it("PUT /plugins/:name/config 错误码：pluginName 含非法字符 → writer 抛 plugin-name-invalid", async () => {
    const originalMock = mockConfigWriter.writePluginConfig.getMockImplementation();
    mockConfigWriter.writePluginConfig.mockImplementationOnce(async () => {
      throw new (await import("../src/utils/AppError.js")).AppError(
        "plugin-name-invalid",
        "插件名含非法字符",
        400,
      );
    });

    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/plugins/Uconomy/config")
      .set("Authorization", "Bearer test-token")
      .send({ raw: "<x/>" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("plugin-name-invalid");

    mockConfigWriter.writePluginConfig.mockImplementation(originalMock ?? (() => Promise.resolve({})));
  });

  it("PUT /plugins/:name/config 错误码：XML 非法 → writer 抛 plugin-config-invalid", async () => {
    const originalMock = mockConfigWriter.writePluginConfig.getMockImplementation();
    mockConfigWriter.writePluginConfig.mockImplementationOnce(async () => {
      throw new (await import("../src/utils/AppError.js")).AppError(
        "plugin-config-invalid",
        "XML 解析失败",
        400,
      );
    });

    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/plugins/Bad/config")
      .set("Authorization", "Bearer test-token")
      .send({ raw: "<root><unclosed>" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("plugin-config-invalid");

    mockConfigWriter.writePluginConfig.mockImplementation(originalMock ?? (() => Promise.resolve({})));
  });

  it("PUT /rocket-config 错误码：Zod 校验失败 → 400", async () => {
    const app = makeApp();
    const res = await request(app)
      .put("/api/servers/S1/ldm/rocket-config")
      .set("Authorization", "Bearer test-token")
      .send({
        maxFrames: "sixty",
      });
    expect(res.status).toBe(400);
  });

  it("GET /plugins/:name/config 错误码：pluginName 缺失 → 400 plugin-name-missing", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/plugins//config")
      .set("Authorization", "Bearer test-token");
    expect([400, 404]).toContain(res.status);
  });

  // ─── Phase 2b POST /apply 端点 ─────────────────────────────────────

  it("POST /apply happy path: 调 applyService.apply 透传 body.changedPlugins", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/servers/S1/ldm/apply")
      .set("Authorization", "Bearer test-token")
      .send({ changedPlugins: ["Uconomy", "Vip"] });
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe("ready");
    expect(mockApplyService.apply).toHaveBeenCalledWith("S1", {
      changedPlugins: ["Uconomy", "Vip"],
    });
  });

  it("POST /apply 无 body → applyService.apply 调无 changedPlugins", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/servers/S1/ldm/apply")
      .set("Authorization", "Bearer test-token")
      .send({});
    expect(res.status).toBe(200);
    expect(mockApplyService.apply).toHaveBeenCalledWith("S1", undefined);
  });

  it("POST /apply 错误码：applyService 抛 operation-conflict → 409", async () => {
    const { AppError } = await import("../src/utils/AppError.js");
    mockApplyService.apply.mockRejectedValueOnce(
      new AppError("operation-conflict", "操作冲突：当前正在 manual_restart", 409),
    );

    const app = makeApp();
    const res = await request(app)
      .post("/api/servers/S1/ldm/apply")
      .set("Authorization", "Bearer test-token")
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("operation-conflict");
  });

  // ─── Phase 3 端点 ────────────────────────────────────────

  it("GET /status happy path: 调 discovery.getStatus", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/status")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(200);
    expect(res.body.data.ldmInstalled).toBe(true);
    expect(res.body.data.pluginCount).toBe(3);
    expect(mockDiscovery.getStatus).toHaveBeenCalledWith("S1");
  });

  it("GET /community-plugins/:slug happy path: 调 sourceService.getPluginDetail", async () => {
    const app = makeAppCommunity();
    const res = await request(app)
      .get("/api/ldm/community-plugins/XanderCodes/AppleAdminControl")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(200);
    expect(res.body.data.latestVersion).toBe("1.1.2");
    expect(mockSourceService.getPluginDetail).toHaveBeenCalledWith(
      "XanderCodes/AppleAdminControl",
      null,
    );
  });

  it("GET /community-plugins/:slug 错误码：getPluginDetail 返回 null → 404", async () => {
    mockSourceService.getPluginDetail.mockResolvedValueOnce(null);

    const app = makeAppCommunity();
    const res = await request(app)
      .get("/api/ldm/community-plugins/Unknown/Plugin")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("plugin-detail-not-found");
  });

  it("GET /community-plugins/:slug 错误码：单段 slug（缺 owner/） → 404 not-found", async () => {
    const app = makeAppCommunity();
    const res = await request(app)
      .get("/api/ldm/community-plugins/invalid-no-slash")
      .set("Authorization", "Bearer test-token");
    // 单段不匹配 :owner/:repo 路由 → Express 404
    expect(res.status).toBe(404);
  });

  // ─── Phase 3-3 端点（D2/D3：LDM 版本 + 模块状态）───────────────────────

  it("GET /version happy path: 调 commands.readLdmVersion → 包装 serverId", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/version")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(200);
    expect(res.body.data.serverId).toBe("S1");
    expect(res.body.data.ldmVersion).toBe("4.9.3.18");
    expect(res.body.data.gameVersion).toBe("3.25.0.0");
    expect(res.body.data.raw).toBe("Rocket v4.9.3.18 for Unturned v3.25.0.0");
    expect(mockCommands.readLdmVersion).toHaveBeenCalledWith("S1");
  });

  it("GET /version 错误码：实例非 RUNNING → 409 server-not-running", async () => {
    const { AppError } = await import("../src/utils/AppError.js");
    mockCommands.readLdmVersion.mockRejectedValueOnce(
      new AppError("server-not-running", "实例未运行，无法读 LDM 版本", 409),
    );
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/version")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("server-not-running");
  });

  it("GET /modules-state happy path: 调 commands.readModulesState → 包装 serverId", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/modules-state")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(200);
    expect(res.body.data.serverId).toBe("S1");
    expect(res.body.data.rocketUnturnedLoaded).toBe(true);
    expect(mockCommands.readModulesState).toHaveBeenCalledWith("S1");
  });

  it("GET /modules-state 错误码：实例非 RUNNING → 409 server-not-running", async () => {
    const { AppError } = await import("../src/utils/AppError.js");
    mockCommands.readModulesState.mockRejectedValueOnce(
      new AppError("server-not-running", "实例未运行，无法读模块状态", 409),
    );
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/modules-state")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("server-not-running");
  });

  // ─── Phase 4a 端点（单插件 reload）────────────────────────────────

  it("POST /reload-plugin happy path: 调 commands.reloadPlugin → 包装 serverId + pluginName", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/servers/S1/ldm/reload-plugin")
      .set("Authorization", "Bearer test-token")
      .send({ pluginName: "Uconomy" });
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("success");
    expect(res.body.data.ldmOutput).toBe("Reloading Uconomy");
    expect(mockCommands.reloadPlugin).toHaveBeenCalledWith("S1", "Uconomy");
  });

  it("POST /reload-plugin 错误码：pluginName 缺失 → 400 plugin-name-missing", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/servers/S1/ldm/reload-plugin")
      .set("Authorization", "Bearer test-token")
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /reload-plugin 错误码：pluginName 非法字符 → 400 plugin-name-invalid", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/servers/S1/ldm/reload-plugin")
      .set("Authorization", "Bearer test-token")
      .send({ pluginName: "evil path" });
    expect(res.status).toBe(400);
  });

  it("POST /reload-plugin 错误码：实例非 RUNNING → 409 server-not-running", async () => {
    const { AppError } = await import("../src/utils/AppError.js");
    mockCommands.reloadPlugin.mockRejectedValueOnce(
      new AppError("server-not-running", "实例未运行，无法 reload", 409),
    );
    const app = makeApp();
    const res = await request(app)
      .post("/api/servers/S1/ldm/reload-plugin")
      .set("Authorization", "Bearer test-token")
      .send({ pluginName: "Uconomy" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("server-not-running");
  });

  // ─── Phase 4b 端点（插件搜索/筛选）──────────────────────────────

  it("GET /plugins/search 无 query: searchPlugins 调无 opts（全部状态）", async () => {
    mockDiscovery.searchPlugins.mockResolvedValueOnce([
      {
        name: "Uconomy",
        version: "3.0.0.0",
        sizeBytes: 1024,
        hasConfig: true,
        modifiedAtIso: "2026-08-15T06:00:00.000Z",
        runtimeStatus: "loaded",
      },
    ]);
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/plugins/search")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Uconomy");
    expect(mockDiscovery.searchPlugins).toHaveBeenCalledWith("S1", {
      query: "",
      status: null,
    });
  });

  it("GET /plugins/search 带 query + status: 透传 searchPlugins opts", async () => {
    mockDiscovery.searchPlugins.mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/plugins/search?query=Uconomy&status=loaded")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(200);
    expect(mockDiscovery.searchPlugins).toHaveBeenCalledWith("S1", {
      query: "Uconomy",
      status: "loaded",
    });
  });

  it("GET /plugins/search 错误码：status 非法值 → 400 status-invalid", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/servers/S1/ldm/plugins/search?status=invalid")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("status-invalid");
  });

  it("GET /plugins/search 错误码：serverId 缺失 → 404 not-found（路由不匹配）", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/ldm/plugins/search")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(404);
  });
});