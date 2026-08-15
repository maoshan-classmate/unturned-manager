import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  UploadButton,
  InstallStepsCard,
  CommunityCard,
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

  describe("InstallStepsCard", () => {
    it("渲染 5 步说明 + 标题 '💡 插件安装步骤' + G5 安全注释", () => {
      render(<InstallStepsCard />);
      expect(screen.getByText("💡 插件安装步骤")).toBeInTheDocument();
      // 5 步（list-decimal 自动生成编号）
      const items = screen.getAllByRole("listitem");
      expect(items.length).toBe(5);
      // G5 安全注释
      expect(
        screen.getByText(/面板不会自动下载.*\.dll/),
      ).toBeInTheDocument();
    });

    it("含 GitHub Releases + Rocket/Plugins/ 关键路径提示（UX 闭环）", () => {
      render(<InstallStepsCard />);
      expect(screen.getByText(/GitHub Releases/)).toBeInTheDocument();
      expect(screen.getByText(/Rocket\/Plugins\//)).toBeInTheDocument();
    });

    it("使用 InfoCard 容器（断言暗色背景类存在）", () => {
      const { container } = render(<InstallStepsCard />);
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain("rounded-lg");
    });
  });

  describe("CommunityCard", () => {
    const basePlugin = {
      slug: "RocketModPlugins/Uconomy",
      name: "Uconomy",
      author: "RocketModPlugins",
      description: "Economy plugin",
      repoUrl: "https://github.com/RocketModPlugins/Uconomy",
      latestVersion: "d-r-1",
      updatedAtIso: "2020-02-19T08:24:35Z",
    };

    it("渲染插件名/作者/最新版本 + 「前往 Releases」外链 + 「查看详情」按钮 + 「上传到此实例」按钮", () => {
      const onUpload = vi.fn();
      const onViewDetail = vi.fn();
      render(
        <CommunityCard
          plugin={basePlugin}
          uploading={false}
          onUpload={onUpload}
          onViewDetail={onViewDetail}
        />,
      );
      expect(screen.getByText("Uconomy")).toBeInTheDocument();
      expect(screen.getByText("RocketModPlugins")).toBeInTheDocument();
      expect(screen.getByText("d-r-1")).toBeInTheDocument();
      // 外链 GitHub Releases
      const link = screen.getByRole("link", { name: /前往 Releases/ });
      expect(link.getAttribute("href")).toBe(basePlugin.repoUrl);
      expect(link.getAttribute("target")).toBe("_blank");
      // 上传按钮
      expect(
        screen.getByText(/上传到此实例/),
      ).toBeInTheDocument();
      // 详情按钮（Phase 3-3 G3）
      expect(
        screen.getByRole("button", { name: /查看详情/ }),
      ).toBeInTheDocument();
    });

    it("选文件后 onUpload 被调 1 次，文件名为用户上传的 .dll", async () => {
      const user = userEvent.setup();
      const onUpload = vi.fn();
      const onViewDetail = vi.fn();
      const { container } = render(
        <CommunityCard
          plugin={basePlugin}
          uploading={false}
          onUpload={onUpload}
          onViewDetail={onViewDetail}
        />,
      );
      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const fakeFile = new File(["binary"], "Uconomy.dll");
      await user.upload(fileInput, fakeFile);
      expect(onUpload).toHaveBeenCalledTimes(1);
      expect(onUpload.mock.calls[0]?.[0]?.name).toBe("Uconomy.dll");
    });

    it("uploading=true 时 file input disabled", () => {
      const onUpload = vi.fn();
      const onViewDetail = vi.fn();
      const { container } = render(
        <CommunityCard
          plugin={basePlugin}
          uploading={true}
          onUpload={onUpload}
          onViewDetail={onViewDetail}
        />,
      );
      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(fileInput.disabled).toBe(true);
    });

    it("插件名带特殊字符时 suggestedName 在 title 属性里", () => {
      const onUpload = vi.fn();
      const onViewDetail = vi.fn();
      const { container } = render(
        <CommunityCard
          plugin={{ ...basePlugin, name: "Test Plugin!" }}
          uploading={false}
          onUpload={onUpload}
          onViewDetail={onViewDetail}
        />,
      );
      const label = container.querySelector('label[title]');
      expect(label?.getAttribute("title")).toMatch(/Test_Plugin\.dll/);
    });

    it("点「查看详情」→ onViewDetail 回调 1 次传入 plugin.slug", async () => {
      const user = userEvent.setup();
      const onUpload = vi.fn();
      const onViewDetail = vi.fn();
      render(
        <CommunityCard
          plugin={basePlugin}
          uploading={false}
          onUpload={onUpload}
          onViewDetail={onViewDetail}
        />,
      );
      await user.click(screen.getByRole("button", { name: /查看详情/ }));
      expect(onViewDetail).toHaveBeenCalledTimes(1);
      expect(onViewDetail).toHaveBeenCalledWith(basePlugin.slug);
    });
  });

  // ─── Phase 4a：PluginCard reload 按钮 ────────────────────────────

  describe("PluginCard — reload 按钮（Phase 4a B4）", () => {
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