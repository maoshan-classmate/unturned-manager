import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemInfoCard } from "./SystemInfoCard.js";
import type { SystemInfo } from "@unturned-manager/shared";

function makeInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    hostname: "host-01",
    distro: "Debian GNU/Linux",
    release: "12",
    arch: "x64",
    kernel: "6.1.0-13-amd64",
    platform: "linux",
    cpu: { brand: "Intel Xeon", physicalCores: 4, cores: 8, speed: 2.6 },
    memTotalMB: 16384,
    diskTotalBytes: 250 * 1024 ** 3,
    diskUsedBytes: 140 * 1024 ** 3,
    gamePort: 27015,
    queryPort: 27016,
    ...overrides,
  };
}

describe("SystemInfoCard", () => {
  it("正常渲染：8 项字段齐全", () => {
    render(<SystemInfoCard data={makeInfo()} />);

    expect(screen.getByText("主机信息")).toBeTruthy();
    expect(screen.getByText("Debian GNU/Linux 12")).toBeTruthy();
    expect(screen.getByText("x64")).toBeTruthy();
    expect(screen.getByText("6.1.0-13-amd64")).toBeTruthy();
    expect(screen.getByText("host-01")).toBeTruthy();
    expect(screen.getByText("Intel Xeon")).toBeTruthy();
    expect(screen.getByText("16384 MB")).toBeTruthy();
    expect(screen.getByText("游戏 27015 / 查询 27016")).toBeTruthy();
    expect(screen.getByText("linux")).toBeTruthy();
  });

  it("loading=true 且无 data 时显示「加载中」而非「未知」", () => {
    render(<SystemInfoCard loading />);

    expect(screen.getByText("加载中...")).toBeTruthy();
    expect(screen.queryByText("未知")).toBeNull();
  });

  it("data 为 null + 未 loading 时所有字段显示「未知」", () => {
    render(<SystemInfoCard data={null} />);

    const unknowns = screen.getAllByText("未知");
    expect(unknowns.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("未配置")).toBeTruthy();
  });

  it("端口字段：仅 gamePort 缺失时显示「未配置」", () => {
    render(
      <SystemInfoCard
        data={makeInfo({ gamePort: null, queryPort: null })}
      />,
    );
    expect(screen.getByText("未配置")).toBeTruthy();
  });

  it("字段空字符串视为缺失（显示「未知」）", () => {
    render(
      <SystemInfoCard
        data={makeInfo({
          hostname: "",
          distro: "",
          arch: "",
          kernel: "",
        })}
      />,
    );
    const unknowns = screen.getAllByText("未知");
    expect(unknowns.length).toBeGreaterThanOrEqual(4);
  });

  it("loading=true 但已有 data：仍渲染完整字段（不显示加载中）", () => {
    render(<SystemInfoCard data={makeInfo()} loading />);

    expect(screen.queryByText("加载中...")).toBeNull();
    expect(screen.getByText("Debian GNU/Linux 12")).toBeTruthy();
  });
});