import type { ServerId, SteamId64 } from "../types/branded.js";
import type { ServerState } from "../types/state.js";
import type { ClientWsRequestMessage } from "./ws.js";

// 泛化 WebSocket 连接类型——共享层不依赖 ws 库
export interface WsConnection {
  send(data: string): void;
  readyState: number;
  close(): void;
}

export const WsReadyState = {
  OPEN: 1,
} as const;

export type ServerEvent =
  | {
      type: "state_change";
      serverId: ServerId;
      from: ServerState;
      to: ServerState;
    }
  | {
      type: "console_line";
      serverId: ServerId;
      line: string;
      source: "stdout" | "file";
    }
  | {
      type: "player_join";
      serverId: ServerId;
      playerName: string;
      steamId: SteamId64;
    }
  | {
      type: "player_leave";
      serverId: ServerId;
      playerName: string;
      steamId: SteamId64;
    }
  | {
      type: "mod_apply_progress";
      serverId: ServerId;
      stage: string;
      remainingSeconds?: number;
    }
  | { type: "file_changed"; serverId: ServerId; path: string }
  // Phase 0 异步化：jobId 关联单个 SteamCMD 长任务（前端按 jobId 过滤订阅）；
  // latestVersion 是 check-update completed 事件携带的 U3DS buildid。此前缺失导致
  // SteamCmdManager 被迫 `as never`——契约补齐后删掉全部类型强转（P1-3 review 修复）。
  | {
      type: "steamcmd_progress";
      stage: string;
      percent?: number;
      jobId?: string;
      latestVersion?: string;
      /**
       * 失败时的根因描述（仅 failed 事件携带）——传给前端显示。
       * 原实现只广播 `stage: "failed"`，前端 toast 只能硬编码通用文案，
       * 对定位像 install-script-missing 这类后台诊断信息毫无价值。
       */
      errorMessage?: string;
    }
  // ★ ws-wrapper-design §2.2：请求-应答模式的应答事件。不走 broadcast() 分发——
  // 由 gateway 直接回给发起请求的那条连接（ack 是 per-request 的，不是广播）。
  // 业务错误经 error 字段传递（不抛异常）；payload 形状由具体请求类型决定，
  // 契约层不约束，前端按请求类型自行收窄。
  | {
      type: "ack";
      /** 与请求消息的 requestId 一一对应（UUID v4） */
      requestId: string;
      ok: boolean;
      /** 成功时的业务数据（可选） */
      payload?: unknown;
      /** 失败时的业务错误（code 用 snake_case，message 是用户可见中文） */
      error?: { code: string; message: string };
    };

/**
 * 请求-应答处理器返回形状（ws-wrapper-design §2.4）。
 * ok=false 时必须带 error；ok=true 时 payload 可选。
 */
export interface WsRequestResult {
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

/**
 * 请求-应答处理器签名——收到整条请求消息（含 requestId/serverId/业务字段），
 * 处理完返回结果；抛异常会被 gateway 兜底转成 internal_error 的 ack。
 */
export type WsRequestHandler = (
  msg: ClientWsRequestMessage,
) => Promise<WsRequestResult>;

export interface IBroadcaster {
  broadcast(event: ServerEvent): void;
  register(ws: WsConnection, serverIds: ServerId[]): void;
  unregister(ws: WsConnection): void;
  /**
   * 注册请求-应答处理器（ws-wrapper-design §2.4）。
   * 同一 type 重复注册会覆盖——组合根启动时一次性注册，运行期不改。
   *
   * @param type - 请求消息类型（如 "terminal_close" / "save" / "shutdown"）
   * @param handler - 业务处理器；抛异常由 gateway 兜底为 internal_error ack
   */
  registerRequestHandler(type: string, handler: WsRequestHandler): void;
  destroy(): Promise<void>;
}
