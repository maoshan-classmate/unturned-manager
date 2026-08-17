import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

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

import { PageState } from "./PageState.js";

function isInDocument(el: Element | null): boolean {
  return el !== null && document.body.contains(el);
}

describe("PageState — 三态切换", () => {
  it("loading=true 时渲染 loading 占位", () => {
    const { getByTestId } = render(
      <PageState loading error={null} empty={false}>
        <div>数据</div>
      </PageState>,
    );
    expect(isInDocument(getByTestId("page-state-loading"))).toBe(true);
  });

  it("error 非空时渲染 error 占位", () => {
    const { getByTestId, getByText } = render(
      <PageState loading={false} error="加载失败详情" empty={false} onRetry={() => {}}>
        <div>数据</div>
      </PageState>,
    );
    expect(isInDocument(getByTestId("page-state-error"))).toBe(true);
    expect(isInDocument(getByText("加载失败详情"))).toBe(true);
  });

  it("empty=true 且无 loading/error 时渲染 empty 占位", () => {
    const { getByTestId, getByText } = render(
      <PageState loading={false} error={null} empty emptyText="没有 Mod">
        <div>数据</div>
      </PageState>,
    );
    expect(isInDocument(getByTestId("page-state-empty"))).toBe(true);
    expect(isInDocument(getByText("没有 Mod"))).toBe(true);
  });

  it("正常态不渲染占位，直接返回 children（无任何包裹层）", () => {
    const { container, getByTestId } = render(
      <PageState loading={false} error={null} empty={false}>
        <div data-testid="real-content">真实内容</div>
      </PageState>,
    );
    expect(isInDocument(getByTestId("real-content"))).toBe(true);
    expect(container.querySelector("[data-testid^='page-state-']")).toBeNull();
  });

  it("loading 优先级最高（同时给 loading+error 时只渲染 loading）", () => {
    const { getByTestId, queryByTestId } = render(
      <PageState loading error="也会被忽略" empty={false}>
        <div>数据</div>
      </PageState>,
    );
    expect(isInDocument(getByTestId("page-state-loading"))).toBe(true);
    expect(queryByTestId("page-state-error")).toBeNull();
  });

  it("error 优先级高于 empty", () => {
    const { getByTestId, queryByTestId } = render(
      <PageState loading={false} error="err" empty>
        <div>数据</div>
      </PageState>,
    );
    expect(isInDocument(getByTestId("page-state-error"))).toBe(true);
    expect(queryByTestId("page-state-empty")).toBeNull();
  });
});