import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { pino } from "pino";
import { SessionManager } from "../src/modules/sessions/SessionManager.js";
import type { ServerId } from "@unturned-manager/shared";

const silentLogger = pino({ level: "silent" });

/** 创建临时测试目录（每个 test 隔离）。 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "session-manager-test-"));
}

describe("SessionManager (1:1 GSM3 TerminalSessionManager)", () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new SessionManager(silentLogger, tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function makeSession(id: string, overrides: Partial<Parameters<SessionManager["saveSession"]>[0]> = {}) {
    return {
      id: id as ServerId,
      name: `终端 - ${id}`,
      workingDirectory: "/opt/unturned",
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      isActive: true,
      ...overrides,
    };
  }

  describe("initialize", () => {
    it("首次运行：目录不存在时建空配置", async () => {
      const freshDir = await createTempDir();
      const fresh = new SessionManager(silentLogger, freshDir);
      await expect(fresh.initialize()).resolves.not.toThrow();

      const sessions = fresh.getSavedSessions();
      expect(sessions).toEqual([]);
      await fs.rm(freshDir, { recursive: true, force: true });
    });

    it("JSON 文件损坏：向上抛（GSM3 同款，TerminalSessionManager.ts:81-96）", async () => {
      const corruptDir = await createTempDir();
      await fs.writeFile(
        path.join(corruptDir, "terminal-sessions.json"),
        "{not valid json",
        "utf-8",
      );
      const corrupt = new SessionManager(silentLogger, corruptDir);
      await expect(corrupt.initialize()).rejects.toThrow();
      await fs.rm(corruptDir, { recursive: true, force: true });
    });
  });

  describe("saveSession + getSavedSessions", () => {
    it("新增 + 查询", async () => {
      await manager.saveSession(makeSession("alpha"));
      expect(manager.getSavedSessions()).toHaveLength(1);
      expect(manager.getSession("alpha" as ServerId)?.name).toBe("终端 - alpha");
    });

    it("同 id 二次保存覆盖（GSM3 同款 TerminalSessionManager.ts:152-154）", async () => {
      await manager.saveSession(makeSession("alpha", { name: "旧名" }));
      await manager.saveSession(makeSession("alpha", { name: "新名" }));
      expect(manager.getSavedSessions()).toHaveLength(1);
      expect(manager.getSession("alpha" as ServerId)?.name).toBe("新名");
    });

    it("多个独立会话并存", async () => {
      await manager.saveSession(makeSession("alpha"));
      await manager.saveSession(makeSession("beta"));
      await manager.saveSession(makeSession("gamma"));
      expect(manager.getSavedSessions()).toHaveLength(3);
    });
  });

  describe("setSessionActive", () => {
    it("切换 isActive 标记 + 刷新 lastActivity", async () => {
      await manager.saveSession(makeSession("alpha", { isActive: true }));
      const before = manager.getSession("alpha" as ServerId)!.lastActivity;

      // 等 10 毫秒确保 lastActivity 时间戳变化
      await new Promise((r) => setTimeout(r, 10));
      await manager.setSessionActive("alpha" as ServerId, false);

      const after = manager.getSession("alpha" as ServerId)!;
      expect(after.isActive).toBe(false);
      expect(after.lastActivity).not.toBe(before);
    });

    it("不存在 id 静默忽略（GSM3 同款 TerminalSessionManager.ts:258-262）", async () => {
      await expect(
        manager.setSessionActive("nonexistent" as ServerId, true),
      ).resolves.not.toThrow();
      expect(manager.getSavedSessions()).toHaveLength(0);
    });
  });

  describe("removeSession", () => {
    it("删除存在的 id", async () => {
      await manager.saveSession(makeSession("alpha"));
      await manager.saveSession(makeSession("beta"));
      await manager.removeSession("alpha" as ServerId);
      expect(manager.getSavedSessions()).toHaveLength(1);
      expect(manager.getSession("alpha" as ServerId)).toBeUndefined();
    });

    it("删除不存在的 id 静默忽略（GSM3 同款 TerminalSessionManager.ts:200-202）", async () => {
      await expect(
        manager.removeSession("nonexistent" as ServerId),
      ).resolves.not.toThrow();
    });
  });

  describe("touchActivity（本地化新增）", () => {
    it("5 秒内重复调用只刷新一次", async () => {
      // 先 wait 让 saveSession 与后续 touchActivity 拉开可识别的时间差
      await manager.saveSession(makeSession("alpha"));
      await new Promise((r) => setTimeout(r, 10));

      // 第一次 touchActivity 刷新一次（基准点）
      await manager.touchActivity("alpha" as ServerId);
      const baseline = manager.getSession("alpha" as ServerId)!.lastActivity;

      // 紧接着三次调用均在 5 秒节流内——lastActivity 不变
      await manager.touchActivity("alpha" as ServerId);
      await manager.touchActivity("alpha" as ServerId);
      await manager.touchActivity("alpha" as ServerId);

      const after = manager.getSession("alpha" as ServerId)!.lastActivity;
      expect(after).toBe(baseline);
    });

    it("不存在 id 静默忽略", async () => {
      await expect(
        manager.touchActivity("nonexistent" as ServerId),
      ).resolves.not.toThrow();
    });
  });

  describe("cleanupExpiredSessions（7 天硬编码）", () => {
    it("删除 7 天以上未活动会话", async () => {
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await manager.saveSession(makeSession("old", { lastActivity: old }));
      await manager.saveSession(makeSession("fresh"));

      const removed = await manager.cleanupExpiredSessions();
      expect(removed).toBe(1);
      expect(manager.getSavedSessions()).toHaveLength(1);
      expect(manager.getSession("alpha" as ServerId)).toBeUndefined();
      expect(manager.getSession("fresh" as ServerId)).toBeDefined();
    });

    it("7 天内全部保留", async () => {
      await manager.saveSession(makeSession("a"));
      await manager.saveSession(makeSession("b"));
      const removed = await manager.cleanupExpiredSessions();
      expect(removed).toBe(0);
      expect(manager.getSavedSessions()).toHaveLength(2);
    });
  });

  describe("并发安全（mutationQueue 串行）", () => {
    it("并发 saveSession 不损坏 JSON 文件", async () => {
      const ids = Array.from({ length: 20 }, (_, i) => `concurrent-${i}`);
      await Promise.all(ids.map((id) => manager.saveSession(makeSession(id))));

      // 重新读文件——能正确解析即说明无损坏
      const data = await fs.readFile(
        path.join(tempDir, "terminal-sessions.json"),
        "utf-8",
      );
      const parsed = JSON.parse(data);
      expect(parsed.sessions).toHaveLength(20);
    });

    it("并发 saveSession + setSessionActive + removeSession 不损坏", async () => {
      await manager.saveSession(makeSession("keep-1"));
      await manager.saveSession(makeSession("keep-2"));

      // 混合操作并发
      await Promise.all([
        manager.saveSession(makeSession("new-1")),
        manager.setSessionActive("keep-1" as ServerId, false),
        manager.removeSession("keep-2" as ServerId),
        manager.saveSession(makeSession("new-2")),
      ]);

      const data = await fs.readFile(
        path.join(tempDir, "terminal-sessions.json"),
        "utf-8",
      );
      const parsed = JSON.parse(data);
      // keep-1 + new-1 + new-2（keep-2 被删）
      expect(parsed.sessions).toHaveLength(3);
    });
  });

  describe("持久化跨实例", () => {
    it("manager A 保存 → manager B 初始化读取到", async () => {
      await manager.saveSession(makeSession("alpha"));
      await manager.saveSession(makeSession("beta"));

      // 新建 manager B 同目录——模拟面板重启
      const managerB = new SessionManager(silentLogger, tempDir);
      await managerB.initialize();

      const sessions = managerB.getSavedSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id).sort()).toEqual(["alpha", "beta"]);
    });
  });
});