import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoadoutEditor, type LoadoutEntry } from "./LoadoutEditor.js";
import { fetchItems } from "../../api/items.js";

// mock API——useItems 挂载拉取物品清单，测试不连真后端
vi.mock("../../api/items.js", () => ({
  fetchItems: vi.fn(),
}));

const ITEMS = [
  { id: 1, name: "手枪", source: "builtin" as const },
  { id: 15, name: "军刀", source: "builtin" as const },
];

function renderEditor(loadouts: LoadoutEntry[], onChange = vi.fn()) {
  return render(
    <LoadoutEditor loadouts={loadouts} onChange={onChange} />,
  );
}

describe("LoadoutEditor — 开局物品编辑", () => {
  beforeEach(() => {
    vi.mocked(fetchItems).mockResolvedValue(ITEMS);
  });

  it("渲染条目：技能组名 + 物品标签（名称反查）", async () => {
    renderEditor([{ skillsetId: 255, itemIds: [1, 15] }]);
    expect(await screen.findByText("所有技能组")).toBeInTheDocument();
    expect(screen.getByText("手枪")).toBeInTheDocument();
    expect(screen.getByText("军刀")).toBeInTheDocument();
  });

  it("255 互斥：已配 255 → 技能组条目灰显且无编辑按钮", async () => {
    const onChange = vi.fn();
    renderEditor(
      [
        { skillsetId: 255, itemIds: [1] },
        { skillsetId: 2, itemIds: [15] },
      ],
      onChange,
    );
    // 技能组 2（警察）条目存在但无编辑按钮
    const policeRow = (await screen.findByText("警察")).closest("div");
    expect(policeRow).not.toBeNull();
    expect(
      within(policeRow as HTMLElement).queryByRole("button", { name: /编辑/ }),
    ).toBeNull();
    // 255 条目可编辑
    const allRow = screen.getByText("所有技能组").closest("div");
    expect(
      within(allRow as HTMLElement).getByRole("button", { name: /编辑/ }),
    ).toBeInTheDocument();
    // 互斥提示出现
    expect(screen.getByText(/具体技能组条目会被覆盖/)).toBeInTheDocument();
  });

  it("技能组选择器：未配置时默认 255；已配技能组时 255 不出现（D4 互斥）", async () => {
    // 场景 1：无配置 → 255 默认选中 + 可选
    const { unmount } = renderEditor([]);
    const sel = screen.getByRole("combobox", { name: "选择技能组" });
    expect(sel).toHaveValue("255");
    expect(
      Array.from(sel.querySelectorAll("option")).map((o) => o.value),
    ).toContain("255");
    unmount();

    // 场景 2：已配技能组（警察 2）→ 255 不在选项中，未配技能组仍可选
    renderEditor([{ skillsetId: 2, itemIds: [15] }]);
    const sel2 = screen.getByRole("combobox", { name: "选择技能组" });
    const optVals = Array.from(sel2.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(optVals).not.toContain("255");
    expect(optVals).toContain("1"); // 消防员可选
  });

  it("编辑条目 → 打开物品选择 dialog 预填已有标签", async () => {
    const user = userEvent.setup();
    renderEditor([{ skillsetId: 2, itemIds: [15] }]);
    await user.click(await screen.findByRole("button", { name: /编辑.*警察/ }));
    // dialog 打开，预填标签 15 军刀
    const tags = await screen.findByTestId("loadout-tags");
    expect(within(tags).getByText("15")).toBeInTheDocument();
    expect(within(tags).getByText("军刀")).toBeInTheDocument();
  });

  it("编辑保存 → onChange 替换该技能组条目", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor([{ skillsetId: 2, itemIds: [15] }], onChange);
    await user.click(await screen.findByRole("button", { name: /编辑.*警察/ }));
    // dialog 内输入新物品回车 → 保存
    await user.type(
      await screen.findByPlaceholderText(/搜索物品/),
      "1{Enter}",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onChange).toHaveBeenCalledWith([
      { skillsetId: 2, itemIds: [15, 1] },
    ]);
  });

  it("删除 → ConfirmDialog 确认 → onChange 移除条目", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor([{ skillsetId: 2, itemIds: [15] }], onChange);
    await user.click(await screen.findByRole("button", { name: /删除.*警察/ }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("添加新条目 → 打开空 dialog，保存空标签不新增条目", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor([], onChange);
    // 选择器选「消防员（1）」，再点添加
    await user.selectOptions(
      screen.getByRole("combobox", { name: "选择技能组" }),
      "1",
    );
    await user.click(screen.getByRole("button", { name: /添加开局物品/ }));
    // dialog 打开，无预填标签
    const tags = await screen.findByTestId("loadout-tags");
    expect(within(tags).queryByText("1")).toBeNull();
    // 直接保存空 → 不新增
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
