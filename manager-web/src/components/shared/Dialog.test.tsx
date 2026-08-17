import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";

const motionFactory = vi.hoisted(() => {
  const make = (tag: string) => (props: Record<string, unknown>) => {
    const { layoutId, transition, initial, animate, exit, ...rest } = props;
    return React.createElement(tag, rest);
  };
  const AnimatePresence = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return { motion: { div: make("div") }, AnimatePresence };
});
vi.mock("motion/react", () => motionFactory);

import { Dialog } from "./Dialog.js";

describe("Dialog — 通用对话框", () => {
  it("open=false 时不渲染任何内容", () => {
    const { container } = render(
      <Dialog open={false} onClose={() => {}}>
        <div>内容</div>
      </Dialog>,
    );
    expect(container.querySelector("[data-testid='dialog-overlay']")).toBeNull();
    expect(container.textContent).not.toContain("内容");
  });

  it("open=true 时渲染标题 + 内容", () => {
    const { getByText, getByRole } = render(
      <Dialog open onClose={() => {}}>
        <Dialog.Title>对话框标题</Dialog.Title>
        <div>内容</div>
        <Dialog.Footer>
          <button>确定</button>
        </Dialog.Footer>
      </Dialog>,
    );
    expect(getByText("对话框标题").textContent).toBe("对话框标题");
    expect(getByText("内容").textContent).toBe("内容");
    expect(getByRole("button", { name: "确定" })).toBeTruthy();
  });

  it("点击遮罩触发 onClose", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <Dialog open onClose={onClose}>
        <div>内容</div>
      </Dialog>,
    );
    fireEvent.click(getByTestId("dialog-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("面板内联宽度样式保留为 min(Npx, calc(100vw - 2rem))（端到端选择器依赖）", () => {
    render(
      <Dialog open onClose={() => {}} width={600}>
        <div>内容</div>
      </Dialog>,
    );
    const allDivs = document.querySelectorAll("div");
    const matched = Array.from(allDivs).some((d) => d.style.width.includes("min(600px"));
    expect(matched).toBe(true);
  });

  it("支持 animation 入参两种取值（默认值与 fade-only）", () => {
    expect(() =>
      render(
        <Dialog open onClose={() => {}} animation="fade-scale">
          <div>A</div>
        </Dialog>,
      ),
    ).not.toThrow();
    expect(() =>
      render(
        <Dialog open onClose={() => {}} animation="fade-only">
          <div>B</div>
        </Dialog>,
      ),
    ).not.toThrow();
  });
});