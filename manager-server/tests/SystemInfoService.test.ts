import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import {
  SystemInfoService,
  type SystemInfoProviders,
} from "../src/modules/system/SystemInfoService.js";
import type { IServerManager, ServerConfig } from "@unturned-manager/shared";

const silentLogger = pino({ level: "silent" });

function makeServerManager(servers: ServerConfig[]): IServerManager {
  return {
    listServers: async () => servers,
  } as unknown as IServerManager;
}

const defaultProviders: SystemInfoProviders = {
  platform: () => "linux",
  hostname: () => "host-01",
  arch: () => "x64",
  kernel: () => "6.1.0-13-amd64",
  cpu: () => ({
    brand: "Intel(R) Xeon(R) CPU @ 2.60GHz",
    physicalCores: 4,
    cores: 8,
    speed: 2.6,
  }),
  memTotal: () => 16 * 1024 * 1024 * 1024,
  readOsRelease: async () => "",
};

function makeInfo(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: "MyServer",
    name: "My Server",
    gamePort: 27015 as ServerConfig["gamePort"],
    ownerSteamId: "76561198" as ServerConfig["ownerSteamId"],
    installDir: "/opt/unturned",
    ...overrides,
  };
}

describe("SystemInfoService — 正常路径", () => {
  it("无 serverId 时返回完整主机信息，端口字段为空", async () => {
    const svc = new SystemInfoService(
      silentLogger,
      makeServerManager([]),
      defaultProviders,
    );
    const info = await svc.getSystemInfo();

    expect(info.hostname).toBe("host-01");
    expect(info.distro).toBe(""); // 未注入 readOsRelease → Linux fallback 拿不到
    expect(info.arch).toBe("x64");
    expect(info.kernel).toBe("6.1.0-13-amd64");
    expect(info.platform).toBe("linux");
    expect(info.cpu.brand).toBe("Intel(R) Xeon(R) CPU @ 2.60GHz");
    expect(info.cpu.physicalCores).toBe(4);
    expect(info.memTotalMB).toBe(16384);
    expect(info.gamePort).toBeNull();
    expect(info.queryPort).toBeNull();
  });

  it("传入 serverId 时附加该实例的端口（gamePort + gamePort+1）", async () => {
    const servers: ServerConfig[] = [makeInfo()];
    const svc = new SystemInfoService(
      silentLogger,
      makeServerManager(servers),
      defaultProviders,
    );
    const info = await svc.getSystemInfo("MyServer");

    expect(info.gamePort).toBe(27015);
    expect(info.queryPort).toBe(27016);
  });
});

describe("SystemInfoService — Linux os-release fallback", () => {
  it("Linux 容器 distro 为空 → 读 /etc/os-release 的 PRETTY_NAME 与 VERSION_ID", async () => {
    const svc = new SystemInfoService(
      silentLogger,
      makeServerManager([]),
      {
        ...defaultProviders,
        distro: undefined as never, // 旧接口保留兼容（实际未用）
        readOsRelease: async () =>
          'NAME="Debian GNU/Linux"\nVERSION_ID="12"\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n',
      },
    );
    const info = await svc.getSystemInfo();

    expect(info.distro).toBe("Debian GNU/Linux 12 (bookworm)");
    expect(info.release).toBe("12");
  });

  it("非 Linux 平台不读 /etc/os-release", async () => {
    const svc = new SystemInfoService(
      silentLogger,
      makeServerManager([]),
      {
        ...defaultProviders,
        platform: () => "darwin",
        hostname: () => "mac",
        readOsRelease: async () => {
          throw new Error("should not be called on darwin");
        },
      },
    );
    const info = await svc.getSystemInfo();

    expect(info.platform).toBe("darwin");
    expect(info.hostname).toBe("mac");
  });

  it("/etc/os-release 读取失败时 distro/release 为空", async () => {
    const svc = new SystemInfoService(
      silentLogger,
      makeServerManager([]),
      {
        ...defaultProviders,
        readOsRelease: async () => {
          throw new Error("ENOENT");
        },
      },
    );
    const info = await svc.getSystemInfo();

    expect(info.distro).toBe("");
    expect(info.release).toBe("");
  });
});