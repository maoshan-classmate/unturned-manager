/**
 * LdmPluginCommandsService 增强单测（Phase 2b D2/D3/D4）。
 *
 * 范围：reloadPermissions + readLdmVersion + readModulesState
 *       + 非 RUNNING 状态报错
 */
import { describe, it, expect, vi } from "vitest";
import { LdmPluginCommandsService } from "../src/modules/ldm/LdmPluginCommandsService.js";
import { ServerState } from "@unturned-manager/shared";
import type { ServerId } from "@unturned-manager/shared";
import { AppError } from "../src/utils/AppError.js";

// ─── Mocks ─────────────────────────────────────
function makeMocks(stdoutLines: string[] = []) {
  // onData 模拟：注册回调时立即同步触发预设 stdout（避免 race condition）
  let registeredCb: ((line: string) => void) | null = null;
  const pty = {
    onData: vi.fn().mockImplementation((_serverId: ServerId, cb: (line: string) => void) => {
      registeredCb = cb;
      // 同步触发所有 stdout 行（runMarkerless 在 onData 后才写命令）
      for (const line of stdoutLines) cb(line);
      return () => {
        registeredCb = null;
      };
    }),
    write: vi.fn().mockReturnValue(undefined),
    waitForMarker: vi.fn().mockImplementation(async () => {
      // 等回调注册后再返回（保证 race 期间 markerHit 已被设置）
      // 立即 resolve 让 runMarkerless 检查 markerHit
      return undefined;
    }),
  };
  const serverManager = {
    getState: vi.fn().mockReturnValue(ServerState.RUNNING),
  };
  return {
    pty,
    serverManager,
    registeredCb,
    makeSvc: () =>
      new LdmPluginCommandsService(
        pty as never,
        serverManager as never,
        async () => ({}),
      ),
  };
}

describe("LdmPluginCommandsService — Phase 2b D2/D3/D4", () => {
  // ─── D4 reloadPermissions ─────────────────────────

  it("reloadPermissions happy path: 收到 'Reloaded permissions' stdout → success", async () => {
    const { pty, makeSvc } = makeMocks([
      "Reloaded permissions from 'Permissions.config.xml'",
    ]);
    const svc = makeSvc();
    const result = await svc.reloadPermissions("S1" as ServerId);
    expect(result.outcome).toBe("success");
    expect(pty.write).toHaveBeenCalledWith("S1", "/p reload\r");
  });

  it("reloadPermissions 非 RUNNING → 抛 server-not-running", async () => {
    const { serverManager, makeSvc } = makeMocks();
    serverManager.getState.mockReturnValue(ServerState.STOPPED);
    const svc = makeSvc();
    await expect(svc.reloadPermissions("S1" as ServerId)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  // ─── D2 readLdmVersion ─────────────────────────────

  it("readLdmVersion happy path: 解析 'Rocket v4.0.0.0 for Unturned v3.25.0.0'", async () => {
    const { makeSvc } = makeMocks(["Rocket v4.0.0.0 for Unturned v3.25.0.0"]);
    const svc = makeSvc();
    const result = await svc.readLdmVersion("S1" as ServerId);
    expect(result.ldmVersion).toBe("4.0.0.0");
    expect(result.gameVersion).toBe("3.25.0.0");
  });

  it("readLdmVersion 解析失败 → 返回 null/null + 保留 raw", async () => {
    const { makeSvc } = makeMocks(["Unknown output"]);
    const svc = makeSvc();
    const result = await svc.readLdmVersion("S1" as ServerId);
    expect(result.ldmVersion).toBeNull();
    expect(result.gameVersion).toBeNull();
    expect(result.raw).toBe("Unknown output");
  });

  // ─── D3 readModulesState ─────────────────────────────

  it("readModulesState happy path: 含 'Rocket.Unturned' → loaded=true", async () => {
    const { makeSvc } = makeMocks(["Module: Rocket.Unturned v4.0.0.0 loaded"]);
    const svc = makeSvc();
    const result = await svc.readModulesState("S1" as ServerId);
    expect(result.rocketUnturnedLoaded).toBe(true);
  });

  it("readModulesState 不含 'Rocket.Unturned' → loaded=false", async () => {
    const { makeSvc } = makeMocks(["Module: SomeOtherModule loaded"]);
    const svc = makeSvc();
    const result = await svc.readModulesState("S1" as ServerId);
    expect(result.rocketUnturnedLoaded).toBe(false);
  });

  it("readModulesState 非 RUNNING → 抛 server-not-running", async () => {
    const { serverManager, makeSvc } = makeMocks();
    serverManager.getState.mockReturnValue(ServerState.STOPPING);
    const svc = makeSvc();
    await expect(svc.readModulesState("S1" as ServerId)).rejects.toBeInstanceOf(
      AppError,
    );
  });
});