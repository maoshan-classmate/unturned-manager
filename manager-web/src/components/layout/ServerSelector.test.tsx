import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ServerSelector } from "./ServerSelector.js";
import { CurrentServerProvider } from "../../contexts/CurrentServerContext.js";
import type { ServerInfo } from "../../hooks/useServer.js";

// ─── mock useServer ─────────────────────────────────
vi.mock("../../hooks/useServer.js", () => ({
  useServer: vi.fn(),
}));
import { useServer } from "../../hooks/useServer.js";
const mockedUseServer = useServer as unknown as ReturnType<typeof vi.fn>;

interface PartialServerReturn {
  servers: ServerInfo[];
  loading: boolean;
}

function buildReturn(overrides: Partial<PartialServerReturn> = {}) {
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

function sampleServer(id: string, name = id): ServerInfo {
  return {
    id,
    name,
    gamePort: 27015,
    ownerSteamId: "76561198XXXXXXXXX",
    installDir: "/opt/unturned",
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <CurrentServerProvider>{children}</CurrentServerProvider>
    </MemoryRouter>
  );
}

describe("ServerSelector — 真实选择器", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedUseServer.mockReset();
  });

  it("默认收起：只渲染触发器按钮", () => {
    mockedUseServer.mockReturnValue(buildReturn());
    render(<ServerSelector />, { wrapper });
    expect(screen.getByRole("button", { name: /切换服务器/ })).toBeTruthy();
    // 下拉面板未渲染
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("未选实例时显示「未选择实例」", () => {
    mockedUseServer.mockReturnValue(buildReturn({ servers: [] }));
    render(<ServerSelector />, { wrapper });
    expect(screen.getByText("未选择实例")).toBeTruthy();
  });

  it("已选实例时显示该实例名 + 状态点", () => {
    mockedUseServer.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1", "我的服务器")] }),
    );
    localStorage.setItem("unturned-manager.currentServerId", "S1");
    render(<ServerSelector />, { wrapper });
    expect(screen.getByText("我的服务器")).toBeTruthy();
  });

  it("点击触发器按钮展开下拉面板", () => {
    mockedUseServer.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1")] }),
    );
    render(<ServerSelector />, { wrapper });
    expect(screen.queryByRole("menu")).toBeNull();

    const trigger = screen.getByRole("button", { name: /切换服务器/ });
    act(() => {
      fireEvent.click(trigger);
    });

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("空列表时下拉显示「还没有服务器实例」", () => {
    mockedUseServer.mockReturnValue(buildReturn({ servers: [] }));
    render(<ServerSelector />, { wrapper });
    const trigger = screen.getByRole("button", { name: /切换服务器/ });
    act(() => {
      fireEvent.click(trigger);
    });
    expect(screen.getByText("还没有服务器实例")).toBeTruthy();
  });

  it("点击下拉中的实例写入共享层 + 关闭面板", () => {
    mockedUseServer.mockReturnValue(
      buildReturn({
        servers: [sampleServer("S1"), sampleServer("S2", "我的二服")],
      }),
    );
    render(<ServerSelector />, { wrapper });

    // 展开
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /切换服务器/ }));
    });
    expect(screen.getByRole("menu")).toBeTruthy();

    // 点击 "我的二服"
    act(() => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: /我的二服/ }));
    });

    // 面板关闭 + 持久化写入
    expect(screen.queryByRole("menu")).toBeNull();
    expect(localStorage.getItem("unturned-manager.currentServerId")).toBe("S2");
  });

  it("点击「新建实例」链接跳到 /server-setup 并关闭面板", () => {
    mockedUseServer.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1")] }),
    );
    render(<ServerSelector />, { wrapper });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /切换服务器/ }));
    });

    const newLink = screen.getByRole("link", { name: /新建实例/ });
    expect(newLink.getAttribute("href")).toBe("/server-setup");
  });

  it("ESC 关闭展开的面板", () => {
    mockedUseServer.mockReturnValue(
      buildReturn({ servers: [sampleServer("S1")] }),
    );
    render(<ServerSelector />, { wrapper });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /切换服务器/ }));
    });
    expect(screen.getByRole("menu")).toBeTruthy();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
