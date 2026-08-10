import { useState, useCallback, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  Terminal as TerminalIcon,
  Send,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useServer } from "../hooks/useServer.js";
import { useConsole } from "../hooks/useConsole.js";
import { Button } from "../components/ui/button.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.js";
import { Terminal } from "../components/console/Terminal.js";

// ─── 预设命令 ──────────────────────────────────────────

interface PresetCommand {
  label: string;
  command: string;
  dangerous?: boolean;
}

const PRESET_COMMANDS: PresetCommand[] = [
  { label: "广播", command: "Say " },
  { label: "存档", command: "Save" },
  { label: "玩家列表", command: "Players" },
  { label: "踢出", command: "Kick ", dangerous: true },
  { label: "白天", command: "Day" },
  { label: "黑夜", command: "Night" },
  { label: "空投", command: "Airdrop" },
  { label: "关服", command: "Shutdown ", dangerous: true },
  { label: "帮助", command: "Help" },
];

// ─── Console 页面 ──────────────────────────────────────

/**
 * Console 页面——Figma 2:3 🎨 Console。
 *
 * ADR-0004 Phase 3：输出区从 <pre> 换 xterm.js <Terminal />——U3DS 的 ANSI 彩色
 * 日志天然渲染；终端里可直接键盘交互（onData → WS terminal_input → PTY stdin）。
 * 上方保留「预设命令 + 清空 + 服务器切换」，底部保留「输入框 + 发送」——所有命令
 * 经 WS terminal_input 写入 PTY 终端（ADR-0004 Phase 6：RCON 通道已删，owner-trust
 * 模型），危险指令由前端 ConfirmDialog 拦截（owner-trust 下无服务端 428 门控）。
 */
export function ConsolePage() {
  const { serverId } = useParams<{ serverId: string }>();
  const activeServerId = serverId ?? "_default";
  const { servers } = useServer();
  const { lines, sendCommand, clearLines, connected, sendTerminalInput } =
    useConsole(activeServerId);

  const [input, setInput] = useState("");
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [showConfirm, setShowConfirm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const commandHistory = useRef<string[]>([]);

  // 发送命令（ADR-0004 Phase 6：RCON 通道已删——sendCommand 经 WS terminal_input 写入 PTY）
  const handleSend = useCallback(
    async (cmd?: string) => {
      const command = (cmd ?? input).trim();
      if (!command) return;

      // 危险指令确认
      const cmdName = command.split(/\s+/)[0]?.toLowerCase() ?? "";
      const isDangerous = [
        "shutdown",
        "ban",
        "slay",
        "resetconfig",
        "unadmin",
        "unban",
        "cheats",
      ].includes(cmdName);

      if (isDangerous && showConfirm !== command) {
        setShowConfirm(command);
        return;
      }

      setShowConfirm("");
      commandHistory.current.push(command);
      setInput("");
      setHistoryIdx(-1);

      await sendCommand(command, isDangerous);
    },
    [input, sendCommand, showConfirm],
  );

  // 键盘处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (showConfirm) {
          // 再按一次 Enter 确认执行
          handleSend(showConfirm);
        } else {
          handleSend();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.min(
          historyIdx + 1,
          commandHistory.current.length - 1,
        );
        setHistoryIdx(next);
        if (commandHistory.current.length > 0) {
          setInput(
            commandHistory.current[commandHistory.current.length - 1 - next] ??
              "",
          );
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.max(historyIdx - 1, -1);
        setHistoryIdx(next);
        setInput(
          next === -1
            ? ""
            : (commandHistory.current[
                commandHistory.current.length - 1 - next
              ] ?? ""),
        );
      } else if (e.key === "Escape") {
        setShowConfirm("");
      }
    },
    [handleSend, historyIdx, showConfirm],
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ── TopBar ── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <TerminalIcon size={20} style={{ color: "#22C55E" }} />
          <h1
            className="text-xl font-semibold m-0"
            style={{ color: "#F1F5FB" }}
          >
            控制台
          </h1>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: connected ? "#22C55E" : "#64748B" }}
            />
            <span className="text-xs" style={{ color: "#64748B" }}>
              {connected ? "WebSocket 已连接" : "WebSocket 未连接"}
            </span>
          </div>
        </div>

        {/* Server switcher */}
        <div className="flex items-center gap-1">
          {servers.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                // Navigate to new serverId (handled by parent)
                window.location.hash = `/${s.id}/console`;
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors"
              style={{
                backgroundColor:
                  s.id === serverId ? "#22C55E20" : "transparent",
                color: s.id === serverId ? "#22C55E" : "#94A3B8",
                border: `1px solid ${s.id === serverId ? "#22C55E40" : "#334155"}`,
              }}
            >
              {s.name || s.id}
            </button>
          ))}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
        {PRESET_COMMANDS.map(({ label, command, dangerous }) => (
          <button
            key={label}
            onClick={() => {
              setInput(command);
              inputRef.current?.focus();
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors"
            style={{
              backgroundColor: dangerous ? "#EF444420" : "#1E293B",
              color: dangerous ? "#EF4444" : "#94A3B8",
              border: `1px solid ${dangerous ? "#EF444440" : "#334155"}`,
            }}
            title={dangerous ? "危险指令，需二次确认" : undefined}
          >
            {dangerous && <AlertTriangle size={11} />}
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={clearLines}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors"
          style={{
            backgroundColor: "#1E293B",
            color: "#64748B",
            border: "1px solid #334155",
          }}
          title="清空输出"
        >
          <Trash2 size={12} />
          清空
        </button>
      </div>

      {/* ── Output：xterm.js 终端（Phase 3） ── */}
      <Terminal
        lines={lines}
        onInput={sendTerminalInput}
        connected={connected}
      />

      {/* ── Input ── */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex-1 flex items-center gap-2">
          <span style={{ color: "#22C55E" }}>&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none outline-none text-xs font-mono"
            style={{ color: "#F1F5FB" }}
            placeholder="输入命令...（写入服务器终端）"
            aria-label="控制台命令输入"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <Button
          onClick={() => handleSend()}
          disabled={!input.trim()}
          className="h-7 gap-1 text-xs"
          style={{ backgroundColor: "#22C55E", color: "#F1F5FB" }}
        >
          <Send size={12} />
          发送
        </Button>
      </div>

      <ConfirmDialog
        open={!!showConfirm}
        title="危险指令确认"
        message={`确认执行 "${showConfirm}"？此操作可能影响服务器运行。`}
        confirmLabel="确认执行"
        variant="danger"
        icon={AlertTriangle}
        onConfirm={() => {
          handleSend(showConfirm);
        }}
        onCancel={() => setShowConfirm("")}
      />
    </div>
  );
}
