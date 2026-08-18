import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { StatusBlock } from "./StatusBlock.js";
import type { Incident } from "../../hooks/useIncidents.js";

interface UseIncidentsState {
  data: Incident[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

vi.mock("../../hooks/useIncidents.js", () => ({
  useIncidents: vi.fn(),
}));

import { useIncidents } from "../../hooks/useIncidents.js";
const mockedUseIncidents = vi.mocked(useIncidents);

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: overrides.id ?? "inc-1",
    serverId: "MyServer",
    type: overrides.type ?? "start",
    severity: overrides.severity ?? "info",
    message: overrides.message ?? "启动请求已发起",
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    details: overrides.details,
  };
}

describe("StatusBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loading 状态显示加载中文案", () => {
    mockedUseIncidents.mockReturnValue({
      data: [],
      loading: true,
      error: null,
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" />);
    expect(screen.getByText("加载中...")).toBeTruthy();
  });

  it("error 状态显示后端错误", () => {
    mockedUseIncidents.mockReturnValue({
      data: [],
      loading: false,
      error: "网络错误",
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" />);
    expect(screen.getByText("网络错误")).toBeTruthy();
  });

  it("空数据展示 '暂无事件'", () => {
    mockedUseIncidents.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" />);
    expect(screen.getByText("暂无事件")).toBeTruthy();
  });

  it("默认渲染——含标题 + 事件行 + 严重程度 key", () => {
    mockedUseIncidents.mockReturnValue({
      data: [
        makeIncident({
          id: "i1",
          type: "start",
          severity: "info",
          message: "启动请求已发起",
        }),
        makeIncident({
          id: "i2",
          type: "crash",
          severity: "error",
          message: "服务器异常退出",
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" />);

    expect(screen.getByText("近期事件")).toBeTruthy();
    expect(screen.getByText("共 2 条")).toBeTruthy();

    // 启动行
    const startRow = screen.getByTestId("incident-row-start");
    expect(startRow.getAttribute("data-severity")).toBe("info");
    expect(startRow.textContent).toContain("启动请求已发起");

    // 异常退出行
    const crashRow = screen.getByTestId("incident-row-crash");
    expect(crashRow.getAttribute("data-severity")).toBe("error");
    expect(crashRow.textContent).toContain("服务器异常退出");
  });

  it("maxItems 限制最多展示条数", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeIncident({ id: `i${i}`, message: `事件 ${i}` }),
    );
    mockedUseIncidents.mockReturnValue({
      data: events,
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" maxItems={3} />);

    const rows = screen.getAllByTestId(/^incident-row-/);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("事件 0");
    expect(rows[2]?.textContent).toContain("事件 2");
  });

  it("durationMs 在事件行尾显示 N.Ns", () => {
    mockedUseIncidents.mockReturnValue({
      data: [
        makeIncident({
          id: "i1",
          type: "start",
          severity: "info",
          message: "启动完成",
          details: { durationMs: 3500 },
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" />);
    expect(screen.getByText("3.5s")).toBeTruthy();
  });

  it("所有 6 类事件类型都能渲染对应行", () => {
    const types: Array<Incident["type"]> = [
      "start",
      "stop",
      "restart",
      "mod_apply",
      "ldm_apply",
      "crash",
    ];
    mockedUseIncidents.mockReturnValue({
      data: types.map((t, i) =>
        makeIncident({
          id: `i${i}`,
          type: t,
          message: `${t} 描述`,
        }),
      ),
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" maxItems={10} />);

    // 所有 6 个 testid 都能找到
    const rows = screen.getAllByTestId(/^incident-row-/);
    expect(rows).toHaveLength(6);
  });

  it("三档严重程度各有独立图标 + aria-label", () => {
    mockedUseIncidents.mockReturnValue({
      data: [
        makeIncident({ id: "i1", severity: "info", message: "info" }),
        makeIncident({ id: "i2", severity: "warning", message: "warning" }),
        makeIncident({ id: "i3", severity: "error", message: "error" }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    });

    render(<StatusBlock serverId="MyServer" />);

    // 严重程度图标有 aria-label 标识（info="正常" / warning="提示" / error="错误"）
    expect(screen.getByLabelText("正常")).toBeTruthy();
    expect(screen.getByLabelText("提示")).toBeTruthy();
    expect(screen.getByLabelText("错误")).toBeTruthy();
  });
});
