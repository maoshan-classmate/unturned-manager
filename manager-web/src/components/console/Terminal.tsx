import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * xterm.js 终端包装组件。
 *
 * 输出由 useConsole 通过 onReady 暴露的 xterm 实例直接写入（PTY raw chunks），
 * 不再走 lines 数组增量渲染——后者会把 ESC 转义序列切碎、xterm 状态机无法自愈。
 * 容器 resize 时 FitAddon 自动 fit。
 *
 * 是 ConsolePage 的专属组件（组件存放规范：只被一个页面用 → components/<feature>/）。
 * 项目暗色主题对齐全局色值（component-abstraction.md），禁止新色值。
 *
 * @param props - 组件属性
 * @param props.onReady - xterm 实例初始化完成时回调，父组件保存到 ref 后可直接 term.write(...)
 * @param props.onInput - 用户键盘输入回调（xterm onData 原始字节，PTY 自回显）
 * @param props.connected - 是否已连接 WS，未连接时禁用输入
 * @returns xterm.js 容器 div 的 React 元素
 *
 * @example
 * ```tsx
 * const termRef = useRef<XTerm | null>(null);
 * <Terminal
 *   onReady={(t) => { termRef.current = t; }}
 *   onInput={sendTerminalInput}
 *   connected={connected}
 * />
 * ```
 */
interface TerminalProps {
  /** xterm 实例初始化完成时回调，父组件保存到 ref 后可直接 term.write(...) */
  onReady?: (term: XTerm) => void;
  /** 用户键盘输入回调（xterm onData 原始字节，PTY 自回显） */
  onInput?: (data: string) => void;
  /** 是否已连接 WS——未连接时禁用输入 */
  connected: boolean;
}

/** xterm 主题——对齐全局色值常量（component-abstraction.md） */
const THEME = {
  background: "#0F172A",
  foreground: "#F1F5FB",
  cursor: "#22C55E",
  cursorAccent: "#0F172A",
  selectionBackground: "#334059",
  black: "#1E293B",
  red: "#EF4444",
  green: "#22C55E",
  yellow: "#F59E0B",
  blue: "#3B82F6",
  magenta: "#A855F7",
  cyan: "#06B6D4",
  white: "#F1F5FB",
  brightBlack: "#64748B",
};

export function Terminal({ onReady, onInput, connected }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // onInput / onReady 最新引用——注册一次 onData，回调走 ref 避免重复订阅
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // 初始化 xterm + fit addon + onData 订阅（一次）
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      theme: THEME,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      // convertEol: true 让 xterm 把 \n 自动转 \r\n——服务端推来的 chunk 字符串
      // 不保证行尾形式（PTY 原始字节流可能含 \n、\r\n、或仅 \r），xterm 内部按
      // 标准终端规则归一
      convertEol: true,
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // 首次 fit（容器可能尚未有尺寸，下一帧再 fit 一次兜底）
    fit.fit();
    const frame = requestAnimationFrame(() => fit.fit());

    // 把 xterm 实例暴露给父组件（用于直接 write chunk）
    onReadyRef.current?.(term);

    // 用户输入透传 PTY stdin（owner-trust，PTY 自回显）
    const dataSub = term.onData((data) => {
      onInputRef.current?.(data);
    });

    // 容器尺寸变化 → fit
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* 容器隐藏时 fit 可能报 0 尺寸，忽略 */
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(frame);
      dataSub.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // connected 变化 → 禁用/启用输入
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.disableStdin = !connected;
    }
  }, [connected]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden rounded-lg font-mono text-xs"
      style={{ backgroundColor: "#0F172A", border: "1px solid #334059" }}
      data-testid="terminal-container"
    />
  );
}