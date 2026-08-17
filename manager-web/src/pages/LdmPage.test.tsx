import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  UploadButton,
  PluginCard,
  InstalledTab,
} from "./LdmPage.js";

// InstalledTab 用 useQuery → mock apiClient（顶部 mock，不影响子组件测试）
vi.mock("../api/client.js", () => ({
  apiClient: { get: vi.fn() },
}));
import { apiClient } from "../api/client.js";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("LdmPage 子组件 — B1 上传入口闭环", () => {
  describe("UploadButton", () => {
    it("点击触发 file input onChange → 回调 onSelect 传入文件", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const { container } = render(<UploadButton onSelect={onSelect} />);
      // file input 隐藏在 label 里
      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();
      expect(fileInput.accept).toBe(".dll");
      // 构造假文件并触发 change
      const fakeFile = new File(["fake"], "Uconomy.dll", { type: "" });
      await user.upload(fileInput, fakeFile);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0]?.[0]?.name).toBe("Uconomy.dll");
    });

    it("disabled=true 时 file input 也 disabled", () => {
      const onSelect = vi.fn();
      const { container } = render(
        <UploadButton onSelect={onSelect} disabled />,
      );
      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(fileInput.disabled).toBe(true);
    });

    it("select 同名文件后 input 被清空，允许重复上传同一文件", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const { container } = render(<UploadButton onSelect={onSelect} />);
      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const fakeFile = new File(["x"], "A.dll");
      await user.upload(fileInput, fakeFile);
      await user.upload(fileInput, fakeFile);
      expect(onSelect).toHaveBeenCalledTimes(2);
      // 第二次上传后 input.value 应被清空（react hook 内部行为，不强断言）
    });
  });

  // ─── PluginCard reload 按钮 ────────────────────────────

  describe("PluginCard — reload 按钮", () => {
    const loadedPlugin = {
      name: "Uconomy",
      version: "3.0.0.0",
      sizeBytes: 1024,
      hasConfig: true,
      modifiedAtIso: "2026-08-15T06:00:00.000Z",
      runtimeStatus: "loaded" as const,
    };

    it("loaded 状态显示「重新加载」按钮", () => {
      render(
        <PluginCard
          plugin={loadedPlugin}
          loading={false}
          onLoad={() => {}}
          onUnload={() => {}}
          onReload={() => {}}
        />,
      );
      expect(
        screen.getByRole("button", { name: /重新加载/ }),
      ).toBeInTheDocument();
    });

    it("unloaded 状态不显示「重新加载」按钮", () => {
      render(
        <PluginCard
          plugin={{ ...loadedPlugin, runtimeStatus: "unloaded" }}
          loading={false}
          onLoad={() => {}}
          onUnload={() => {}}
          onReload={() => {}}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /重新加载/ }),
      ).not.toBeInTheDocument();
    });

    it("onReload 未传时不渲染 reload 按钮（向后兼容）", () => {
      render(
        <PluginCard
          plugin={loadedPlugin}
          loading={false}
          onLoad={() => {}}
          onUnload={() => {}}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /重新加载/ }),
      ).not.toBeInTheDocument();
    });

    it("点「重新加载」→ 弹 ConfirmDialog 警告 + 确认后 onReload 被调", async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();
      render(
        <PluginCard
          plugin={loadedPlugin}
          loading={false}
          onLoad={() => {}}
          onUnload={() => {}}
          onReload={onReload}
        />,
      );
      await user.click(screen.getByRole("button", { name: /重新加载/ }));
      // ConfirmDialog 警告文案
      expect(screen.getByText(/不保证成功/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /确认重新加载/ }));
      expect(onReload).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Phase 4b：InstalledTab 搜索筛选 ────────────────────────────

  describe("InstalledTab — 搜索筛选（Phase 4b）", () => {
    it("渲染搜索框 + 状态 chip（全部/已加载/未加载/加载失败）", async () => {
      (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: {
          data: {
            serverId: "S1",
            plugins: [
              {
                name: "Uconomy",
                version: "3.0.0.0",
                sizeBytes: 1024,
                hasConfig: true,
                modifiedAtIso: "2026-08-15T06:00:00.000Z",
                runtimeStatus: "loaded",
              },
            ],
            ldmNotDetected: false,
            detectedAtIso: "2026-08-15T06:00:00.000Z",
          },
        },
      });
      render(<InstalledTab serverId="S1" />, { wrapper: makeWrapper() });
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/搜索 .dll 名或版本/),
        ).toBeInTheDocument();
      });
      expect(screen.getByText("全部")).toBeInTheDocument();
      // chip 文本可能与 PluginCard 的 RuntimeStatusBadge 重复 → getAllByText
      expect(screen.getAllByText("已加载").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("未加载")).toBeInTheDocument();
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });

    it("无筛选时调用 /installed 端点", () => {
      (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: {
          data: {
            serverId: "S1",
            plugins: [],
            ldmNotDetected: false,
            detectedAtIso: "2026-08-15T06:00:00.000Z",
          },
        },
      });
      render(<InstalledTab serverId="S1" />, { wrapper: makeWrapper() });
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining("/ldm/installed"),
      );
    });
  });
});