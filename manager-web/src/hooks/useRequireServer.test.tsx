import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRequireServer } from "./useRequireServer.js";
import {
  CURRENT_SERVER_KEY,
  CurrentServerProvider,
} from "../contexts/CurrentServerContext.js";
import { ServersProvider } from "../contexts/ServersContext.js";
import type { ServerInfo } from "../contexts/ServersContext.js";

// ─── mock useServers hook ─────────────────────────────────
vi.mock("../contexts/ServersContext.js", async () => {
  const actual = await vi.importActual("../contexts/ServersContext.js");
  return {
    ...actual,
    useServers: vi.fn(),
  };
});
import { useServers } from "../contexts/ServersContext.js";
// 测试本地 mock：cast 到 any 跳过 vitest Mock 的严格重载，避免对不上真实 hook 的返回类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedUseServers = useServers as any;

/** 测试关心的 useServers 字段——只覆盖 servers，其他字段用占位 */
function buildReturn(overrides: { servers?: ServerInfo[] } = {}) {
  return {
    servers: [] as ServerInfo[],
    loading: false,
    error: null,
    refresh: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    updateServer: vi.fn(),
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <CurrentServerProvider>
      <ServersProvider>{children}</ServersProvider>
    </CurrentServerProvider>
  );
}

/** 生成测试用 ServerInfo——只需 id，其他字段用占位 */
function sampleServer(id: string): ServerInfo {
  return {
    id,
    name: id,
    gamePort: 27015,
    ownerSteamId: "76561198XXXXXXXXX",
    installDir: "/opt/unturned",
  };
}

describe("useRequireServer — 实例守卫钩子", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedUseServers.mockReset();
  });

  it("servers 为空 且 上下文为空时返回 empty（新用户没选过任何实例）", () => {
    mockedUseServers.mockReturnValue(buildReturn() as never);
    const { result } = renderHook(() => useRequireServer(), { wrapper });
    expect(result.current).toEqual({ status: "empty" });
  });

  it("servers 非空 但上下文为空时返回 empty（用户清除了选择或从未选过）", () => {
    mockedUseServers.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1")] }),
    );
    const { result } = renderHook(() => useRequireServer(), { wrapper });
    expect(result.current).toEqual({ status: "empty" });
  });

  it("currentServerId 在 servers 里时返回 ready", () => {
    mockedUseServers.mockReturnValue(
      buildReturn({
        servers: [sampleServer("S1"), sampleServer("S2")],
      }),
    );
    localStorage.setItem(CURRENT_SERVER_KEY, "S2");
    const { result } = renderHook(() => useRequireServer(), { wrapper });
    expect(result.current).toEqual({ status: "ready", serverId: "S2" });
  });

  it("currentServerId 不在 servers 里时返回 missing，携带 storedId", () => {
    mockedUseServers.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1")] }),
    );
    localStorage.setItem(CURRENT_SERVER_KEY, "XXX");
    const { result } = renderHook(() => useRequireServer(), { wrapper });
    expect(result.current).toEqual({ status: "missing", storedId: "XXX" });
  });

  it("状态切换：missing → ready 当服务实例列表更新后", () => {
    mockedUseServers.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1")] }),
    );
    localStorage.setItem(CURRENT_SERVER_KEY, "XXX");

    const { result, rerender } = renderHook(() => useRequireServer(), {
      wrapper,
    });
    expect(result.current).toEqual({ status: "missing", storedId: "XXX" });

    // 服务端实例列表更新，加入 XXX 这个标识
    mockedUseServers.mockReturnValue(
      buildReturn({
        servers: [sampleServer("S1"), sampleServer("XXX")],
      }),
    );
    rerender();
    expect(result.current).toEqual({ status: "ready", serverId: "XXX" });
  });

  it("状态切换：ready → missing 当用户删除当前选中实例后", () => {
    mockedUseServers.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1"), sampleServer("S2")] }),
    );
    localStorage.setItem(CURRENT_SERVER_KEY, "S2");

    const { result, rerender } = renderHook(() => useRequireServer(), {
      wrapper,
    });
    expect(result.current).toEqual({ status: "ready", serverId: "S2" });

    // 用户删除了 S2
    mockedUseServers.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1")] }),
    );
    rerender();
    expect(result.current).toEqual({ status: "missing", storedId: "S2" });
  });
});