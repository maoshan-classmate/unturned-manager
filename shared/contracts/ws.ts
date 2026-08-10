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
       * 不做命令解析/校验——PTY 终端是 owner 自己用的（GSM3 同款 owner-trust）。
       */
      type: "terminal_input";
      serverId: ServerId;
      /** 原始输入字节（xterm onData 给的就是用户敲的字符 / 回车 / 控制序列） */
      data: string;
    };
