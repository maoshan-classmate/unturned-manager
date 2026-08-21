import type { Logger } from "pino";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import type {
  IMetricsService,
  MetricsSample,
  MetricsCurrent,
  MetricsResponse,
} from "@unturned-manager/shared";

const execFileAsync = promisify(execFile);

// ─── 常量 ────────────────────────────────────────────────

/** 默认采样间隔（ms）——5s 一次 */
const DEFAULT_INTERVAL_MS = 5_000;

/** 环形缓冲最大样本数 */
const MAX_SAMPLES = 200;

/** CPU 两次差值采样的最小间隔（ms） */
const CPU_DELTA_INTERVAL_MS = 100;

/** 时间窗映射 */
const WINDOW_MS: Readonly<Record<"1m" | "5m" | "15m", number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

/** 测试桩——构造注入采集源 */
export interface MetricsProviders {
  /** 拿总内存字节数 */
  totalMemBytes?: () => number;
  /** 拿空闲内存字节数 */
  freeMemBytes?: () => number;
  /** 拿 CPU 时间片快照——返回 [{total, idle}] */
  cpuTimes?: () => Array<{ total: number; idle: number }>;
  /** 拿磁盘快照——返回 [{ size, used }, ...] */
  disks?: () => Promise<Array<{ size: number; used: number }>>;
  /** 拿网络累计字节数——返回 [rx, tx] */
  netBytes?: () => Promise<[number, number]>;
}

// ─── 实现 ────────────────────────────────────────────────

/**
 * 系统指标采集器——单进程全局一份。
 *
 * 数据：CPU + 内存 + 磁盘（一次性快照）+ 网络（全网卡累计字节数 + 差值速率）。
 * 采集失败不抛错，仅 warn 日志——指标丢失不该影响主链路。
 *
 * CPU 用两次差值（间隔 100ms），内存用 Node `os` 模块——比 systeminformation
 * 在容器环境下更准（currentLoad 首次返回 0、mem.used 包含 buffcache
 * 高估真实使用率）。
 */
export class MetricsService implements IMetricsService {
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly providers: Required<MetricsProviders>;
  private readonly samples: MetricsSample[] = [];
  private lastMemTotalMB: number = 0;
  private lastCpuPercent: number = 0;
  private diskUsedBytes: number | null = null;
  private diskTotalBytes: number | null = null;
  private lastRxBytes: number | null = null;
  private lastTxBytes: number | null = null;
  private lastNetSampleAtMs: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    logger: Logger,
    intervalMs: number = DEFAULT_INTERVAL_MS,
    providers: MetricsProviders = {},
  ) {
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.providers = {
      totalMemBytes: providers.totalMemBytes ?? (() => os.totalmem()),
      freeMemBytes: providers.freeMemBytes ?? (() => os.freemem()),
      cpuTimes: providers.cpuTimes ?? defaultCpuTimes,
      disks: providers.disks ?? defaultDisks,
      netBytes: providers.netBytes ?? defaultNetBytes,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.collect();
    this.timer = setInterval(() => {
      void this.collect();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  async getMetrics(serverId: string, window: "1m" | "5m" | "15m"): Promise<MetricsResponse> {
    const windowMs = WINDOW_MS[window] ?? WINDOW_MS["5m"];
    const cutoff = Date.now() - windowMs;
    const filtered = this.samples.filter((s) => s.timestamp >= cutoff);

    const last = this.samples[this.samples.length - 1];
    const current: MetricsCurrent = {
      cpuPercent: last?.cpuPercent ?? this.lastCpuPercent,
      memUsedMB: last?.memUsedMB ?? 0,
      memTotalMB: this.lastMemTotalMB,
      diskUsedBytes: this.diskUsedBytes,
      diskTotalBytes: this.diskTotalBytes,
      networkRxBytes: last?.networkRxBytes ?? null,
      networkTxBytes: last?.networkTxBytes ?? null,
      networkRxRateBps: last?.networkRxRateBps ?? null,
      networkTxRateBps: last?.networkTxRateBps ?? null,
    };

    return {
      serverId,
      window,
      samples: filtered,
      current,
    };
  }

  // ─── 私有 ──────────────────────────────────────────────

  private async collect(): Promise<void> {
    try {
      const [cpuPercent, memUsedMB, memTotalMB, disks, [rxBytes, txBytes]] =
        await Promise.all([
          this.sampleCpu(),
          Promise.resolve(this.computeMemUsedMB()),
          Promise.resolve(this.computeMemTotalMB()),
          this.diskUsedBytes === null
            ? this.providers.disks()
            : Promise.resolve([]),
          this.providers.netBytes(),
        ]);

      this.lastCpuPercent = cpuPercent;
      this.lastMemTotalMB = memTotalMB;

      if (this.diskUsedBytes === null && disks.length > 0) {
        const primary = disks[0];
        if (primary) {
          this.diskUsedBytes = primary.used;
          this.diskTotalBytes = primary.size;
        }
      }

      const now = Date.now();
      let networkRxRateBps: number | null = null;
      let networkTxRateBps: number | null = null;
      if (this.lastNetSampleAtMs !== null && this.lastRxBytes !== null) {
        const dtSec = (now - this.lastNetSampleAtMs) / 1000;
        if (dtSec > 0) {
          networkRxRateBps = Math.max(0, (rxBytes - this.lastRxBytes) / dtSec);
          networkTxRateBps = Math.max(0, (txBytes - (this.lastTxBytes ?? 0)) / dtSec);
        }
      }
      this.lastRxBytes = rxBytes;
      this.lastTxBytes = txBytes;
      this.lastNetSampleAtMs = now;

      this.samples.push({
        timestamp: now,
        cpuPercent,
        memUsedMB,
        networkRxBytes: rxBytes,
        networkTxBytes: txBytes,
        networkRxRateBps,
        networkTxRateBps,
      });
      if (this.samples.length > MAX_SAMPLES) {
        this.samples.splice(0, this.samples.length - MAX_SAMPLES);
      }
    } catch (err) {
      this.logger.warn({ err }, "指标采样失败");
    }
  }

  /** CPU 使用率——两次差值（间隔 100ms） */
  private async sampleCpu(): Promise<number> {
    const start = this.providers.cpuTimes();
    await new Promise((r) => setTimeout(r, CPU_DELTA_INTERVAL_MS));
    const end = this.providers.cpuTimes();

    let totalUsage = 0;
    const coreCount = Math.max(start.length, end.length, 1);
    for (let i = 0; i < coreCount; i++) {
      const s = start[i];
      const e = end[i];
      if (!s || !e) continue;
      const totalDiff = e.total - s.total;
      const idleDiff = e.idle - s.idle;
      const usage = totalDiff > 0 ? 100 - (100 * idleDiff / totalDiff) : 0;
      totalUsage += usage;
    }
    return Math.round((totalUsage / coreCount) * 10) / 10;
  }

  private computeMemUsedMB(): number {
    const used = this.providers.totalMemBytes() - this.providers.freeMemBytes();
    return Math.round((used / (1024 * 1024)) * 10) / 10;
  }

  private computeMemTotalMB(): number {
    return Math.round((this.providers.totalMemBytes() / (1024 * 1024)) * 10) / 10;
  }
}

// ─── 默认采集实现（Node os 模块 + Linux 命令）────────────────

function defaultCpuTimes(): Array<{ total: number; idle: number }> {
  return os.cpus().map((cpu) => {
    const total = Object.values(cpu.times).reduce((s, t) => s + t, 0);
    const idle = cpu.times.idle;
    return { total, idle };
  });
}

/** Linux 磁盘——`df -B1 /` 解析；非 Linux 落 fs.statfs 兜底 */
async function defaultDisks(): Promise<Array<{ size: number; used: number }>> {
  if (process.platform === "linux") {
    try {
      const { stdout } = await execFileAsync("df", ["-B1", "/"], {
        timeout: 3000,
      });
      const lines = stdout.trim().split("\n");
      const data = lines[1];
      if (data) {
        const cols = data.split(/\s+/);
        const size = Number(cols[1]);
        const used = Number(cols[2]);
        if (Number.isFinite(size) && Number.isFinite(used) && size > 0) {
          return [{ size, used }];
        }
      }
    } catch {
      /* fall through to statfs */
    }
  }
  try {
    const stats = await fs.statfs("/");
    const size = Number(stats.blocks) * Number(stats.bsize);
    const used = (Number(stats.blocks) - Number(stats.bfree)) * Number(stats.bsize);
    return [{ size, used }];
  } catch {
    return [];
  }
}

/**
 * 全网卡累计字节数——Linux 读 `/proc/net/dev` 聚合；其他平台返回 [0, 0]。
 * @returns [rxBytes, txBytes] 累计字节数
 */
async function defaultNetBytes(): Promise<[number, number]> {
  if (process.platform !== "linux") return [0, 0];
  try {
    const text = await fs.readFile("/proc/net/dev", "utf8");
    const lines = text.split("\n");
    let rx = 0;
    let tx = 0;
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx < 0) continue;
      const iface = line.slice(0, colonIdx).trim();
      if (iface === "lo") continue;
      const cols = line.slice(colonIdx + 1).trim().split(/\s+/);
      const ifaceRx = Number(cols[0]);
      const ifaceTx = Number(cols[8]);
      if (Number.isFinite(ifaceRx) && Number.isFinite(ifaceTx)) {
        rx += ifaceRx;
        tx += ifaceTx;
      }
    }
    return [rx, tx];
  } catch {
    return [0, 0];
  }
}