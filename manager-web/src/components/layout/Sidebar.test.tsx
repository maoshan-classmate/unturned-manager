import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";
import type { ServerInfo } from "../../hooks/useServer.js";

// ─── mock 依赖 ─────────────────────────────────────────
vi.mock("../../hooks/useServer.js", () => ({
  useServer: vi.fn(),
}));

import { useServer } from "../../hooks/useServer.js";
const useServerMock = useServer as unknown as ReturnType<typeof vi.fn>;

/** useServer 返回值形状（test 内联，避免泄露内部 interface） */
interface UseServerShape {
  servers: ServerInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addServer: (s: Omit<ServerInfo, "state">) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  updateServer: (id: string, patch: Partial<ServerInfo>) => Promise<void>;
}

function buildReturn(overrides: Partial<UseServerShape>): UseServerShape {
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

function renderAt(path: string, mockValue: UseServerShape) {
  useServerMock.mockReturnValue(mockValue);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {/* 必须给 useParams() 提供真正的 :serverId 路由（Splat '*' 不暴露 named param） */}
        <Route path="/" element={<Sidebar />} />
        <Route path="/:serverId/*" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Sidebar — 三态渲染（消除 'prefix 未知' 状态）", () => {
  it("Loading: servers=[] loading=true → 渲染骨架占位，不渲染菜单", () => {
    renderAt("/", buildReturn({ servers: [], loading: true }));

    // aria-busy 表示仍在加载
    expect(screen.getByLabelText("侧边栏加载中")).toBeTruthy();
    expect(screen.getByLabelText("侧边栏加载中").getAttribute("aria-busy")).toBe(
      "true",
    );

    // 8 个骨架节点
    const skeletons = screen.getByTestId("sidebar-skeleton");
    expect(skeletons.querySelectorAll(":scope > div").length).toBe(8);

    // 任何菜单项都不存在
    expect(screen.queryByText("仪表盘")).toBeNull();
    expect(screen.queryByText("控制台")).toBeNull();
    expect(screen.queryByText("还没有服务器实例")).toBeNull();
  });

  it("Empty: servers=[] loading=false → 渲染空态卡 + '去新建' CTA", () => {
    renderAt("/", buildReturn({ servers: [], loading: false }));

    expect(screen.getByTestId("sidebar-empty")).toBeTruthy();
    expect(screen.getByText("还没有服务器实例")).toBeTruthy();

    const cta = screen.getByRole("link", { name: /去新建实例/ });
    expect(cta.getAttribute("href")).toBe("/server-setup");

    // 菜单项仍然不存在
    expect(screen.queryByText("仪表盘")).toBeNull();
    expect(screen.queryByText("控制台")).toBeNull();
  });

  it("Ready: URL 上的 serverId 在列表里 → prefix 用 URL serverId", () => {
    const servers: ServerInfo[] = [
      {
        id: "S1",
        name: "MyServer",
        gamePort: 27015,
        ownerSteamId: "76561198XXXXXXXXX",
        installDir: "/opt/unturned",
      },
      {
        id: "S2",
        name: "SecondServer",
        gamePort: 27016,
        ownerSteamId: "76561198XXXXXXXXX",
        installDir: "/opt/unturned",
      },
    ];
    renderAt("/S2/console", buildReturn({ servers }));

    expect(screen.getByText("控制台").closest("a")?.getAttribute("href")).toBe(
      "/S2/console",
    );
    expect(screen.getByText("模组").closest("a")?.getAttribute("href")).toBe(
      "/S2/mods",
    );
    expect(
      screen.getByText("配置").closest("a")?.getAttribute("href"),
    ).toBe("/S2/config/commands");
    expect(screen.getByText("仪表盘").closest("a")?.getAttribute("href")).toBe(
      "/",
    );
  });

  it("Ready: URL 上的 serverId 不在列表里 → prefix 回退到列表第一个", () => {
    const servers: ServerInfo[] = [
      {
        id: "S1",
        name: "MyServer",
        gamePort: 27015,
        ownerSteamId: "76561198XXXXXXXXX",
        installDir: "/opt/unturned",
      },
    ];
    renderAt("/XXX/console", buildReturn({ servers }));

    // URL 上的 XXX 不在列表里，应回退到 S1
    expect(screen.getByText("控制台").closest("a")?.getAttribute("href")).toBe(
      "/S1/console",
    );
  });

  it("Ready: 根路径下 → prefix = 列表第一个", () => {
    const servers: ServerInfo[] = [
      {
        id: "S1",
        name: "MyServer",
        gamePort: 27015,
        ownerSteamId: "76561198XXXXXXXXX",
        installDir: "/opt/unturned",
      },
    ];
    renderAt("/", buildReturn({ servers }));

    expect(screen.getByText("控制台").closest("a")?.getAttribute("href")).toBe(
      "/S1/console",
    );
    // Dashboard 永远指向根
    expect(screen.getByText("仪表盘").closest("a")?.getAttribute("href")).toBe(
      "/",
    );
    // 服务器下拉显示第一个 id
    expect(screen.getByText("S1")).toBeTruthy();
  });

  it("Ready: 没有 disabled 假死态——每个 fullTo 是合法路由，无 '#' href", () => {
    const servers: ServerInfo[] = [
      {
        id: "S1",
        name: "MyServer",
        gamePort: 27015,
        ownerSteamId: "76561198XXXXXXXXX",
        installDir: "/opt/unturned",
      },
    ];
    renderAt("/", buildReturn({ servers }));

    // 抓所有 NavLink → 它们的 href 永远不会是 "#"
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link.getAttribute("href")).not.toBe("#");
    }
  });
});
