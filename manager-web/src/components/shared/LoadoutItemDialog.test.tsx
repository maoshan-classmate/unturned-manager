import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoadoutItemDialog } from "./LoadoutItemDialog.js";
import type { ItemRecord } from "@unturned-manager/shared";

const ITEMS: ItemRecord[] = [
  { id: 1, name: "手枪", source: "builtin" },
  { id: 15, name: "军刀", source: "builtin" },
  { id: 9999, name: "自定义MOD物品", source: "custom" },
];

function baseProps(overrides: Partial<Parameters<typeof LoadoutItemDialog>[0]> = {}) {
  return {
    open: true,
    skillsetId: 255,
    skillsetName: "所有技能组",
    initialItemIds: [1],
    items: ITEMS,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("LoadoutItemDialog — 物品选择", () => {
  it("预填 initialItemIds 为标签，名称反查（清单内）", () => {
    render(<LoadoutItemDialog {...baseProps()} />);
    const tags = within(screen.getByTestId("loadout-tags"));
    expect(tags.getByText("1")).toBeInTheDocument();
    expect(tags.getByText("手枪")).toBeInTheDocument();
  });

  it("清单外 ID → 标签显示「未知物品」", () => {
    render(
      <LoadoutItemDialog {...baseProps({ initialItemIds: [12345] })} />,
    );
    const tags = within(screen.getByTestId("loadout-tags"));
    expect(tags.getByText("12345")).toBeInTheDocument();
    expect(tags.getByText("未知物品")).toBeInTheDocument();
  });

  it("搜索过滤下拉 + 点击选项添加标签", async () => {
    const user = userEvent.setup();
    render(<LoadoutItemDialog {...baseProps()} />);
    await user.type(screen.getByPlaceholderText(/搜索物品/), "军刀");
    await user.click(await screen.findByText("军刀"));
    const tags = within(screen.getByTestId("loadout-tags"));
    expect(tags.getByText("15")).toBeInTheDocument();
    expect(tags.getByText("军刀")).toBeInTheDocument();
  });

  it("输入合法整数回车直接提交（Mod 物品）", async () => {
    const user = userEvent.setup();
    render(<LoadoutItemDialog {...baseProps()} />);
    await user.type(screen.getByPlaceholderText(/搜索物品/), "12345{Enter}");
    const tags = within(screen.getByTestId("loadout-tags"));
    expect(tags.getByText("12345")).toBeInTheDocument();
    expect(tags.getByText("未知物品")).toBeInTheDocument();
  });

  it("重复 ID 不重复添加（保存回传去重后的列表）", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<LoadoutItemDialog {...baseProps({ onSave })} />);
    await user.type(screen.getByPlaceholderText(/搜索物品/), "1{Enter}");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith([1]);
  });

  it("标签可单独删除", async () => {
    const user = userEvent.setup();
    render(<LoadoutItemDialog {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /移除物品 1/ }));
    const tags = within(screen.getByTestId("loadout-tags"));
    expect(tags.queryByText("1")).not.toBeInTheDocument();
  });

  it("保存回传最终标签列表；取消不回调保存", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <LoadoutItemDialog {...baseProps({ onSave, onCancel })} />,
    );
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
