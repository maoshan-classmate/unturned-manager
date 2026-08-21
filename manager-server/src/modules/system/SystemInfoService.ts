import type { Logger } from "pino";
import os from "node:os";
import { promises as fs } from "node:fs";
import type {
  ISystemInfoService,
  SystemInfo,
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
    // distro 信息靠读 /etc/os-release
    const osRelease = await this.safeLinuxOsRelease(platform);
    const distro = osRelease?.distro ?? "";
    const release = osRelease?.release ?? "";

    const cpu = this.providers.cpu();
    const memTotalMB = Math.round((this.providers.memTotal() / (1024 * 1024)) * 10) / 10;

    let gamePort: number | null = null;
    let queryPort: number | null = null;
    if (serverId) {
      const cfg = await this.findServerConfig(serverId);
      if (cfg) {
        gamePort = cfg.gamePort;
        queryPort = cfg.gamePort + 1;
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
}

// ─── 默认采集实现 ─────────────────────────────────────

function defaultCpu() {
  const cpus = os.cpus();
  const c0 = cpus[0];
  return {
    brand: c0?.model ?? "",
    physicalCores: cpus.length,
    cores: cpus.length,
    speed: (c0?.speed ?? 0) / 1000, // GHz
  };
}