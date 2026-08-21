import { describe, it, expect as _expect, beforeEach, afterEach, vi } from "vitest";
import pino from "pino";
import { MetricsService, type MetricsProviders } from "../src/modules/metrics/MetricsService.js";
import type { MetricsSample } from "@unturned-manager/shared";

// 测试用 logger——沉默输出避免污染测试日志
const silentLogger = pino({ level: "silent" });

/**
 * 注入样本到环形缓冲（绕开 private）——仅测试用。
 */
function injectSamples(service: MetricsService, samples: MetricsSample[]): void {
  const internal = service as unknown as { samples: MetricsSample[] };
  internal.samples.push(...samples);
}

/**
 * 默认 provider 桩——固定内存 + 空磁盘/网络
 */
function defaultProviders(overrides: Partial<MetricsProviders> = {}): MetricsProviders {
  return {
    totalMemBytes: () => 16 * 1024 * 1024 * 1024,
    freeMemBytes: () => 8 * 1024 * 1024 * 1024,
    cpuTimes: () => [
      { total: 1000, idle: 700 },
      { total: 1000, idle: 700 },
    ],
    disks: async () => [],
    netBytes: async () => [0, 0],
    ...overrides,
  };
}

describe("MetricsService — getMetrics 时间窗过滤", () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(silentLogger, 5_000, defaultProviders());
  });

  afterEach(() => {
    service.stop();
  });

  it("1m 窗口仅保留 60 秒内样本", async () => {
    const now = Date.now();
    injectSamples(service, [
      { timestamp: now - 90_000, cpuPercent: 10, memUsedMB: 100 },
      { timestamp: now - 30_000, cpuPercent: 20, memUsedMB: 200 },
      { timestamp: now, cpuPercent: 30, memUsedMB: 300 },
    ]);
    const result = await service.getMetrics("MyServer", "1m");
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]?.cpuPercent).toBe(20);
    expect(result.window).toBe("1m");
  });
});

describe("MetricsService — start/stop 幂等", () => {
  afterEach(() => {
    service?.stop();
  });
  let service: MetricsService;

  it("重复 start 不报错", () => {
    service = new MetricsService(silentLogger, 60_000, defaultProviders());
    service.start();
    service.start();
    service.stop();
  });

  it("stop 后再次 stop 不报错", () => {
    service = new MetricsService(silentLogger, 60_000, defaultProviders());
    service.start();
    service.stop();
    expect(() => service.stop()).not.toThrow();
  });
});

describe("MetricsService — 磁盘采样", () => {
  it("首次采样后 diskUsedBytes / diskTotalBytes 反映 disks() 结果", async () => {
    const disks = vi.fn(async () => [
      { size: 1_000_000_000, used: 400_000_000 },
    ]);
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      disks,
    }));
    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();

    expect(disks).toHaveBeenCalled();
    const result = await service.getMetrics("S", "5m");
    expect(result.current.diskUsedBytes).toBe(400_000_000);
    expect(result.current.diskTotalBytes).toBe(1_000_000_000);
  });

  it("disks() 返回空数组时磁盘字段保持 null", async () => {
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      disks: async () => [],
    }));
    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();
    const result = await service.getMetrics("S", "5m");
    expect(result.current.diskUsedBytes).toBeNull();
    expect(result.current.diskTotalBytes).toBeNull();
  });

  it("磁盘只采一次——多次 collect 不重复调用 disks", async () => {
    const disks = vi.fn(async () => [
      { size: 1_000_000_000, used: 400_000_000 },
    ]);
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      disks,
    }));
    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();
    const internal = service as unknown as { collect: () => Promise<void> };
    await internal.collect();
    await internal.collect();
    expect(disks).toHaveBeenCalledTimes(1);
  });
});

describe("MetricsService — 网络速率", () => {
  it("首次采样：速率字段为 null，字节数为累计值",
  async () => {
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      netBytes: async () => [3000, 2000],
    }));
    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();

    const result = await service.getMetrics("S", "5m");
    expect(result.current.networkRxBytes).toBe(3000);
    expect(result.current.networkTxBytes).toBe(2000);
    expect(result.current.networkRxRateBps).toBeNull();
    expect(result.current.networkTxRateBps).toBeNull();
  });

  it("第二次采样：速率 = (字节增量) / 间隔秒数", async () => {
    let callCount = 0;
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      netBytes: async () => {
        callCount++;
        return callCount === 1 ? [1000, 500] : [6000, 500];
      },
    }));
    const internal = service as unknown as { collect: () => Promise<void> };
    const baseTime = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseTime);
    await internal.collect();
    nowSpy.mockReturnValue(baseTime + 5_000);
    await internal.collect();
    nowSpy.mockRestore();

    const result = await service.getMetrics("S", "5m");
    expect(result.current.networkRxRateBps).toBe(1000);
  });

  it("网卡字节数下降时速率钳位为 0，不输出负数", async () => {
    let callCount = 0;
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      netBytes: async () => {
        callCount++;
        return callCount === 1 ? [5000, 5000] : [100, 100];
      },
    }));
    const internal = service as unknown as { collect: () => Promise<void> };
    const baseTime = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseTime);
    await internal.collect();
    nowSpy.mockReturnValue(baseTime + 5_000);
    await internal.collect();
    nowSpy.mockRestore();

    const result = await service.getMetrics("S", "5m");
    expect(result.current.networkRxRateBps).toBe(0);
  });
});

describe("MetricsService — 内存计算", () => {
  it("memUsedMB = totalMemBytes - freeMemBytes", async () => {
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      totalMemBytes: () => 16 * 1024 * 1024 * 1024,
      freeMemBytes: () => 8 * 1024 * 1024 * 1024,
    }));
    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();

    const result = await service.getMetrics("S", "5m");
    expect(result.current.memUsedMB).toBe(8192);
    expect(result.current.memTotalMB).toBe(16384);
  });
});

describe("MetricsService — 采样失败降级", () => {
  it("disks() 抛错时 collect 不抛错，samples 仍可写入", async () => {
    const service = new MetricsService(silentLogger, 60_000, defaultProviders({
      disks: async () => {
        throw new Error("disks failed");
      },
      netBytes: async () => {
        throw new Error("netBytes failed");
      },
    }));
    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();

    const result = await service.getMetrics("S", "5m");
    expect(result.samples).toHaveLength(0);
  });
});