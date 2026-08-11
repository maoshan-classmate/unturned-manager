import type { ServerId, SteamId64 } from "../types/branded.js";
import type { ServerState } from "../types/state.js";

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
    };

export interface IBroadcaster {
  broadcast(event: ServerEvent): void;
  register(ws: WsConnection, serverIds: ServerId[]): void;
  unregister(ws: WsConnection): void;
  destroy(): Promise<void>;
}
