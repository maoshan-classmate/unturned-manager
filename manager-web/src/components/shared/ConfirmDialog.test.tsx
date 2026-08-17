import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { Trash2 } from "lucide-react";

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

import { ConfirmDialog } from "./ConfirmDialog.js";

function isInDocument(el: Element | null): boolean {
  return el !== null && document.body.contains(el);
}

describe("ConfirmDialog — 确认弹窗", () => {
  it("open=false 时不渲染", () => {
    const { queryByRole } = render(
      <ConfirmDialog
        open={false}
        title="删除"
        message="确认删除吗"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(queryByRole("button", { name: /确认/ })).toBeNull();
  });

  it("open=true 时渲染标题、消息、确认/取消按钮", () => {
    const { getByText, getByRole } = render(
      <ConfirmDialog
        open
        title="删除实例"
        message="此操作不可撤销"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(getByText("删除实例").textContent).toBe("删除实例");
    expect(getByText("此操作不可撤销").textContent).toBe("此操作不可撤销");
    expect(getByRole("button", { name: "确认" })).toBeTruthy();
    expect(getByRole("button", { name: "取消" })).toBeTruthy();
  });

  it("点击确认按钮触发 onConfirm（关键：按钮文字保持「删除」与现有集成测试同步）", () => {
    const onConfirm = vi.fn();
    const { getByRole } = render(
      <ConfirmDialog
        open
        title="删除"
        message="?"
        confirmLabel="删除"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(getByRole("button", { name: "删除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("点击取消按钮触发 onCancel", () => {
    const onCancel = vi.fn();
    const { getByRole } = render(
      <ConfirmDialog
        open
        title="?"
        message="?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("variant=danger 时确认按钮背景为红色", () => {
    const { getByRole } = render(
      <ConfirmDialog
        open
        title="?"
        message="?"
        variant="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const btn = getByRole("button", { name: "确认" }) as HTMLButtonElement;
    expect(btn.style.backgroundColor).toBe("rgb(239, 68, 68)");
  });

  it("loading=true 时两按钮均 disabled（确认按钮文字变为「执行中...」）", () => {
    const { getByRole } = render(
      <ConfirmDialog
        open
        title="?"
        message="?"
        loading
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((getByRole("button", { name: "执行中..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("传 icon 时渲染 svg 元素", () => {
    const { container } = render(
      <ConfirmDialog
        open
        title="?"
        message="?"
        icon={Trash2}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const svg = container.querySelector("svg");
    expect(isInDocument(svg)).toBe(true);
  });
});