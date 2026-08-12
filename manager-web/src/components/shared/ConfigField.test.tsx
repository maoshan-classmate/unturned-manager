import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigField } from "./ConfigField.js";

const OPTIONS = [
  { value: "Easy", label: "简单" },
  { value: "Normal", label: "普通" },
  { value: "Hard", label: "困难" },
] as const;

describe("ConfigField", () => {
  it("不传 options/suggestions → 渲染普通文本框", () => {
    render(<ConfigField label="端口" value="27015" onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("27015");
  });

  it("传 options → 渲染下拉框（枚举字段），空值时显示占位提示", () => {
    render(
      <ConfigField
        label="难度"
        value=""
        onChange={() => {}}
        options={OPTIONS}
        placeholder="使用服务端默认（普通）"
      />,
    );
    // 下拉形态不渲染 textbox
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("使用服务端默认（普通）")).toBeInTheDocument();
  });

  it("下拉已选值显示对应 label", () => {
    render(
      <ConfigField
        label="难度"
        value="Easy"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    expect(screen.getByText("简单")).toBeInTheDocument();
  });

  it("下拉选「服务端默认」→ onChange 回传空串（恢复 SDK 默认）", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConfigField
        label="难度"
        value="Normal"
        onChange={onChange}
        options={OPTIONS}
      />,
    );

    // 点击 trigger 展开（Base UI Select trigger 是 combobox）
    await user.click(screen.getByRole("combobox"));
    // 点「服务端默认」项
    await user.click(await screen.findByRole("option", { name: "服务端默认" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("传 suggestions → 渲染带 datalist 建议的文本框（不限制输入）", () => {
    const { container } = render(
      <ConfigField
        label="地图"
        value="PEI"
        onChange={() => {}}
        suggestions={["PEI", "Washington"]}
      />,
    );
    // 用 container 限定查询，避开前一测试残留的 Base UI 弹层 portal
    const input = container.querySelector("input[list]") as HTMLInputElement;
    expect(input).not.toBeNull();
    // input 关联 datalist
    const listId = input.getAttribute("list");
    expect(listId).toBeTruthy();
    const datalist = document.getElementById(listId!);
    expect(datalist).not.toBeNull();
    const suggestions = Array.from(datalist!.querySelectorAll("option")).map(
      (o) => o.getAttribute("value"),
    );
    expect(suggestions).toEqual(["PEI", "Washington"]);
    // 仍是文本框（可自由输入 mod 地图名）
    expect(input).toHaveValue("PEI");
  });
});
