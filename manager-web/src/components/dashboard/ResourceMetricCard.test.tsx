import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Cpu } from "lucide-react";
import { ResourceMetricCard } from "./ResourceMetricCard.js";

describe("ResourceMetricCard", () => {
  it("正常渲染：图标 + 标题 + 百分比 + 进度条", () => {
    const { container } = render(
      <ResourceMetricCard icon={Cpu} title="CPU" percent={42.3} subtext="4 核" />,
    );

    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByTestId("metric-percent").textContent).toContain("42.3");
    expect(screen.getByText("4 核")).toBeTruthy();
    // ProgressBar 渲染 role=progressbar
    expect(container.querySelector('[role="progressbar"]')).toBeTruthy();
  });

  it("percent 为 null 时显示 — 占位，进度条无 percent", () => {
    const { container } = render(
      <ResourceMetricCard icon={Cpu} title="内存" percent={null} />,
    );

    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("0");
  });

  it("percent >= 90% 百分比文字变红色（text-red-500）", () => {
    render(<ResourceMetricCard icon={Cpu} title="内存" percent={95} />);

    const percent = screen.getByTestId("metric-percent");
    expect(percent.className).toContain("text-red-500");
  });

  it("percent < 90% 时百分比文字为正常色", () => {
    render(<ResourceMetricCard icon={Cpu} title="CPU" percent={50} />);

    const percent = screen.getByTestId("metric-percent");
    expect(percent.className).toContain("text-slate-100");
    expect(percent.className).not.toContain("text-red-500");
  });

  it("资源指标卡不输出 ProgressBar 的 stage 英文文本（不应出现 'active'/'failed'）", () => {
    const { container } = render(
      <ResourceMetricCard icon={Cpu} title="磁盘" percent={95} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("active");
    expect(text).not.toContain("failed");
  });

  it("百分数钳位：>100 视为 100，<0 视为 0", () => {
    const { container: c1 } = render(
      <ResourceMetricCard icon={Cpu} title="内存" percent={150} />,
    );
    expect(c1.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");

    const { container: c2 } = render(
      <ResourceMetricCard icon={Cpu} title="内存" percent={-10} />,
    );
    expect(c2.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");
  });
});