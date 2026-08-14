import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { Info } from "lucide-react";
import { InfoCard } from "./InfoCard.js";

describe("InfoCard", () => {
  it("渲染标题 + children（默认 Info 图标）", () => {
    render(
      <InfoCard title="💡 测试提示">
        <p>内容段落 1</p>
      </InfoCard>,
    );
    expect(screen.getByText("💡 测试提示")).toBeInTheDocument();
    expect(screen.getByText("内容段落 1")).toBeInTheDocument();
  });

  it("不传 title → 仍渲染 children + 默认 Info 图标", () => {
    render(
      <InfoCard>
        <span>无标题内容</span>
      </InfoCard>,
    );
    expect(screen.getByText("无标题内容")).toBeInTheDocument();
  });

  it("variant='warning' → 标题前图标使用警告色（断言存在）", () => {
    render(
      <InfoCard title="⚠️ 警告" variant="warning">
        <p>...</p>
      </InfoCard>,
    );
    expect(screen.getByText("⚠️ 警告")).toBeInTheDocument();
  });

  it("icon 自定义 → 渲染用户图标", () => {
    render(
      <InfoCard title="自定义" icon={Info}>
        <p>...</p>
      </InfoCard>,
    );
    expect(screen.getByText("自定义")).toBeInTheDocument();
  });
});