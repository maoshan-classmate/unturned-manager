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
  // 原始 PTY 输出通道——不做行切分，由前端 xterm 内部 ANSI 状态机自处理跨 chunk
  // 不完整转义序列。LogStreamer 文件 tail 仍走 console_line（每文件行一条事件）。
  | {
      type: "console_output";
      serverId: ServerId;
      chunk: string;
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
  // LDM 应用变更进度（与 mod_apply_progress 同模式，分开类型便于前端过滤）
  | {
      type: "ldm_apply_progress";
      serverId: ServerId;
      stage: "preparing" | "stopping" | "starting" | "verifying" | "ready" | "failed";
      /** 0-100 进度估算（前端显示进度条；stopping/starting 阶段可用） */
      percent?: number;
      /** 失败时的根因描述（仅 failed 事件携带）——前端 toast 显示 */
      errorMessage?: string;
    }
  // Status Block 事件流——事件写入时立即推送，前端无须轮询
  | {
      type: "incident_created";
      serverId: ServerId;
      incident: import("./incidents.js").Incident;
    }
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
      /**
       * 排队位置（≥2 表示「前面还有任务在跑」）。仅 stage==="queued" 携带。
       * ★ 2026-08-14 队列化：连点 N 个 mod 下载不再 409，全部进队等串行跑。
       * 前端用此字段显示「排队中（前 X 个）」。
       */
      queuePos?: number;
      /** 排队总长度（per-staging 队列的等待中 + 正在跑 任务总数）。 */
      queueTotal?: number;
      /**
       * 当前正在下载的 fileId（仅 mod 下载任务携带）。SteamCMD 一次可下载多个 mod，
       * 但 stdout 解析「Downloading item <id>...」可识别当前进度属于哪个 mod——前端按
       * fileId 各自显示进度条。
       */
      currentFileId?: string;
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
