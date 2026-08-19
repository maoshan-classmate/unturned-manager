import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemListDialog } from "./ItemListDialog.js";
import { createItem, deleteItem, updateItem } from "../../api/items.js";
import type { ItemRecord } from "@unturned-manager/shared";

// mock API——组件内 CRUD 不连真后端
vi.mock("../../api/items.js", () => ({
  fetchItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}));

// mock 全局共享——每个 test 前清空，防止前一个测试的 mock.calls 污染下一个测试的断言（影响「不调 createItem」类断言）。
beforeEach(() => {
  vi.clearAllMocks();
});

const ITEMS: ItemRecord[] = [
  { id: 1, name: "手枪", source: "builtin" },
  { id: 9999, name: "自定义MOD物品", source: "custom" },
];

const onChanged = vi.fn();
const onClose = vi.fn();

function renderDialog() {
  return render(
    <ItemListDialog open items={ITEMS} onClose={onClose} onChanged={onChanged} />,
  );
}

describe("ItemListDialog — 物品清单管理", () => {
  it("内置行只读（无编辑/删除按钮），自定义行可编辑删除", () => {
    renderDialog();
    // 内置 1 手枪：无操作按钮
    expect(screen.queryByRole("button", { name: /编辑物品 1/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /删除物品 1/ })).toBeNull();
    // 自定义 9999：有编辑/删除
    expect(screen.getByRole("button", { name: /编辑物品 9999/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /删除物品 9999/ })).toBeInTheDocument();
  });

  it("搜索按 ID/名称过滤", async () => {
    const user = userEvent.setup();
    renderDialog();
    // 初始两条都在
    expect(screen.getByText("手枪")).toBeInTheDocument();
    expect(screen.getByText("自定义MOD物品")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/搜索物品/), "9999");
    expect(screen.queryByText("手枪")).not.toBeInTheDocument();
    expect(screen.getByText("自定义MOD物品")).toBeInTheDocument();
  });

  it("新增：填 ID + 名称 → createItem → onChanged", async () => {
    const user = userEvent.setup();
    vi.mocked(createItem).mockResolvedValue({ id: 8888, name: "新MOD物品", source: "custom" });
    renderDialog();
    await user.click(screen.getByRole("button", { name: /新增物品/ }));
    await user.type(screen.getByPlaceholderText(/例如 1/), "8888");
    await user.type(screen.getByPlaceholderText(/自定义名/), "新MOD物品");
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(createItem).toHaveBeenCalledWith({
      id: 8888,
      name: "新MOD物品",
      label: null,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("新增：填已存在的内置 ID → 字段报错，不调 createItem", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /新增物品/ }));
    await user.type(screen.getByPlaceholderText(/例如 1/), "1");
    await user.type(screen.getByPlaceholderText(/自定义名/), "重复内置物品");
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByText("该物品 ID 已存在")).toBeInTheDocument();
    expect(createItem).not.toHaveBeenCalled();
  });

  it("新增：填已存在的自定义 ID → 字段报错，不调 createItem", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /新增物品/ }));
    await user.type(screen.getByPlaceholderText(/例如 1/), "9999");
    await user.type(screen.getByPlaceholderText(/自定义名/), "重复自定义物品");
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByText("该物品 ID 已存在")).toBeInTheDocument();
    expect(createItem).not.toHaveBeenCalled();
  });

  it("编辑：改 ID 撞已存在 → 字段报错，不调 updateItem", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /编辑物品 9999/ }));
    const idInput = screen.getByPlaceholderText(/例如 1/);
    await user.clear(idInput);
    await user.type(idInput, "1");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("该物品 ID 已存在")).toBeInTheDocument();
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("编辑：改 ID + 名称 → updateItem(原ID, 新值) → onChanged", async () => {
    const user = userEvent.setup();
    vi.mocked(updateItem).mockResolvedValue({ id: 7777, name: "改名MOD", source: "custom" });
    renderDialog();
    await user.click(screen.getByRole("button", { name: /编辑物品 9999/ }));
    // 预填原值
    const idInput = screen.getByPlaceholderText(/例如 1/);
    const nameInput = screen.getByPlaceholderText(/自定义名/);
    expect(idInput).toHaveValue("9999");
    expect(nameInput).toHaveValue("自定义MOD物品");
    // 改值
    await user.clear(idInput);
    await user.type(idInput, "7777");
    await user.clear(nameInput);
    await user.type(nameInput, "改名MOD");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(updateItem).toHaveBeenCalledWith(9999, {
      id: 7777,
      name: "改名MOD",
      label: null,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("删除：确认后 deleteItem → onChanged", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteItem).mockResolvedValue(undefined);
    renderDialog();
    await user.click(screen.getByRole("button", { name: /删除物品 9999/ }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(deleteItem).toHaveBeenCalledWith(9999);
    expect(onChanged).toHaveBeenCalled();
  });
});
