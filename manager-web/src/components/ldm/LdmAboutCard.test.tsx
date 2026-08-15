import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { LdmAboutCard } from "./LdmAboutCard.js";

vi.mock("../../api/client.js", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));
import { apiClient } from "../../api/client.js";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** 构造 Axios 错误对象 + 后端 {error: {code, message}} 响应 */
function axiosError(code: string, status = 409) {
  return new AxiosError("err", undefined, undefined, undefined, {
    status,
    data: { error: { code, message: `mock ${code}` } },
    statusText: "Conflict",
    headers: {},
    config: {} as never,
  });
}

describe("LdmAboutCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path：显示版本 + 模块加载状态", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: {
          data: {
            serverId: "S1",
            ldmVersion: "4.9.3.18",
            gameVersion: "3.25.0.0",
            raw: "Rocket v4.9.3.18 for Unturned v3.25.0.0",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            serverId: "S1",
            rocketUnturnedLoaded: true,
            raw: "Rocket.Unturned loaded",
          },
        },
      });

    render(<LdmAboutCard serverId="S1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(
        screen.getByText(/Rocket v4\.9\.3\.18 for Unturned v3\.25\.0\.0/),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("已加载")).toBeInTheDocument();
    expect(screen.getByText("主框架版本")).toBeInTheDocument();
    expect(screen.getByText("Mod 框架模块")).toBeInTheDocument();
  });

  it("server-not-running → 显示「实例未运行」提示（不阻塞 UI）", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(axiosError("server-not-running", 409))
      .mockRejectedValueOnce(axiosError("server-not-running", 409));

    render(<LdmAboutCard serverId="S1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/实例未运行/)).toBeInTheDocument();
    });
    // 不阻塞渲染：「未读取到」仍展示
    expect(screen.getByText("未读取到")).toBeInTheDocument();
  });

  it("模块加载失败 → 显示「未加载」", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: {
          data: {
            serverId: "S1",
            ldmVersion: "4.9.3.18",
            gameVersion: "3.25.0.0",
            raw: "Rocket v4.9.3.18 for Unturned v3.25.0.0",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: { serverId: "S1", rocketUnturnedLoaded: false, raw: "" },
        },
      });

    render(<LdmAboutCard serverId="S1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText("未加载")).toBeInTheDocument();
    });
  });

  it("loading 中 → 字段显示「读取中…」", () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<LdmAboutCard serverId="S1" />, { wrapper: makeWrapper() });
    expect(screen.getAllByText("读取中…").length).toBeGreaterThan(0);
  });
});