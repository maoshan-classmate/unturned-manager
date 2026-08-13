import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * xterm.js 终端包装组件（ADR-0004 §2.5 Phase 3）。
 *
 * 把 U3DS 的 ANSI 彩色日志渲染成真终端：lines 增量写入 terminal，用户键盘输入经
 * onInput 透传 PTY stdin（PTY 自回显，组件不回显）。容器 resize 时 FitAddon 自动 fit。
 *
 * 是 ConsolePage 的专属组件（组件存放规范：只被一个页面用 → components/<feature>/）。
 * 项目暗色主题对齐全局色值（component-abstraction.md），禁止新色值。
 *
 * @param props - 组件属性
 * @param props.lines - console_line 输出数组，内部按上次长度增量写入（不重灌全量）；
 *   clearLines 导致长度骤减时先 clear 重置游标
 * @param props.onInput - 用户键盘输入回调（xterm onData 原始字节，PTY 自回显）
 * @param props.connected - 是否已连接 WS，未连接时禁用输入
 * @returns xterm.js 容器 div 的 React 元素
 *
 * @example
 * ```tsx
 * <Terminal lines={lines} onInput={sendTerminalInput} connected={connected} />
 * ```
 */

/** Terminal 组件属性 */
interface TerminalProps {
  /** console_line 输出数组——内部按上次长度增量写入（不重灌全量） */
  lines: { id: number; text: string; source: string }[];
  /** 用户键盘输入回调（xterm onData 原始字节，PTY 自回显） */
  onInput?: (data: string) => void;
  /** 是否已连接 WS——未连接时禁用输入 */
  connected: boolean;
}

/** xterm 主题——对齐全局色值常量（component-abstraction.md） */
const THEME = {
  background: "#0F172A", // 页面/输入框背景
  foreground: "#F1F5FB", // ★ 2026-08-14：从 #94A3B8（次级文本）提亮为主文本——命令响应（如 "Successfully set time to day!"）更易读
  cursor: "#22C55E", // 强调色
  cursorAccent: "#0F172A",
  selectionBackground: "#334059", // 边框/选中
  black: "#1E293B",
  red: "#EF4444",
  green: "#22C55E",
  yellow: "#F59E0B",
  blue: "#3B82F6",
  magenta: "#A855F7",
  cyan: "#06B6D4",
  white: "#F1F5FB", // 主文本
  brightBlack: "#64748B", // 弱化文本
};

export function Terminal({ lines, onInput, connected }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // 上次写入的 lines 长度——增量写入只写新增段
  const writtenRef = useRef(0);
  // onInput 最新引用——注册一次 onData，回调走 ref 避免重复订阅
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  // 初始化 xterm + fit addon + onData 订阅（一次）
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      theme: THEME,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: false, // console_line 已按行切分，不加 CR
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
      writtenRef.current = 0;
    };
  }, []);

  // connected 变化 → 禁用/启用输入
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.disableStdin = !connected;
    }
  }, [connected]);

  // lines 增量写入（clearLines 时长度骤减 → 先 clear 重置游标）
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (lines.length < writtenRef.current) {
      term.clear();
      writtenRef.current = 0;
    }
    for (let i = writtenRef.current; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // ★ 2026-08-14 修复：不再跳过 input 行——用户发送的命令必须在终端可见，
      // 否则命令无响应时用户连自己敲了什么都不知道（原跳过导致「输入无反馈」视觉缺失）。
      term.writeln(line.text);
    }
    writtenRef.current = lines.length;
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden rounded-lg font-mono text-xs"
      style={{ backgroundColor: "#0F172A", border: "1px solid #334059" }}
      data-testid="terminal-container"
    />
  );
}
