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
    // BUG-9（第五版）：steamcmd 实测输出末尾带 " - type 'quit' to exit --" 交互提示；
    // 截断逻辑只剥到这里，残留的 " - --" 必须被丢弃——version 只显示数字 buildid。
    exec.mockResolvedValueOnce({
      stdout:
        "Steam Console Client (Linux) Version 1785799152 - type 'quit' to exit --\n",
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
    expect(status.version).toBe("1785799152");
    expect(exec).toHaveBeenCalledWith(
      "/opt/steamcmd/steamcmd.sh",
      ["+version", "+quit"],
      { timeout: 10_000 },
    );
  });

  it("getStatus 当 steamcmd 输出带 build date 时仍拼进 version（YYYY-MM-DD 识别）", async () => {
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

    expect(status.version).toBe("1719583862 (2024-06-27T00:00:00 UTC)");
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

  it("checkUpdate 解析 +app_info_print 输出: 异步返回 jobId + 广播 completed 携带 latestVersion", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    // 后台要写 runscript 到 tmpDir——mock 掉文件 IO 避免污染真实文件系统
    vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "unlink").mockResolvedValue(undefined as never);
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
    const jobId = await manager.checkUpdate();

    // Phase 0 异步化：HTTP 立即返回 jobId（结果经 WS 广播）
    expect(jobId).toBe("steamcmd-check-default");
    // 后台异步执行完成 → 广播 completed + latestVersion
    await vi.waitFor(() =>
      expect(fakeBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "steamcmd_progress",
          jobId,
          stage: "completed",
          percent: 100,
          latestVersion: "12345678",
        }),
      ),
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("checkUpdate 当 3 套命令序列都拿不到 buildid 时广播 failed（不再抛错——异步 jobId）", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "unlink").mockResolvedValue(undefined as never);
    const exec = mockAdapter();
    // 3 套 fallback 全部返回无 buildid 的输出 → 循环耗尽 → 广播 failed（对齐 GSM3 fetchAppBranches 全失败 throw）
    exec.mockResolvedValue({ stdout: "no useful output", stderr: "" });

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
      exec,
    );

    // 不 reject——HTTP 立即拿到 jobId
    const jobId = await manager.checkUpdate();
    expect(jobId).toBe("steamcmd-check-default");
    // 3 套命令序列各跑一次 runscript（attempt>0 间有 500ms sleep，总 ~1s → 超时放宽到 5s）
    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(3), {
      timeout: 5000,
    });
    // 全失败 → 广播 failed
    expect(fakeBroadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "steamcmd_progress",
        jobId,
        stage: "failed",
      }),
    );
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
      // BUG-9（第五版）：steamcmd 实测末尾是 " - type 'quit' to exit --"
      exec.mockResolvedValueOnce({
        stdout:
          "Steam Console Client (Linux) Version 1785799152 - type 'quit' to exit --\n",
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
      // 真实输出是小写 "version" —— 大小写不敏感匹配，BUG-9 版本号必须展示（末尾 - -- 不吞）
      expect(status.version).toBe("1785799152");
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
      vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as never);
      vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
      vi.spyOn(fs.promises, "unlink").mockResolvedValue(undefined as never);
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

      const jobId = await manager.checkUpdate();

      // Phase 0 异步化：返回 jobId；后台广播 completed + latestVersion
      expect(jobId).toContain("steamcmd-check-");
      await vi.waitFor(() =>
        expect(fakeBroadcaster.broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "steamcmd_progress",
            jobId,
            stage: "completed",
            latestVersion: "12345678",
          }),
        ),
      );
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

// ─── Phase 0 code review 回归 ───────────────────────────
// 覆盖交叉审查 agent 发现的真实 bug（P1-1/P1-2/P2-4），防止再次引入。
describe("SteamCmdManager — Phase 0 review 回归", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reinstall 当 installPath 是文件时 jobId 用原始路径（P1-1：前后端订阅一致）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steamcmd-rx-"));
    // Debian 布局：/usr/games/steamcmd 是脚本文件（statSync.isFile=true）→
    // 后端 reinstall 归一 targetDir=/usr/games，但 jobId 必须保留原始文件路径，
    // 否则前端按 `steamcmd-reinstall-${status.installPath}` 订阅永远失配。
    const fakeFile = path.join(dir, "steamcmd");
    fs.writeFileSync(fakeFile, "#!/bin/bash\nexit 0\n");
    try {
      vi.spyOn(fs.promises, "rm").mockResolvedValue(undefined as never);
      vi.spyOn(fs.promises, "unlink").mockResolvedValue(undefined as never);
      vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as never);
      // downloadFile 是 private——mock 掉避免真实 https 下载；后台立即失败走 failed 广播
      vi.spyOn(
        SteamCmdManager.prototype as unknown as {
          downloadFile: () => Promise<void>;
        },
        "downloadFile",
      ).mockRejectedValue(new Error("mock download"));

      const exec = mockAdapter();
      const manager = new SteamCmdManager(
        fakeProcessSupervisor,
        fakeBroadcaster,
        fakeFile,
        () => [],
        exec,
      );

      const jobId = await manager.reinstall();

      // 归一（isFile → dirname）仅用于锁与删/下/解压；jobId 保留原始路径
      expect(jobId).toBe(`steamcmd-reinstall-${fakeFile}`);
      // 后台失败广播 + 锁释放
      await vi.waitFor(() =>
        expect(fakeBroadcaster.broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "steamcmd_progress",
            jobId,
            stage: "failed",
          }),
        ),
      );
      // 锁已释放：第二次可立即再触发（jobId 稳定）
      await expect(manager.reinstall()).resolves.toBe(
        `steamcmd-reinstall-${fakeFile}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkUpdate 当 mkdir 失败时抛错且释放锁（P1-2：不再永久 409）", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    // mock mkdir reject（/tmp 满/权限异常场景）——修复前锁永久残留在 activeJobs
    vi.spyOn(fs.promises, "mkdir").mockRejectedValue(new Error("EACCES mock"));
    const exec = mockAdapter();
    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
      exec,
    );

    await expect(manager.checkUpdate()).rejects.toThrow("EACCES mock");
    // 锁已释放：第二次同样走到 mkdir（reject EACCES），而非 409 steamcmd-busy
    await expect(manager.checkUpdate()).rejects.toThrow("EACCES mock");
  });

  it("downloadWorkshopItem 同 installDir 有任务时抛 AppError 409（P2-4：不再裸 Error）", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    // 第一任务 spawn 正常，但后台 waitForExit 挂起 → 锁持续持有
    fakeProcessSupervisor.spawn.mockResolvedValue(123);
    fakeProcessSupervisor.waitForExit.mockReturnValue(new Promise(() => {}));
    const exec = mockAdapter();
    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      "/opt/steamcmd/steamcmd.sh",
      () => [],
      exec,
    );

    const jobId = await manager.downloadWorkshopItem("/opt/unturned", ["1"]);
    expect(jobId).toBe("steamcmd-download-/opt/unturned");
    // 锁持有中 → 第二个并发请求 409（此前是裸 Error，路由无法区分错误类型）
    await expect(
      manager.downloadWorkshopItem("/opt/unturned", ["2"]),
    ).rejects.toMatchObject({ code: "steamcmd-busy", status: 409 });
  });
});
