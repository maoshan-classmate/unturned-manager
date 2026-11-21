import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

// config 在模块加载时读取 INSTALL_DIR——必须在 import 前设置
const TEST_DIR = path.join(os.tmpdir(), "players-test-" + process.pid);
process.env.INSTALL_DIR = TEST_DIR;

const { PlayerService } = await import(
  "../src/modules/players/PlayerService.js"
);

function makeDeps() {
  const pty = {
    write: vi.fn(),
    isRunning: vi.fn(() => true),
  };
  const serverManager = {
    listServersSync: vi.fn(() => ["S1"]),
    getState: vi.fn(() => "RUNNING"),
  };
  return {
    pty,
    serverManager,
    service: new PlayerService(
      pty as never,
      serverManager as never,
    ),
  };
}

async function setupFiles(log: string, commands = "Name S1\n") {
  await fs.mkdir(path.join(TEST_DIR, "Servers", "S1", "Server"), {
    recursive: true,
  });
  await fs.mkdir(path.join(TEST_DIR, "Logs"), { recursive: true });
  await fs.writeFile(
    path.join(TEST_DIR, "Logs", "Server_S1.log"),
    log,
  );
  await fs.writeFile(
    path.join(TEST_DIR, "Servers", "S1", "Server", "Commands.dat"),
    commands,
  );
}

describe("PlayerService 玩家数据解析", () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("从日志解析在线玩家与管理员标识", async () => {
    await setupFiles(
      [
        '[2026-11-21 08:59:08] Added 76561198296194775[0] "昼白" to queue position 0',
        '[2026-11-21 08:59:12] Connecting: PlayerID: 76561198296194775 Name: 昼白 Character: ACE',
      ].join("\n"),
      "Name S1\nOwner 76561198296194775\n",
    );
    const { service } = makeDeps();

    const result = await service.getPlayers("S1" as never);

    expect(result.players).toHaveLength(1);
    expect(result.players[0]).toMatchObject({
      steamId: "76561198296194775",
      name: "昼白",
      character: "ACE",
      isAdmin: true,
      isBanned: false,
    });
    expect(result.live).toBe(true);
  });

  it("断开事件移除对应玩家", async () => {
    await setupFiles(
      [
        '[2026-11-21 08:59:08] Connecting: PlayerID: 76561198296194775 Name: 昼白 Character: ACE',
        '[2026-11-21 09:00:00] Connecting: PlayerID: 76561198296194776 Name: 小明 Character: Bob',
        '[2026-11-21 09:01:00] Disconnected: 昼白',
      ].join("\n"),
    );
    const { service } = makeDeps();

    const result = await service.getPlayers("S1" as never);

    expect(result.players).toHaveLength(1);
    expect(result.players[0]?.name).toBe("小明");
  });

  it("运行时 admin/ban 命令结果反映到玩家状态", async () => {
    await setupFiles(
      [
        '[2026-11-21 08:59:12] Connecting: PlayerID: 76561198296194775 Name: 昼白 Character: ACE',
        '[2026-11-21 09:02:00] Successfully admined 76561198296194775!',
        '[2026-11-21 09:03:00] Successfully banned 76561198296194775!',
      ].join("\n"),
    );
    const { service } = makeDeps();

    const result = await service.getPlayers("S1" as never);

    expect(result.players[0]?.isAdmin).toBe(true);
    expect(result.players[0]?.isBanned).toBe(true);
  });

  it("服务端停止时返回空列表与 live=false", async () => {
    await setupFiles("");
    const { service, serverManager } = makeDeps();
    serverManager.getState.mockReturnValue("STOPPED");

    const result = await service.getPlayers("S1" as never);

    expect(result.live).toBe(false);
    expect(result.players).toEqual([]);
  });
});

describe("PlayerService 管理命令", () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await setupFiles("");
  });

  it("下发踢出命令到 PTY", async () => {
    const { service, pty } = makeDeps();
    const result = await service.act("S1" as never, {
      steamId: "76561198296194775",
      action: "kick",
    });
    expect(result.ok).toBe(true);
    expect(pty.write).toHaveBeenCalledWith(
      "S1",
      "kick 76561198296194775\n",
    );
  });

  it("封禁命令包含时长与原因", async () => {
    const { service, pty } = makeDeps();
    await service.act("S1" as never, {
      steamId: "76561198296194775",
      action: "ban",
      durationMinutes: 60,
      reason: "作弊",
    });
    expect(pty.write).toHaveBeenCalledWith(
      "S1",
      "ban 76561198296194775 60 作弊\n",
    );
  });

  it("服务端未运行时拒绝操作", async () => {
    const { service, serverManager } = makeDeps();
    serverManager.getState.mockReturnValue("STOPPED");
    await expect(
      service.act("S1" as never, {
        steamId: "76561198296194775",
        action: "kick",
      }),
    ).rejects.toThrow("服务端未运行");
  });
});
