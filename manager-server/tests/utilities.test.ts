import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { SteamCmdManager } from "../src/modules/steamcmd/SteamCmdManager.js";
import { FilesService } from "../src/modules/files/FilesService.js";
import { FileLockProvider } from "../src/modules/filelock/FileLockProvider.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";
import type {
  IBroadcaster,
  IProcessSupervisor,
  ServerId,
} from "@unturned-manager/shared";

function makeMockBroadcaster(): IBroadcaster {
  return {
    broadcast: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    registerRequestHandler: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

describe("SteamCmdManager", () => {
  it("updateU3DS: 有活跃实例时拒绝", async () => {
    // ADR-0003 B2 §3.4：DB state 列已删 → 用 activeProbe 探活（注入返回活跃实例）
    const proc: IProcessSupervisor = {
      spawn: vi.fn(),
      gracefulShutdown: vi.fn(),
      waitForExit: vi.fn(),
      forceKill: vi.fn(),
      isRunning: vi.fn(),
      destroy: vi.fn(),
      onStdout: vi.fn(),
      onCrash: vi.fn(),
    };
    const mgr = new SteamCmdManager(
      proc,
      makeMockBroadcaster(),
      "/usr/bin/steamcmd",
      () => ["S1" as ServerId],
    );
    await expect(mgr.updateU3DS("/opt/unturned")).rejects.toThrow(/运行/);
  });

  it("updateU3DS: 全部 STOPPED 但 SteamCMD 不存在 → 拒绝", async () => {
    const proc: IProcessSupervisor = {
      spawn: vi.fn(),
      gracefulShutdown: vi.fn(),
      waitForExit: vi.fn(),
      forceKill: vi.fn(),
      isRunning: vi.fn(),
      destroy: vi.fn(),
      onStdout: vi.fn(),
      onCrash: vi.fn(),
    };
    const mgr = new SteamCmdManager(
      proc,
      makeMockBroadcaster(),
      "/nope/steamcmd",
      () => [],
    );
    await expect(mgr.updateU3DS("/opt/unturned")).rejects.toThrow(/未安装/);
  });

  it("parseProgressLine: downloading + 78% → stage=downloading, percent=78", () => {
    const proc: IProcessSupervisor = {
      spawn: vi.fn(),
      gracefulShutdown: vi.fn(),
      waitForExit: vi.fn(),
      forceKill: vi.fn(),
      isRunning: vi.fn(),
      destroy: vi.fn(),
      onStdout: vi.fn(),
      onCrash: vi.fn(),
    };
    const mgr = new SteamCmdManager(proc, makeMockBroadcaster());
    const parsed = (
      mgr as unknown as {
        parseProgressLine: (l: string) => { stage: string; percent?: number };
      }
    ).parseProgressLine(
      "Update state (0x61) downloading,78.36 MB  78% / 4589923",
    );
    expect(parsed.stage).toBe("downloading");
    expect(parsed.percent).toBe(78);
  });
});

describe("FilesService", () => {
  let svc: FilesService;
  /** fixture 根 = config.installDir（ADR-0003 / T2：真源全局，与 FilesService.resolveInstallDir 一致）。
   *  serverId 唯一（并行 forks pool 下各文件目录隔离，避免互踩 .test-install） */
  const serverDir = path.join(resolveInstallDir(), "Servers", "FilesServer");

  beforeEach(async () => {
    await fs.rm(serverDir, { recursive: true, force: true });
    await fs.mkdir(serverDir, { recursive: true });

    // T2 后构造器单参（fileLock）——不再依赖 db
    svc = new FilesService(new FileLockProvider());
  });

  it("validatePath: `..` 越界拒绝", async () => {
    await expect(
      svc.listDirectory("FilesServer" as ServerId, "../../../etc"),
    ).rejects.toMatchObject({});
  });

  it("listDirectory: 空目录 → []", async () => {
    const result = await svc.listDirectory("FilesServer" as ServerId, "");
    expect(result).toEqual([]);
  });

  it("writeFile + readFile: 文本往返不破", async () => {
    await svc.writeFile(
      "FilesServer" as ServerId,
      "Commands.dat",
      new TextEncoder().encode("Name X\n"),
    );
    const buf = await svc.readFile("FilesServer" as ServerId, "Commands.dat");
    const text = new TextDecoder().decode(buf);
    expect(text).toBe("Name X\n");
  });

  it("敏感字段 GSLT/Password 脱敏", async () => {
    await svc.writeFile(
      "FilesServer" as ServerId,
      "config.txt",
      new TextEncoder().encode("GSLT mySecretToken123456\nPassword hunter2\n"),
    );
    const buf = await svc.readFile("FilesServer" as ServerId, "config.txt");
    const text = new TextDecoder().decode(buf);
    expect(text).toContain("GSLT [REDACTED]");
    expect(text).toContain("Password [REDACTED]");
    expect(text).not.toContain("mySecretToken123456");
  });
});
