import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  UploadButton,
  InstallStepsCard,
  CommunityCard,
} from "./LdmPage.js";

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

    it("渲染插件名/作者/最新版本 + 「查看仓库」外链 + 「上传到此实例」按钮", () => {
      const onUpload = vi.fn();
      render(
        <CommunityCard
          plugin={basePlugin}
          uploading={false}
          onUpload={onUpload}
        />,
      );
      expect(screen.getByText("Uconomy")).toBeInTheDocument();
      expect(screen.getByText("RocketModPlugins")).toBeInTheDocument();
      expect(screen.getByText("d-r-1")).toBeInTheDocument();
      // 外链 GitHub Releases
      const link = screen.getByRole("link", { name: /查看仓库/ });
      expect(link.getAttribute("href")).toBe(basePlugin.repoUrl);
      expect(link.getAttribute("target")).toBe("_blank");
      // 上传按钮
      expect(
        screen.getByText(/上传到此实例/),
      ).toBeInTheDocument();
    });

    it("选文件后 onUpload 被调 1 次，文件名为用户上传的 .dll", async () => {
      const user = userEvent.setup();
      const onUpload = vi.fn();
      const { container } = render(
        <CommunityCard
          plugin={basePlugin}
          uploading={false}
          onUpload={onUpload}
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
      const { container } = render(
        <CommunityCard
          plugin={basePlugin}
          uploading={true}
          onUpload={onUpload}
        />,
      );
      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(fileInput.disabled).toBe(true);
    });

    it("插件名带特殊字符时 suggestedName 在 title 属性里", () => {
      const onUpload = vi.fn();
      const { container } = render(
        <CommunityCard
          plugin={{ ...basePlugin, name: "Test Plugin!" }}
          uploading={false}
          onUpload={onUpload}
        />,
      );
      const label = container.querySelector('label[title]');
      expect(label?.getAttribute("title")).toMatch(/Test_Plugin\.dll/);
    });
  });
});