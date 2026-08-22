import type { Logger } from "pino";
import os from "node:os";
import net from "node:net";
import { promises as fs, readFileSync } from "node:fs";
import type {
  ISystemInfoService,
  SystemInfo,
  ServerId,
} from "@unturned-manager/shared";
import type { IServerManager } from "@unturned-manager/shared";

// ─── 测试桩接口 ─────────────────────────────────────────

/** 系统信息采集源——生产使用 Node `os` 模块，单测可注入假数据。 */
export interface SystemInfoProviders {
  /** 平台字符串（os.platform()） */
  platform?: () => string;
  /** 主机名（os.hostname()） */
  hostname?: () => string;
  /** 架构（os.arch()） */
  arch?: () => string;
  /** 内核版本（os.release()） */
  kernel?: () => string;
  /** CPU 信息（os.cpus()[0]） */
  cpu?: () => { brand: string; physicalCores: number; cores: number; speed: number };
  /** 总内存（os.totalmem()） */
  memTotal?: () => number;
  /** /etc/os-release 文件读取器——Linux 容器 fallback */
  readOsRelease?: () => Promise<string>;
}

// ─── 实现 ────────────────────────────────────────────────

/**
 * 主机信息服务——Dashboard 主机信息卡后端支撑。
 *
 * 数据：Node `os` 模块 + Linux `/etc/os-release` fallback。
 * 进程内缓存（构造时读取一次），不采样；主机信息变化慢。
 *
 * 字段读取失败时降级为 null——不抛错，主机信息卡前端显示「未知」。
 */
export class SystemInfoService implements ISystemInfoService {
  private readonly logger: Logger;
  private readonly serverManager: IServerManager;
  private readonly providers: Required<SystemInfoProviders>;
  private cache: SystemInfo | null = null;

  constructor(
    logger: Logger,
    serverManager: IServerManager,
    providers: SystemInfoProviders = {},
  ) {
    this.logger = logger;
    this.serverManager = serverManager;
    this.providers = {
      platform: providers.platform ?? (() => os.platform()),
      hostname: providers.hostname ?? (() => os.hostname()),
      arch: providers.arch ?? (() => os.arch()),
      kernel: providers.kernel ?? (() => os.release()),
      cpu: providers.cpu ?? defaultCpu,
      memTotal: providers.memTotal ?? (() => os.totalmem()),
      readOsRelease: providers.readOsRelease ?? (() => fs.readFile("/etc/os-release", "utf8").catch(() => "")),
    };
  }

  async getSystemInfo(serverId?: string): Promise<SystemInfo> {
    if (this.cache === null || serverId !== undefined) {
      return await this.collect(serverId);
    }
    return this.cache;
  }

  clearCache(): void {
    this.cache = null;
  }

  // ─── 私有 ──────────────────────────────────────────────

  private async collect(serverId?: string): Promise<SystemInfo> {
    const platform = this.providers.platform();
    const hostname = this.providers.hostname();
    const arch = this.providers.arch();
    const kernel = this.providers.kernel();

    // Linux 容器 os.release() 通常空 / os.platform() 只能给"linux"——
    // distro 信息靠读 /etc/os-release；非 Linux 平台走友好名兜底。
    const osRelease = await this.safeLinuxOsRelease(platform);

    const cpu = this.providers.cpu();
    const memTotalMB = Math.round((this.providers.memTotal() / (1024 * 1024)) * 10) / 10;

    // 非 Linux 平台兜底：把 kernel 推断成友好的产品名，避免操作系统字段与内核字段重复。
    // Windows 内核版本号即 Windows build 号（"10.0.26200"）——映射到「Windows 11 / 10」。
    let distro = osRelease?.distro ?? "";
    let release = osRelease?.release ?? "";
    if (!distro) {
      const friendly = this.friendlyDistro(platform, kernel);
      distro = friendly.distro;
      release = friendly.release;
    }

    let gamePort: number | null = null;
    let queryPort: number | null = null;
    if (serverId) {
      const cfg = await this.findServerConfig(serverId);
      if (cfg) {
        // 实时探测：仅实例 RUNNING 时返回当前监听端口；
        // STOPPED / 端口未监听 / 探测失败均返回 null——避免显示陈旧配置。
        const state = await this.serverManager.getState(serverId as ServerId);
        if (state === "RUNNING") {
          const live = await this.probeListeningPort(cfg.gamePort);
          if (live !== null) {
            gamePort = live;
            queryPort = live + 1;
          }
        }
      }
    }

    const info: SystemInfo = {
      hostname,
      distro,
      release,
      arch,
      kernel,
      platform,
      cpu,
      memTotalMB,
      diskTotalBytes: null,
      diskUsedBytes: null,
      gamePort,
      queryPort,
    };

    if (serverId === undefined) {
      this.cache = info;
    }
    return info;
  }

  /**
   * Linux 容器 fallback——读 /etc/os-release 拿 PRETTY_NAME 与 VERSION_ID。
   * 非 Linux 平台或读取失败时返回 null。
   */
  private async safeLinuxOsRelease(
    platform: string,
  ): Promise<{ distro: string; release: string } | null> {
    if (platform !== "linux") return null;
    try {
      const content = await this.providers.readOsRelease();
      if (!content) return null;
      const pretty = content.match(/^PRETTY_NAME="?([^"\n]+)"?\s*$/m);
      const versionId = content.match(/^VERSION_ID="?([^"\n]+)"?\s*$/m);
      if (!pretty && !versionId) return null;
      return {
        distro: pretty?.[1] ?? "",
        release: versionId?.[1] ?? "",
      };
    } catch (err) {
      this.logger.warn({ err }, "/etc/os-release 读取失败");
      return null;
    }
  }

  private async findServerConfig(
    serverId: string,
  ): Promise<{ gamePort: number } | null> {
    try {
      const servers = await this.serverManager.listServers();
      return servers.find((s) => s.id === serverId) ?? null;
    } catch (err) {
      this.logger.warn({ err, serverId }, "读取实例列表失败");
      return null;
    }
  }

  /**
   * TCP 探活——确认目标端口是否被实际监听。
   * 2 秒超时；成功返回端口号，失败（含超时 / 连接拒绝 / 主机不可达）返回 null。
   * 仅 127.0.0.1——容器内的 U3DS 监听 loopback。
   */
  private async probeListeningPort(port: number): Promise<number | null> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const done = (p: number | null) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(p);
      };
      socket.setTimeout(2000);
      socket.once("connect", () => done(port));
      socket.once("timeout", () => done(null));
      socket.once("error", () => done(null));
      socket.connect(port, "127.0.0.1");
    });
  }

  /**
   * 非 Linux 平台的产品名兜底——避免前端把 kernel 字段同时塞进「操作系统」和「内核」两行造成重复。
   * Windows 上 `os.release()` 返回 "10.0.{build}"，build 号决定 Win10 / Win11：
   *   - ≥ 22000 → Windows 11
   *   - ≥ 10240 → Windows 10
   * 未知平台回退到原始 platform 字符串。
   */
  private friendlyDistro(
    platform: string,
    kernel: string,
  ): { distro: string; release: string } {
    if (platform === "win32") {
      const buildMatch = kernel.match(/\.(\d+)$/);
      const build = buildMatch ? parseInt(buildMatch[1] ?? "0", 10) : 0;
      const winVersion = build >= 22000 ? "Windows 11" : build >= 10240 ? "Windows 10" : "Windows";
      return { distro: winVersion, release: kernel };
    }
    if (platform === "darwin") return { distro: "macOS", release: kernel };
    if (platform === "freebsd") return { distro: "FreeBSD", release: kernel };
    return { distro: platform, release: kernel };
  }
}

// ─── 默认采集实现 ─────────────────────────────────────

function defaultCpu() {
  // Linux 容器内 `os.cpus()[0].model` 常为空字符串（cgroups 屏蔽底层硬件信息），
  // 改读 `/proc/cpuinfo` 拿 model name；非 Linux 平台或读失败回落原逻辑。
  if (process.platform === "linux") {
    try {
      const text = readFileSync("/proc/cpuinfo", "utf8");
      const m = text.match(/model name\s*:\s*(.+)/);
      if (m && m[1]) {
        const cpus = os.cpus();
        const c0 = cpus[0];
        return {
          brand: m[1].trim(),
          physicalCores: cpus.length,
          cores: cpus.length,
          speed: (c0?.speed ?? 0) / 1000, // GHz
        };
      }
    } catch {
      /* /proc/cpuinfo 不可读——fall through 到 os.cpus() */
    }
  }
  const cpus = os.cpus();
  const c0 = cpus[0];
  return {
    brand: c0?.model ?? "",
    physicalCores: cpus.length,
    cores: cpus.length,
    speed: (c0?.speed ?? 0) / 1000, // GHz
  };
}