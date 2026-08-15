import { describe, it, expect, vi } from "vitest";
import { LdmApplyService } from "../src/modules/ldm/LdmApplyService.js";
import type {
  IBroadcaster,
  IServerManager,
  ILdmPluginCommandsService,
  ServerId,
} from "@unturned-manager/shared";

describe("LdmApplyService", () => {
  let serverManager: { applyChangesCore: ReturnType<typeof vi.fn> };
  let pluginCommands: { reloadPermissions: ReturnType<typeof vi.fn> };
  let broadcaster: { broadcast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    serverManager = {
      applyChangesCore: vi.fn().mockResolvedValue(undefined),
    };
    pluginCommands = {
      reloadPermissions: vi
        .fn()
        .mockResolvedValue({ outcome: "success", ldmOutput: "Reloaded permissions" }),
      loadPlugin: vi.fn(),
      unloadPlugin: vi.fn(),
    };
    broadcaster = { broadcast: vi.fn() };
  });

  function makeService(): LdmApplyService {
    return new LdmApplyService(
      serverManager as unknown as IServerManager,
      pluginCommands as unknown as ILdmPluginCommandsService,
      broadcaster as unknown as IBroadcaster,
    );
  }

  it("happy path: 推 preparing → 调 applyChangesCore → postStartHook 推 verifying → /p reload → ready", async () => {
    // applyChangesCore 内部会调 preStopHook + postStartHook——模拟
    serverManager.applyChangesCore.mockImplementation(
      async (serverId, opts) => {
        await opts.preStopHook?.();
        await opts.postStartHook?.();
      },
    );

    const svc = makeService();
    const result = await svc.apply("S1" as ServerId);

    expect(result.success).toBe(true);
    expect(result.stage).toBe("ready");
    expect(result.serverId).toBe("S1");
    // 推 WS 顺序：preparing → verifying → ready（再加末尾 ready 是 apply 收尾）
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ldm_apply_progress", stage: "preparing", percent: 0 }),
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ldm_apply_progress", stage: "verifying", percent: 90 }),
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ldm_apply_progress", stage: "ready", percent: 100 }),
    );
    // 调 applyChangesCore（hook='ldm_apply'）
    expect(serverManager.applyChangesCore).toHaveBeenCalledWith(
      "S1",
      expect.objectContaining({ hook: "ldm_apply" }),
    );
    // 调 /p reload
    expect(pluginCommands.reloadPermissions).toHaveBeenCalledWith("S1");
  });

  it("changedPlugins 透传到 applyChangesCore + 日志", async () => {
    const svc = makeService();
    await svc.apply("S1" as ServerId, { changedPlugins: ["Uconomy", "Vip"] });

    expect(serverManager.applyChangesCore).toHaveBeenCalledWith(
      "S1",
      expect.objectContaining({ hook: "ldm_apply" }),
    );
  });

  it("applyChangesCore 抛 operation-conflict → 推 failed + 透传 AppError", async () => {
    const { AppError } = await import("../src/utils/AppError.js");
    serverManager.applyChangesCore.mockRejectedValue(
      new AppError("operation-conflict", "操作冲突：当前正在 manual_restart", 409),
    );

    const svc = makeService();
    await expect(svc.apply("S1" as ServerId)).rejects.toMatchObject({
      code: "operation-conflict",
    });
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ldm_apply_progress",
        stage: "failed",
        errorMessage: expect.stringContaining("操作冲突"),
      }),
    );
  });

  it("/p reload 失败仅记录（实例已启动不 throw）→ 推 ready", async () => {
    serverManager.applyChangesCore.mockImplementation(
      async (_serverId, opts) => {
        await opts.postStartHook?.();
      },
    );
    const { AppError } = await import("../src/utils/AppError.js");
    pluginCommands.reloadPermissions.mockRejectedValue(
      new AppError("pty-write-failed", "PTY 写入失败", 500),
    );

    const svc = makeService();
    const result = await svc.apply("S1" as ServerId);

    // /p reload 失败不阻断——实例已启动，最终 stage=ready
    expect(result.stage).toBe("ready");
    expect(result.success).toBe(true);
  });

  it("applyChangesCore 非 AppError 错误 → 抛 AppError('ldm-apply-failed', 500)", async () => {
    serverManager.applyChangesCore.mockRejectedValue(new Error("PTY 异常"));

    const svc = makeService();
    await expect(svc.apply("S1" as ServerId)).rejects.toMatchObject({
      code: "ldm-apply-failed",
      status: 500,
    });
  });
});