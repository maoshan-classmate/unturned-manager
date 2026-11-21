import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import { SteamCmdManager } from "../src/modules/steamcmd/SteamCmdManager.js";
import type {
  IProcessSupervisor,
  IBroadcaster,
} from "@unturned-manager/shared";

const fakeProcessSupervisor = {
  spawn: vi.fn().mockResolvedValue(1234),
  onStdout: vi.fn(),
  onStderr: vi.fn(),
  waitForExit: vi.fn().mockResolvedValue(undefined),
  forceKill: vi.fn(),
  onCrash: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
} as unknown as IProcessSupervisor;

const fakeBroadcaster = {
  broadcast: vi.fn(),
  init: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
} as unknown as IBroadcaster;

/** 取注册到进程编排上的 stdout 回调 */
function stdoutHandler(jobId: string): ((line: string) => void) | undefined {
  const call = vi
    .mocked(fakeProcessSupervisor.onStdout)
    .mock.calls.find((args) => args[0] === jobId);
  return call?.[1] as ((line: string) => void) | undefined;
}

describe("SteamCmdManager — 任务输出缓冲", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeProcessSupervisor.spawn.mockResolvedValue(1234);
    fakeProcessSupervisor.waitForExit.mockResolvedValue(undefined);
  });

  it("安装过程中的输出行会广播出去并记进缓冲", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "unlink").mockResolvedValue(undefined as never);

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
    );

    const jobId = await manager.installU3DS("/opt/unturned");
    expect(jobId).toBe("steamcmd-install-/opt/unturned");

    // 模拟 SteamCMD 输出一行
    const handler = stdoutHandler(jobId);
    expect(handler).toBeDefined();
    handler?.("Downloading app 1110390");

    // 广播里带上了原文
    expect(fakeBroadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "steamcmd_progress",
        jobId,
        line: "Downloading app 1110390",
      }),
    );

    // 缓冲里也能取回这一行
    const log = manager.getJobLog(jobId);
    expect(log.lines.map((line) => line.text)).toContain(
      "Downloading app 1110390",
    );
    expect(log.lines[0]?.seq).toBe(0);
  });

  it("未知任务取日志时返回空快照", () => {
    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
    );

    const log = manager.getJobLog("steamcmd-install-/不存在的目录");
    expect(log.lines).toEqual([]);
    expect(log.finished).toBe(false);
  });

  it("重装过程会把每一步写进缓冲", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs.promises, "rm").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "unlink").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as never);
    // 下载失败 → 任务走失败分支，但前面的步骤行仍应留在缓冲里
    vi.spyOn(
      SteamCmdManager.prototype as unknown as {
        downloadFile: () => Promise<void>;
      },
      "downloadFile",
    ).mockRejectedValue(new Error("mock download"));

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd",
      () => [],
    );

    const jobId = await manager.reinstall();
    await vi.waitFor(() =>
      expect(
        fakeBroadcaster.broadcast,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ type: "steamcmd_progress", jobId, stage: "failed" }),
      ),
    );

    const texts = manager.getJobLog(jobId).lines.map((line) => line.text);
    expect(texts).toContain("正在清理旧的 SteamCMD 文件…");
    expect(texts.some((text) => text.includes("重装失败"))).toBe(true);
  });
});
