import type { ServerId } from "../types/branded.js";

/**
 * 前端 → 后端的 WS 客户端消息（与 broadcast.ts 的服务端 → 前端事件对称）。
 *
 * ADR-0004 §2.4/§3.4：terminal_input 走 owner-trust 模型——WS verifyClient 已校验
 * access token（JWT 有效 = 可在终端执行任何命令），此处不做危险指令门控。
 * 危险指令的二次确认由前端 ConsolePage 的 ConfirmDialog 实现（rcon-protocol.md addendum）。
 */
export type ClientWsMessage =
  | {
      type: "subscribe";
      serverIds: ServerId[];
      eventTypes: string[] | null;
    }
  | {
      /**
       * 把任意字符串写入对应 serverId 的 PTY stdin（xterm.js onData 的原始输入）。
       * 不做命令解析/校验——PTY 终端是 owner 自己用的（owner-trust 模型）。
       */
      type: "terminal_input";
      serverId: ServerId;
      /** 原始输入字节（xterm onData 给的就是用户敲的字符 / 回车 / 控制序列） */
      data: string;
    }
  | ClientWsRequestMessage;

/**
 * 请求-应答模式消息（ws-wrapper-design §2.2：ACK 语义）。
 *
 * 与 fire-and-forget 的 terminal_input 不同——这三类消息带 requestId，
 * 服务端处理完（或业务失败）后必须回一个同 requestId 的 `ack` 事件
 * （broadcast.ts 的 ServerEvent 扩展）。前端 WebSocketContext.request()
 * 凭 requestId 匹配 Promise，默认 30s 本地超时。
 *
 * 关键约束：
 * - requestId 由前端 `crypto.randomUUID()` 生成（UUID v4，冲突概率 2^-122）
 * - 同一连接内 requestId 唯一；服务端对每个 requestId 最多回一个 ack
 * - delaySeconds 仅 shutdown 使用（对齐 SOP 的 `Shutdown <秒> "<原因>"` 写法）
 */
export type ClientWsRequestMessage =
  | {
      /** 关闭控制台进程（owner-trust 核选项：服务端进程会被终止，不自动存档） */
      type: "terminal_close";
      serverId: ServerId;
      requestId: string;
    }
  | {
      /** 触发存档并等控制台输出「保存完成」信号后回 ack */
      type: "save";
      serverId: ServerId;
      requestId: string;
    }
  | {
      /** 优雅关服并等控制台进程退出后回 ack */
      type: "shutdown";
      serverId: ServerId;
      requestId: string;
      /** U3DS Shutdown 命令的倒计时秒数（服务端做范围钳制） */
      delaySeconds: number;
      /** 关服原因（广播给在线玩家）；缺省时服务端用默认文案 */
      reason?: string;
    };
