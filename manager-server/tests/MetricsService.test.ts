import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import { MetricsService } from "../src/modules/metrics/MetricsService.js";
import type { MetricsSample } from "@unturned-manager/shared";

// 测试用 logger——沉默输出避免污染测试日志
const silentLogger = pino({ level: "silent" });

/**
 * 注入样本到环形缓冲（绕开 private）——仅测试用。
 * 生产代码不会调此方法。
 */
function injectSamples(service: MetricsService, samples: MetricsSample[]): void {
  const internal = service as unknown as { samples: MetricsSample[] };
  internal.samples.push(...samples);
}

describe("MetricsService — getMetrics 时间窗过滤", () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(silentLogger, 5_000);
  });

  afterEach(() => {
    service.stop();
  });

  it("1m 窗口仅保留 60 秒内样本", async () => {
    const now = Date.now();
    injectSamples(service, [
      { timestamp: now - 90_000, cpuPercent: 10, memUsedMB: 100 }, // 90s 前，超出 1m
      { timestamp: now - 30_000, cpuPercent: 20, memUsedMB: 200 }, // 30s 前，在 1m 内
      { timestamp: now, cpuPercent: 30, memUsedMB: 300 }, // 当前
    ]);

    const result = await service.getMetrics("MyServer", "1m");
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]?.cpuPercent).toBe(20);
    expect(result.samples[1]?.cpuPercent).toBe(30);
    expect(result.window).toBe("1m");
  });

  it("5m 窗口保留 60-300 秒样本", async () => {
    const now = Date.now();
    injectSamples(service, [
      { timestamp: now - 400_000, cpuPercent: 5, memUsedMB: 50 }, // 400s 前，超出 5m
      { timestamp: now - 200_000, cpuPercent: 15, memUsedMB: 150 }, // 200s 前，在 5m 内
    ]);

    const result = await service.getMetrics("MyServer", "5m");
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]?.cpuPercent).toBe(15);
  });

  it("15m 窗口保留 900 秒内全部样本", async () => {
    const now = Date.now();
    injectSamples(service, [
      { timestamp: now - 800_000, cpuPercent: 1, memUsedMB: 10 },
      { timestamp: now - 400_000, cpuPercent: 2, memUsedMB: 20 },
      { timestamp: now - 100_000, cpuPercent: 3, memUsedMB: 30 },
    ]);

    const result = await service.getMetrics("MyServer", "15m");
    expect(result.samples).toHaveLength(3);
  });
});

describe("MetricsService — 响应结构", () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(silentLogger);
  });

  afterEach(() => {
    service.stop();
  });

  it("serverId 透传回响应", async () => {
    const result = await service.getMetrics("MyServer", "5m");
    expect(result.serverId).toBe("MyServer");
  });

  it("window 透传回响应", async () => {
    const r1m = await service.getMetrics("S1", "1m");
    const r5m = await service.getMetrics("S2", "5m");
    const r15m = await service.getMetrics("S3", "15m");
    expect(r1m.window).toBe("1m");
    expect(r5m.window).toBe("5m");
    expect(r15m.window).toBe("15m");
  });

  it("current.cpuPercent 取最近样本", async () => {
    const now = Date.now();
    injectSamples(service, [
      { timestamp: now - 10_000, cpuPercent: 40, memUsedMB: 100 },
      { timestamp: now, cpuPercent: 60, memUsedMB: 200 },
    ]);
    const result = await service.getMetrics("S", "5m");
    expect(result.current.cpuPercent).toBe(60);
    expect(result.current.memUsedMB).toBe(200);
  });

  it("无样本时 current 字段为 0，samples 为空数组", async () => {
    const result = await service.getMetrics("S", "5m");
    expect(result.samples).toHaveLength(0);
    expect(result.current.cpuPercent).toBe(0);
    expect(result.current.memUsedMB).toBe(0);
    expect(result.current.memTotalMB).toBe(0);
  });
});

describe("MetricsService — start/stop 幂等", () => {
  let service: MetricsService;

  afterEach(() => {
    service?.stop();
  });

  it("重复 start 不报错，不创建第二个定时器", () => {
    service = new MetricsService(silentLogger, 60_000);
    service.start();
    service.start(); // 二次调用应幂等
    const internal = service as unknown as { timer: NodeJS.Timeout | null };
    expect(internal.timer).not.toBeNull();
    service.stop();
    expect(internal.timer).toBeNull();
  });

  it("未 start 时 stop 不报错", () => {
    service = new MetricsService(silentLogger);
    expect(() => service.stop()).not.toThrow();
  });

  it("stop 后再次 stop 不报错", () => {
    service = new MetricsService(silentLogger, 60_000);
    service.start();
    service.stop();
    expect(() => service.stop()).not.toThrow();
  });
});

describe("MetricsService — 自定义采样间隔", () => {
  it("构造器接收自定义 intervalMs（不实际等待，验证可实例化）", () => {
    const s = new MetricsService(silentLogger, 1_000);
    expect(s).toBeInstanceOf(MetricsService);
    s.stop();
  });
});