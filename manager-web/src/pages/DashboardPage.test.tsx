import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage.js";
import type { ServerInfo } from "../contexts/ServersContext.js";
import type { SystemInfo } from "@unturned-manager/shared";

// ─── Mocks ───
vi.mock("../hooks/useServer.js", () => ({
  useServer: vi.fn(),
}));
vi.mock("../api/client.js", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));
vi.mock("../contexts/WebSocketContext.js", () => ({
  useWebSocket: () => ({
    subscribe: () => () => {},
    send: vi.fn(),
    request: vi.fn(),
    connected: true,
  }),
}));

import { useServer } from "../hooks/useServer.js";
import { apiClient } from "../api/client.js";
const mockedUseServer = vi.mocked(useServer);
const mockedGet = vi.mocked(apiClient.get);

function makeServer(overrides: Partial<ServerInfo> = {}): ServerInfo {
  return {
    id: "MyServer",
    name: "My Unturned Server",
    gamePort: 27015,
    ownerSteamId: "76561198000000001",
    installDir: "/opt/unturned",
    state: "STOPPED",
    ...overrides,
  };
}

function makeMetrics() {
  return {
    data: {
      data: {
        serverId: "MyServer",
        samples: [],
        current: {
          cpuPercent: 42,
          memUsedMB: 4096,
          memTotalMB: 16384,
          diskUsedBytes: 140 * 1024 ** 3,
          diskTotalBytes: 250 * 1024 ** 3,
          networkRxBytes: 0,
          networkTxBytes: 0,
          networkRxRateBps: null,
          networkTxRateBps: null,
        },
      },
    },
  };
}

function makeSystemInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    hostname: "host-01",
    distro: "Debian GNU/Linux",
    release: "12",
    arch: "x64",
    kernel: "6.1.0-13-amd64",
    platform: "linux",
    cpu: { brand: "Intel Xeon", physicalCores: 4, cores: 8, speed: 2.6 },
    memTotalMB: 16384,
    diskTotalBytes: 250 * 1024 ** 3,
    diskUsedBytes: 140 * 1024 ** 3,
    gamePort: 27015,
    queryPort: 27016,
    ...overrides,
  };
}

/** 按 URL 分发 mock——DashboardPage + SystemMonitorCard + SystemInfoCard + StatusBlock 共四处调 apiClient.get */
function mockByUrl() {
  mockedGet.mockImplementation((url: string) => {
    if (url === "/system/metrics") {
      return Promise.resolve(makeMetrics());
    }
    if (url.includes("/config/workshop")) {
      return Promise.resolve({ data: { data: { File_IDs: [] } } });
    }
    if (url === "/system/info") {
      return Promise.resolve({ data: { data: makeSystemInfo() } });
    }
    if (url.includes("/incidents")) {
      return Promise.resolve({ data: { data: { total: 0, incidents: [] } } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("加载中：显示加载文案", () => {
    mockedUseServer.mockReturnValue({
      servers: [],
      loading: true,
      error: null,
      refresh: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
    });

    render(<DashboardPage />);
    expect(screen.getByText("加载中...")).toBeTruthy();
  });

  it("加载失败：显示错误 + 重试按钮", () => {
    const refresh = vi.fn();
    mockedUseServer.mockReturnValue({
      servers: [],
      loading: false,
      error: "网络错误",
      refresh,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
    });

    render(<DashboardPage />);
    expect(screen.getByText("无法加载服务器数据")).toBeTruthy();
    expect(screen.getByText("网络错误")).toBeTruthy();
    expect(screen.getByText("重试")).toBeTruthy();
  });

  it("无服务器：显示空态文案", () => {
    mockedUseServer.mockReturnValue({
      servers: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
    });

    render(<DashboardPage />);
    expect(screen.getByText("还没有服务器")).toBeTruthy();
    expect(screen.getByText(/在「服务器设置」中创建第一个/)).toBeTruthy();
  });

  it("正常渲染：含 4 StatCard + 资源监控 + 主机信息卡", async () => {
    mockByUrl();
    mockedUseServer.mockReturnValue({
      servers: [makeServer({ state: "RUNNING" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
    });

    render(<DashboardPage />);
    await new Promise((r) => setTimeout(r, 0));

    // 标题
    expect(screen.getByText("My Unturned Server")).toBeTruthy();
    // server.id 出现在多元素（状态徽章旁 + 跳转按钮 href）
    expect(screen.getAllByText(/MyServer/).length).toBeGreaterThanOrEqual(1);

    // 3 StatCard（CPU 实时数据由下方资源监控卡承担，避免主题重复）
    expect(screen.getByText("服务器状态")).toBeTruthy();
    // 「运行中」同时在 StatusBadge 和 StatCard value 中出现
    expect(screen.getAllByText("运行中").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("在线玩家")).toBeTruthy();
    expect(screen.getByText("Mod 数")).toBeTruthy();

    // 跳转按钮
    expect(screen.getByText("前往服务器设置")).toBeTruthy();

    // 主机信息卡
    expect(screen.getByText("主机信息")).toBeTruthy();
    expect(screen.getByText("Debian GNU/Linux 12")).toBeTruthy();

    // 资源监控卡
    expect(screen.getByTestId("system-monitor-card")).toBeTruthy();
  });

  it("调主机信息接口时带 serverId", async () => {
    mockByUrl();
    mockedUseServer.mockReturnValue({
      servers: [makeServer()],
      loading: false,
      error: null,
      refresh: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
    });

    render(<DashboardPage />);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedGet).toHaveBeenCalledWith("/system/info", {
      params: { serverId: "MyServer" },
    });
    expect(mockedGet).toHaveBeenCalledWith("/system/metrics", {
      params: { serverId: "MyServer" },
    });
    expect(mockedGet).toHaveBeenCalledWith(
      "/servers/MyServer/config/workshop",
    );
  });

  it("运行态服务器：状态徽章与标题反映", () => {
    mockedUseServer.mockReturnValue({
      servers: [makeServer({ state: "RUNNING", name: "Live Server" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
    });
    mockByUrl();

    render(<DashboardPage />);
    expect(screen.getByText("Live Server")).toBeTruthy();
    // 「运行中」在 StatusBadge + StatCard value 中各出现一次
    expect(screen.getAllByText("运行中").length).toBeGreaterThanOrEqual(2);
  });

  it("停止态服务器：状态徽章显示「已停止」", () => {
    mockedUseServer.mockReturnValue({
      servers: [makeServer({ state: "STOPPED" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
    });
    mockByUrl();

    render(<DashboardPage />);
    // 「已停止」在 StatusBadge + StatCard value 中各出现一次
    expect(screen.getAllByText("已停止").length).toBeGreaterThanOrEqual(2);
  });
});