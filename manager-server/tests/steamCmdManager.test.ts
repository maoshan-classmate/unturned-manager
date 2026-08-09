import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  SteamCmdManager,
  type ExecFileAdapter,
} from "../src/modules/steamcmd/SteamCmdManager.js";
import type {
  IProcessSupervisor,
  IBroadcaster,
} from "@unturned-manager/shared";

// ─── 测试替身 ─────────────────────────────────────────────

const fakeProcessSupervisor = {
  spawn: vi.fn(),
  onStdout: vi.fn(),
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

/** 构造可控的 execFileAdapter —— 单测里直接调 mockReturnValueOnce */
function mockAdapter(): ExecFileAdapter & ReturnType<typeof vi.fn> {
  return vi.fn() as unknown as ExecFileAdapter & ReturnType<typeof vi.fn>;
}

// ─── 测试 ────────────────────────────────────────────────

describe("SteamCmdManager — BUG-9 修复: getStatus version 字段", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getStatus 当 SteamCMD 未安装时返回 isInstalled=false 且 version=undefined", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const exec = mockAdapter();
    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/nonexistent/steamcmd",
      () => [],
      exec,
    );

    const status = await manager.getStatus();

    expect(status.isInstalled).toBe(false);
    expect(status.version).toBeUndefined();
    // installPath 是构造器传入的 steamCmdPath（即使 isInstalled=false 也带回）
    expect(status.installPath).toBe("/nonexistent/steamcmd");
    expect(status.lastChecked).toBeDefined();
    expect(exec).not.toHaveBeenCalled(); // 未安装就不 spawn
  });

  it("getStatus 当 SteamCMD 已安装时 spawn +version 解析 version 字段", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const exec = mockAdapter();
    exec.mockResolvedValueOnce({
      stdout:
        "Steam Console Client (Linux) Version 1719583862 - 2024-06-27T00:00:00 UTC\n",
      stderr: "",
    });

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
      exec,
    );
    const status = await manager.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.installPath).toBe("/opt/steamcmd/steamcmd.sh");
    expect(status.version).toBe("1719583862 (2024-06-27T00:00:00 UTC)");
    expect(exec).toHaveBeenCalledWith(
      "/opt/steamcmd/steamcmd.sh",
      ["+version", "+quit"],
      { timeout: 10_000 },
    );
  });

  it("getStatus 当 steamcmd +version 解析失败时仍返回 isInstalled=true 但 version=undefined（兜底）", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const exec = mockAdapter();
    exec.mockRejectedValueOnce(new Error("spawn failed"));

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
      exec,
    );
    const status = await manager.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.version).toBeUndefined(); // 兜底：不抛错
  });
});

describe("SteamCmdManager — BUG-1 修复: checkUpdate 解析", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checkUpdate 当 SteamCMD 未安装时抛 AppError(steamcmd-not-found, 404)", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const exec = mockAdapter();
    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/nonexistent/steamcmd",
      () => [],
      exec,
    );

    await expect(manager.checkUpdate()).rejects.toMatchObject({
      code: "steamcmd-not-found",
      status: 404,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("checkUpdate 解析 +app_info_print 输出: buildid + name + lastChecked", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const fakeStdout = `
"1110390"
{
  "appid"     "1110390"
  "name"     "Unturned Dedicated Server"
  "buildid"     "12345678"
}
    `;
    const exec = mockAdapter();
    exec.mockResolvedValueOnce({ stdout: fakeStdout, stderr: "" });

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
      exec,
    );
    const result = await manager.checkUpdate();

    expect(result.currentBuildId).toBe("12345678");
    expect(result.latestVersion).toBe("Unturned Dedicated Server");
    expect(result.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("checkUpdate 当 3 套命令序列都拿不到 buildid 时抛 AppError(steamcmd-check-failed)", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const exec = mockAdapter();
    // 3 套 fallback 全部返回无 buildid 的输出 → 循环耗尽 → 抛错（对齐 GSM3 fetchAppBranches 全失败 throw）
    exec.mockResolvedValue({ stdout: "no useful output", stderr: "" });

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
      exec,
    );

    await expect(manager.checkUpdate()).rejects.toMatchObject({
      code: "steamcmd-check-failed",
      status: 500,
    });
    // 3 套命令序列各跑一次 runscript
    expect(exec).toHaveBeenCalledTimes(3);
  });
});

// ─── Linux 实机 BUG-1/9 根因回归：steamCmdPath 是目录（STEAMCMD_DIR=/opt/steamcmd）────
describe("SteamCmdManager — 目录探测（Linux 实机 BUG-1/9 根因）", () => {
  /** 建一个含 dummy steamcmd.sh 的临时 SteamCMD 目录 */
  function makeSteamCmdDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steamcmd-test-"));
    fs.writeFileSync(path.join(dir, "steamcmd.sh"), "#!/bin/bash\nexit 0\n", {
      mode: 0o755,
    });
    return dir;
  }

  it("steamCmdPath 是目录时 getStatus 解析目录内 steamcmd.sh 并解析版本（不再 spawn 目录 EACCES）", async () => {
    const dir = makeSteamCmdDir();
    try {
      const exec = mockAdapter();
      exec.mockResolvedValueOnce({
        stdout:
          "Steam Console Client (c) Valve Corporation -- version 1719583862\n",
        stderr: "",
      });
      const manager = new SteamCmdManager(
        fakeProcessSupervisor,
        fakeBroadcaster,
        dir,
        () => [],
        exec,
      );

      const status = await manager.getStatus();

      expect(status.isInstalled).toBe(true);
      // installPath 返回配置的目录（对齐 GSM3 config.installPath 语义），不是解析后的可执行
      expect(status.installPath).toBe(dir);
      // 真实输出是小写 "version" —— 大小写不敏感匹配，BUG-9 版本号必须展示
      expect(status.version).toBe("1719583862");
      expect(exec).toHaveBeenCalledWith(
        path.join(dir, "steamcmd.sh"),
        ["+version", "+quit"],
        { timeout: 10_000 },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkUpdate 当 steamCmdPath 是目录时用目录内 steamcmd.sh 执行（runscript 文件驱动，不抛 EACCES）", async () => {
    const dir = makeSteamCmdDir();
    try {
      const exec = mockAdapter();
      exec.mockResolvedValueOnce({
        stdout:
          '"1110390"\n{\n  "buildid" "12345678"\n  "name" "Unturned Dedicated Server"\n}\n',
        stderr: "",
      });
      const manager = new SteamCmdManager(
        fakeProcessSupervisor,
        fakeBroadcaster,
        dir,
        () => [],
        exec,
      );

      const result = await manager.checkUpdate();

      expect(result.currentBuildId).toBe("12345678");
      const [cmd, args] = exec.mock.calls[0];
      expect(cmd).toBe(path.join(dir, "steamcmd.sh"));
      // runscript 文件驱动（对齐 GSM3 fetchAppBranches）：命令写进 .scf 文件，不再塞 execFile args
      expect(args[0]).toBe("+runscript");
      expect(args[1] as string).toMatch(/\.scf$/);
      // 断言没有把字面引号塞进命令行
      expect(args.some((a: string) => a.includes('"'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("目录内无 steamcmd.sh / linux32/steamcmd 时视为未安装，不 spawn", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steamcmd-empty-"));
    try {
      const exec = mockAdapter();
      const manager = new SteamCmdManager(
        fakeProcessSupervisor,
        fakeBroadcaster,
        dir,
        () => [],
        exec,
      );

      const status = await manager.getStatus();

      expect(status.isInstalled).toBe(false);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
