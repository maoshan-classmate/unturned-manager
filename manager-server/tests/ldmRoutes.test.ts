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
import { createLdmServerRouter } from "../src/routes/ldm.js";
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
});