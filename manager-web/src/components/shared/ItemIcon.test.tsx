import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemIcon } from "./ItemIcon.js";

describe("ItemIcon", () => {
  it("合法 ID 渲染 <img> 指向 /items/<id>.png", () => {
    const { container } = render(<ItemIcon id={1100} size={16} alt="测试物品" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/items/1100.png");
    expect(img!.getAttribute("width")).toBe("16");
    expect(img!.getAttribute("height")).toBe("16");
    expect(img!.getAttribute("loading")).toBe("lazy");
  });

  it("图片加载失败（onError）切换为 lucide Package 占位", () => {
    const { container } = render(<ItemIcon id={1100} alt="失败测试" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    // errored=true → img 应被移除，svg 占位出现
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("id 为 null 渲染 Package 占位（无 img）", () => {
    const { container } = render(<ItemIcon id={null} size={20} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("id 为 undefined 渲染 Package 占位", () => {
    const { container } = render(<ItemIcon id={undefined} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("id 越界（99999）渲染 Package 占位", () => {
    const { container } = render(<ItemIcon id={99999} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("id 越界（-1）渲染 Package 占位", () => {
    const { container } = render(<ItemIcon id={-1} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("id 非有限数（NaN）渲染 Package 占位", () => {
    const { container } = render(<ItemIcon id={Number.NaN} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("alt 默认空字符串（装饰性图，屏幕阅读器跳过）", () => {
    const { container } = render(<ItemIcon id={1100} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("");
  });

  it("className 透传给根 img", () => {
    const { container } = render(<ItemIcon id={1100} size={20} className="shrink-0" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.className).toContain("shrink-0");
  });

  it("onError 后不再回退到 img 状态（state 锁定）", () => {
    const { container } = render(<ItemIcon id={1100} alt="once" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});