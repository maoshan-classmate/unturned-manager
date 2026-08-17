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
  return { motion: { div: make("div"), span: make("span") }, AnimatePresence };
});
vi.mock("motion/react", () => motionFactory);

import { DialogShell } from "./DialogShell.js";

function isInDocument(el: Element | null): boolean {
  return el !== null && document.body.contains(el);
}

describe("DialogShell — 公共遮罩", () => {
  it("open=false 时不渲染遮罩", () => {
    const { container } = render(
      <DialogShell open={false} onClose={() => {}}>
        <div>内容</div>
      </DialogShell>,
    );
    expect(container.querySelector("[data-testid='dialog-overlay']")).toBeNull();
    expect(container.querySelector("[data-testid='dialog-panel']")).toBeNull();
  });

  it("open=true 时渲染遮罩 + 面板", () => {
    const { getByTestId } = render(
      <DialogShell open={true} onClose={() => {}}>
        <div>面板内容</div>
      </DialogShell>,
    );
    expect(isInDocument(getByTestId("dialog-overlay"))).toBe(true);
    expect(isInDocument(getByTestId("dialog-panel"))).toBe(true);
    expect(isInDocument(getByTestId("dialog-panel").querySelector("div"))).toBe(true);
  });

  it("点击遮罩触发 onClose（点击面板不触发）", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <DialogShell open={true} onClose={onClose}>
        <button>按钮</button>
      </DialogShell>,
    );
    fireEvent.click(getByTestId("dialog-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(getByTestId("dialog-panel"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("面板内容由调用方控制（透传 children）", () => {
    const { getByTestId } = render(
      <DialogShell open={true} onClose={() => {}}>
        <span data-testid="custom-child">自定义子元素</span>
      </DialogShell>,
    );
    expect(isInDocument(getByTestId("custom-child"))).toBe(true);
  });
});