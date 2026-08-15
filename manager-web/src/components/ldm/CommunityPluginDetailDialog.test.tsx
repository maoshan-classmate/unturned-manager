import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommunityPluginDetailDialog } from "./CommunityPluginDetailDialog.js";

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

describe("CommunityPluginDetailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("open=false 时返回 null（不挂载）", () => {
    const { container } = render(
      <CommunityPluginDetailDialog
        open={false}
        onClose={() => {}}
        slug={{ owner: "XanderCodes", repo: "AppleAdminControl" }}
        pat={null}
      />,
      { wrapper: makeWrapper() },
    );
    expect(container.firstChild).toBeNull();
  });

  it("happy path：标题 + 元数据 + README 预览 + 「打开 GitHub Releases」按钮", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: {
          slug: "XanderCodes/AppleAdminControl",
          name: "AppleAdminControl",
          author: "XanderCodes",
          description: "Admin [b]control[/b] plugin",
          repoUrl: "https://github.com/XanderCodes/AppleAdminControl",
          latestVersion: "1.1.2",
          updatedAtIso: "2026-03-07T14:15:06Z",
          releasesUrl:
            "https://github.com/XanderCodes/AppleAdminControl/releases/latest",
          readmePreview: "AppleAdminControl is a plugin...",
        },
      },
    });

    render(
      <CommunityPluginDetailDialog
        open
        onClose={() => {}}
        slug={{ owner: "XanderCodes", repo: "AppleAdminControl" }}
        pat={null}
      />,
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText("AppleAdminControl")).toBeInTheDocument();
    });
    expect(screen.getByText("XanderCodes")).toBeInTheDocument();
    expect(screen.getByText("1.1.2")).toBeInTheDocument();
    // BBCode strip
    expect(screen.getByText(/Admin control plugin/)).toBeInTheDocument();
    // README preview
    expect(screen.getByText(/AppleAdminControl is a plugin/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /打开 GitHub Releases/ }),
    ).toBeInTheDocument();
  });

  it("PAT 非空时透传 X-GitHub-Pat header", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: {
          slug: "o/r",
          name: "r",
          author: "o",
          description: "",
          repoUrl: "https://github.com/o/r",
          latestVersion: "1.0",
          updatedAtIso: "2026-03-07T14:15:06Z",
          releasesUrl: "https://github.com/o/r/releases/latest",
          readmePreview: null,
        },
      },
    });

    render(
      <CommunityPluginDetailDialog
        open
        onClose={() => {}}
        slug={{ owner: "o", repo: "r" }}
        pat="ghp_test"
      />,
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(screen.getByText("r")).toBeInTheDocument();
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/ldm/community-plugins/o/r",
      expect.objectContaining({ headers: { "X-GitHub-Pat": "ghp_test" } }),
    );
  });

  it("slug=null 时不发起查询（不报错）", () => {
    render(
      <CommunityPluginDetailDialog
        open
        onClose={() => {}}
        slug={null}
        pat={null}
      />,
      { wrapper: makeWrapper() },
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("查询失败 → 显示「详情读取失败」", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("404"),
    );

    render(
      <CommunityPluginDetailDialog
        open
        onClose={() => {}}
        slug={{ owner: "XanderCodes", repo: "AppleAdminControl" }}
        pat={null}
      />,
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText(/详情读取失败/)).toBeInTheDocument();
    });
  });

  it("点「关闭」→ onClose 被调", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: {
          slug: "o/r",
          name: "r",
          author: "o",
          description: "",
          repoUrl: "https://github.com/o/r",
          latestVersion: "1.0",
          updatedAtIso: "2026-03-07T14:15:06Z",
          releasesUrl: "https://github.com/o/r/releases/latest",
          readmePreview: null,
        },
      },
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <CommunityPluginDetailDialog
        open
        onClose={onClose}
        slug={{ owner: "o", repo: "r" }}
        pat={null}
      />,
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(screen.getByText("r")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});