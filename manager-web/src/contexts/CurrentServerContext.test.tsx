import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  CURRENT_SERVER_KEY,
  CurrentServerProvider,
  useCurrentServer,
} from "./CurrentServerContext.js";

/** 把组件渲染在 Provider 之下的标准包装 */
function wrapper({ children }: { children: ReactNode }) {
  return <CurrentServerProvider>{children}</CurrentServerProvider>;
}

describe("CurrentServerContext — 当前选中实例共享层", () => {
  beforeEach(() => {
    // 每个用例前清掉持久化，保证用例间隔离
    localStorage.clear();
  });

  it("Provider mount 时同步读 localStorage", () => {
    localStorage.setItem(CURRENT_SERVER_KEY, "S1");
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    expect(result.current.currentServerId).toBe("S1");
  });

  it("localStorage 为空时默认 null", () => {
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    expect(result.current.currentServerId).toBeNull();
  });

  it("setCurrentServerId 同时写 localStorage 与 Context", () => {
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    act(() => {
      result.current.setCurrentServerId("S2");
    });
    expect(result.current.currentServerId).toBe("S2");
    expect(localStorage.getItem(CURRENT_SERVER_KEY)).toBe("S2");
  });

  it("clear 同时从 localStorage 与 Context 移除", () => {
    localStorage.setItem(CURRENT_SERVER_KEY, "S1");
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    act(() => {
      result.current.clear();
    });
    expect(result.current.currentServerId).toBeNull();
    expect(localStorage.getItem(CURRENT_SERVER_KEY)).toBeNull();
  });

  it("跨标签同步：其他标签改了同一个 key 时更新 Context", () => {
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    expect(result.current.currentServerId).toBeNull();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CURRENT_SERVER_KEY,
          newValue: "S3",
          oldValue: null,
        }),
      );
    });
    expect(result.current.currentServerId).toBe("S3");
  });

  it("跨标签同步：清除同步触发 null 状态", () => {
    localStorage.setItem(CURRENT_SERVER_KEY, "S1");
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    expect(result.current.currentServerId).toBe("S1");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CURRENT_SERVER_KEY,
          newValue: null,
          oldValue: "S1",
        }),
      );
    });
    expect(result.current.currentServerId).toBeNull();
  });

  it("无关 key 的 storage 事件被忽略", () => {
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    expect(result.current.currentServerId).toBeNull();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "其他 key",
          newValue: "应被忽略",
          oldValue: null,
        }),
      );
    });
    expect(result.current.currentServerId).toBeNull();
  });

  it("Provider 外调用 useCurrentServer 抛错（null-guard）", () => {
    // 禁用错误日志噪音——我们要测的就是抛错
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCurrentServer())).toThrow(
      /CurrentServerProvider/,
    );
    errSpy.mockRestore();
  });
});

describe("CurrentServerContext — localStorage 不可用时降级", () => {
  let originalDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    // 模拟隐私模式下 localStorage 任何访问都抛错
    originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage disabled");
      },
    });
  });
  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    }
  });

  it("读抛错时初始值为 null 但组件不崩", () => {
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    expect(result.current.currentServerId).toBeNull();
  });

  it("写抛错时 Context 仍更新（仅不持久化、不崩）", () => {
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    expect(() =>
      act(() => {
        result.current.setCurrentServerId("S9");
      }),
    ).not.toThrow();
    expect(result.current.currentServerId).toBe("S9");
  });

  it("清除抛错时 Context 仍回到 null（仅不持久化）", () => {
    const { result } = renderHook(() => useCurrentServer(), { wrapper });
    act(() => {
      result.current.setCurrentServerId("S9");
    });
    expect(() =>
      act(() => {
        result.current.clear();
      }),
    ).not.toThrow();
    expect(result.current.currentServerId).toBeNull();
  });
});
