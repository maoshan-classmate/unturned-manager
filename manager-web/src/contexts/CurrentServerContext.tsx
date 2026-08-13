import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * localStorage 键名——当前选中服务端实例的标识。
 * 跨标签同步也用这个键（监听原生的 `storage` 事件）。
 */
export const CURRENT_SERVER_KEY = "unturned-manager.currentServerId";

/**
 * 当前选中实例共享层（sc:design 第 1 阶段）的对外接口。
 *
 * 接口语义说明：
 *   - **实例标识从此不再放在 URL 上**，而是由这个共享层承载
 *   - 持久化到 localStorage，重启面板后自动恢复
 *   - 跨标签页同步：监听原生的 `storage` 事件做最终一致
 *   - localStorage 不可用时（隐私模式等）降级到内存态：不持久化、不跨标签同步
 *
 * 消费方：实例类页面（控制台 / 配置 / 模组 / Mod 框架）、侧栏、服务器选择器。
 */
export interface CurrentServerContextValue {
  /** 当前选中的服务端实例标识；未选过或被清除时为 null */
  currentServerId: string | null;
  /**
   * 切换到指定实例——同步写入上下文状态与持久化。
   *
   * @param id - 要切换到的实例标识
   */
  setCurrentServerId: (id: string) => void;
  /** 清除当前选择——从上下文状态与持久化同时移除 */
  clear: () => void;
}

const CurrentServerContext = createContext<CurrentServerContextValue | null>(
  null,
);

/** 安全读 localStorage——任意异常都返回 null */
function readPersisted(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(CURRENT_SERVER_KEY);
  } catch {
    return null;
  }
}

/** 安全写 localStorage——任意异常静默返回 false */
function writePersisted(id: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(CURRENT_SERVER_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** 安全移除 localStorage——任意异常静默返回 false */
function removePersisted(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.removeItem(CURRENT_SERVER_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 探测 localStorage 是否真正可用（隐私模式下任何访问都抛错） */
function detectStorage(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const probe = "__probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 当前选中实例共享层的 Provider 组件。
 * 沿用 AuthContext 的 null-guard 模式（manager-web 状态管理标准）。
 *
 * Provider 树位置：放在 AuthProvider 之内、WebSocketProvider 之外。
 *
 * @param props - 组件属性
 * @param props.children - 子树
 * @returns 当前选中实例共享层包裹的 React 元素
 *
 * @example
 * ```tsx
 * <AuthProvider>
 *   <CurrentServerProvider>
 *     <App />
 *   </CurrentServerProvider>
 * </AuthProvider>
 * ```
 */
export function CurrentServerProvider({ children }: { children: ReactNode }) {
  // mount 时探测一次持久化能力，写入 ref 后续不再变更
  const storageOk = useRef(detectStorage());
  // 初始值同步从持久化读——不用 Suspense，因为 localStorage 同步 IO
  const [currentServerId, setCurrentServerIdState] = useState<string | null>(
    () => readPersisted(),
  );

  /**
   * 切换实例——同步更新上下文与持久化。
   * 持久化不可用时仅更新上下文（降级到内存态）。
   */
  const setCurrentServerId = useCallback((id: string) => {
    if (storageOk.current) writePersisted(id);
    setCurrentServerIdState(id);
  }, []);

  /**
   * 清除当前选择——同步从上下文与持久化移除。
   * 持久化不可用时仅更新上下文。
   */
  const clear = useCallback(() => {
    if (storageOk.current) removePersisted();
    setCurrentServerIdState(null);
  }, []);

  // 跨标签同步：其他标签改了同一个 key 时同步更新本地状态
  useEffect(() => {
    if (typeof window === "undefined") return;
    /**
     * @param e - 原生 storage 事件
     */
    function onStorage(e: StorageEvent) {
      if (e.key !== CURRENT_SERVER_KEY) return;
      // e.newValue 在清除时为 null；React setState 接受 string | null 直传
      setCurrentServerIdState(e.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <CurrentServerContext.Provider
      value={{ currentServerId, setCurrentServerId, clear }}
    >
      {children}
    </CurrentServerContext.Provider>
  );
}

/**
 * 消费当前选中实例的钩子。
 * 必须在 CurrentServerProvider 内调用——Provider 外抛错（null-guard）。
 *
 * @returns 当前实例标识 + 写入方法 + 清除方法
 * @throws 在 Provider 外调用时抛错（null-guard 模式）
 *
 * @example
 * ```tsx
 * function ConsolePage() {
 *   const { currentServerId, setCurrentServerId } = useCurrentServer();
 *   if (currentServerId === null) return <NoInstanceGuide />;
 *   // 用 currentServerId 取数据...
 * }
 * ```
 */
export function useCurrentServer(): CurrentServerContextValue {
  const ctx = useContext(CurrentServerContext);
  if (!ctx) {
    throw new Error(
      "useCurrentServer 必须在 CurrentServerProvider 内调用——请检查组件树",
    );
  }
  return ctx;
}
