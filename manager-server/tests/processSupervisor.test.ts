import { describe, it, expect } from "vitest";
import {
  ProcessSupervisor,
  type TerminateTimings,
} from "../src/modules/process/ProcessSupervisor.js";
import type { ServerId } from "@unturned-manager/shared";

// 长驻 node 子进程：忽略 SIGINT/SIGTERM（触发三段关停必须走到 SIGKILL）
const IGNORE_SIGNAL_SCRIPT = `process.on('SIGINT',()=>{}); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`;
// 长驻但响应默认信号（node 收到 SIGINT 默认退出）
const LONG_RUNNING_SCRIPT = `setInterval(()=>{},1000);`;
// 短暂自退（50ms）
const SHORT_LIVED_SCRIPT = `setTimeout(()=>{},50);`;

// 测试注入短时长——避免真实等待 2s+2s+1s
const FAST: TerminateTimings = {
  sigint: 10,
  sigterm: 10,
  sigkill: 10,
  taskkill: 10,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ProcessSupervisor — T6 进程生命周期（GSM 对齐）", () => {
  it("spawn: 返回 PID + 进程组登记（isRunning true）", async () => {
    const sup = new ProcessSupervisor();
    const pid = await sup.spawn("S1" as ServerId, process.execPath, [
      "-e",
      LONG_RUNNING_SCRIPT,
    ]);
    expect(pid).toBeGreaterThan(0);
    expect(sup.isRunning("S1" as ServerId)).toBe(true);
    await sup.gracefulShutdown("S1" as ServerId);
  });

  it("gracefulShutdown: SIGINT/SIGTERM 被忽略 → 三段走到 SIGKILL 强制退出", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S2" as ServerId, process.execPath, [
      "-e",
      IGNORE_SIGNAL_SCRIPT,
    ]);
    await sup.gracefulShutdown("S2" as ServerId);
    expect(sup.isRunning("S2" as ServerId)).toBe(false);
  });

  it("gracefulShutdown: 正常响应 SIGINT → 第一段即退出（无需 SIGKILL）", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S3" as ServerId, process.execPath, [
      "-e",
      LONG_RUNNING_SCRIPT,
    ]);
    await sup.gracefulShutdown("S3" as ServerId);
    expect(sup.isRunning("S3" as ServerId)).toBe(false);
  });

  it("forceKill: 跳过优雅段直接 SIGKILL", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S4" as ServerId, process.execPath, [
      "-e",
      IGNORE_SIGNAL_SCRIPT,
    ]);
    sup.forceKill("S4" as ServerId);
    await sleep(100); // forceKill 异步删除 map
    expect(sup.isRunning("S4" as ServerId)).toBe(false);
  });

  it("waitForExit: 进程自行退出 → resolve", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S5" as ServerId, process.execPath, [
      "-e",
      SHORT_LIVED_SCRIPT,
    ]);
    await sup.waitForExit("S5" as ServerId, 2_000);
    expect(sup.isRunning("S5" as ServerId)).toBe(false);
  });

  it("waitForExit: 进程退出返回退出码（0=成功）", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S5b" as ServerId, process.execPath, [
      "-e",
      SHORT_LIVED_SCRIPT,
    ]);
    const code = await sup.waitForExit("S5b" as ServerId, 2_000);
    expect(code).toBe(0);
  });

  it("waitForExit: 进程不存在 → null", async () => {
    const sup = new ProcessSupervisor(FAST);
    const code = await sup.waitForExit("NONEXISTENT" as ServerId, 100);
    expect(code).toBeNull();
  });

  it("waitForExit: 超时 → reject", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S6" as ServerId, process.execPath, [
      "-e",
      LONG_RUNNING_SCRIPT,
    ]);
    await expect(sup.waitForExit("S6" as ServerId, 50)).rejects.toThrow(/超时/);
    sup.forceKill("S6" as ServerId);
    await sleep(100);
  });

  it("destroy: 杀死所有子进程", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S7" as ServerId, process.execPath, [
      "-e",
      LONG_RUNNING_SCRIPT,
    ]);
    await sup.spawn("S8" as ServerId, process.execPath, [
      "-e",
      LONG_RUNNING_SCRIPT,
    ]);
    await sup.destroy();
    await sleep(100);
    expect(sup.isRunning("S7" as ServerId)).toBe(false);
    expect(sup.isRunning("S8" as ServerId)).toBe(false);
  });

  it("spawn 重复 serverId → 拒绝", async () => {
    const sup = new ProcessSupervisor(FAST);
    await sup.spawn("S9" as ServerId, process.execPath, [
      "-e",
      LONG_RUNNING_SCRIPT,
    ]);
    await expect(
      sup.spawn("S9" as ServerId, process.execPath, [
        "-e",
        LONG_RUNNING_SCRIPT,
      ]),
    ).rejects.toThrow(/已有进程/);
    await sup.gracefulShutdown("S9" as ServerId);
  });
});
