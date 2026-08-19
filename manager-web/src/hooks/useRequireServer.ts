import { useCurrentServer } from "../contexts/CurrentServerContext.js";
import { useServers } from "../contexts/ServersContext.js";

/**
 * 实例守卫钩子的返回状态。
 *
 * 三态语义说明（ServersProvider 化后 loading 已由 AppLayout 顶层处理）：
 *
 * - **未选过**：当前选中实例标识为 null——用户从未选过实例，或主动清除了选择
 * - **已选但不存在**：当前选中实例有值，但服务端实例列表里没有（实例已被删除）
 * - **就绪**：当前选中实例在服务端实例列表里，可以正常使用
 *
 * 提示文案分工：
 * - empty / missing 都跳服务器设置页（让用户去建/选实例）
 * - 但 toast 文案按状态区分（前者"请先选择一个实例"；后者"该服务器实例不存在"）
 */
export type RequireServerStatus =
  | { status: "empty" }
  | { status: "missing"; storedId: string }
  | { status: "ready"; serverId: string };

/**
 * 实例类四个页面（控制台 / 配置 / 模组 / Mod 框架）的统一守卫钩子。
 *
 * 数据来源是全局 ServersProvider：AppLayout 顶层在 servers 加载完成前显示全屏
 * 加载态，加载完成后才挂载 WebSocketProvider + 渲染 Routes——所以本钩子只处理
 * empty/missing/ready 三态，无需 loading 分支。
 *
 * **关键约束**：
 * - 钩子本身**只读**——返回状态而不主动跳转或弹提示
 * - 副作用（导航 + toast）由消费方在自己的 useEffect 内完成——React 钩子规则禁止可观察的副作用
 * - 钩子依赖两个上游共享层：`useServers`（当前实例列表）和 `useCurrentServer`（当前选中实例）
 *
 * @returns 守卫状态——参见 {@link RequireServerStatus}
 *
 * @example
 * ```tsx
 * function ConsolePage() {
 *   const guard = useRequireServer();
 *
 *   useEffect(() => {
 *     if (guard.status === 'empty') {
 *       navigate('/server-setup', { replace: true });
 *       toast.warning('请先选择一个实例');
 *     } else if (guard.status === 'missing') {
 *       navigate('/server-setup', { replace: true });
 *       toast.warning('该服务器实例不存在');
 *     }
 *   }, [guard.status, navigate]);
 *
 *   if (guard.status !== 'ready') return null;
 *   // guard.serverId 是已校验的真实实例标识，可放心使用
 *   return <ConsoleContent serverId={guard.serverId} />;
 * }
 * ```
 */
export function useRequireServer(): RequireServerStatus {
  const { servers } = useServers();
  const { currentServerId } = useCurrentServer();

  // 上下文为空——用户从未选过实例
  if (currentServerId === null) return { status: "empty" };

  // 上下文有值——校验是否还在实例列表里
  const exists = servers.some((s) => s.id === currentServerId);
  if (!exists) return { status: "missing", storedId: currentServerId };

  return { status: "ready", serverId: currentServerId };
}