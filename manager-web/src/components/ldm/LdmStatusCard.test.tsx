import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LdmStatusCard } from "./LdmStatusCard.js";

// ─── Mock apiClient ──────────────────────────────────
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

describe("LdmStatusCard", () => {
  it("loading 状态显示「加载中…」", () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<LdmStatusCard serverId="S1" />, { wrapper: makeWrapper() });
    expect(screen.getByText(/加载中…/)).toBeInTheDocument();
  });

  it("happy path：3 项状态徽章 + 插件总数 + 检测时间", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: {
          serverId: "S1",
          ldmInstalled: true,
          rocketDirExists: true,
          pluginCount: 5,
          detectedAtIso: "2026-08-15T06:00:00.000Z",
        },
      },
    });
    render(<LdmStatusCard serverId="S1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText("主框架")).toBeInTheDocument();
    });
    // 已安装 / 已生成
    expect(screen.getByText("已安装")).toBeInTheDocument();
    expect(screen.getByText("已生成")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // 检测于
    expect(screen.getByText(/检测于/)).toBeInTheDocument();
  });

  it("ldmInstalled=false 时显示「未安装」+ 灰色徽章", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: {
          serverId: "S1",
          ldmInstalled: false,
          rocketDirExists: false,
          pluginCount: 0,
          detectedAtIso: "2026-08-15T06:00:00.000Z",
        },
      },
    });
    render(<LdmStatusCard serverId="S1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText("未安装")).toBeInTheDocument();
    });
    expect(screen.getByText("未生成")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("错误时显示「状态读取失败」", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network error"),
    );
    render(<LdmStatusCard serverId="S1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText("状态读取失败")).toBeInTheDocument();
    });
  });
});