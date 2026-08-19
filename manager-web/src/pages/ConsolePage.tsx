import { useState, useCallback, useRef } from "react";
import {
  Terminal as TerminalIcon,
  Send,
  Trash2,
  AlertTriangle,
  Save,
  Power,
} from "lucide-react";
import { Terminal as XTerm } from "@xterm/xterm";
import { useServer } from "../hooks/useServer.js";
import { useRequireServer } from "../hooks/useRequireServer.js";
import { useCurrentServer } from "../contexts/CurrentServerContext.js";
import { useConsole } from "../hooks/useConsole.js";
import { useSessionManager } from "../hooks/useSessionManager.js";
import { Button } from "../components/ui/button.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.js";
import { NoInstanceGuide } from "../components/shared/NoInstanceGuide.js";
import { Terminal } from "../components/console/Terminal.js";
import { HudDecoration } from "../components/shared/HudDecoration.js";
import { toast } from "sonner";

// ─── 预设命令 ──────────────────────────────────────────

interface PresetCommand {
  label: string;
  command: string;
  dangerous?: boolean;
}

// 存档/关服已从预设命令升级为带确认的 ACK 操作按钮（ws-wrapper-design §2.5/§6 阶段 4）
const PRESET_COMMANDS: PresetCommand[] = [
  { label: "广播", command: "Say " },
  { label: "玩家列表", command: "Players" },
  { label: "踢出", command: "Kick ", dangerous: true },
  { label: "白天", command: "Day" },
  { label: "黑夜", command: "Night" },
  { label: "空投", command: "Airdrop" },
  { label: "帮助", command: "Help" },
];

/** ACK 关服默认倒计时（秒）——对齐 SOP 重启流水线 Shutdown 10 */
const DEFAULT_SHUTDOWN_DELAY_S = 10;

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
/**
 * 守卫壳组件——只做实例守卫，业务 hooks 全在 ConsoleContent 内。
 * 无实例时内容区渲染占位卡（NoInstanceGuide）引导去创建，统一走 PageState 显示加载中。
 * React hooks 规则：所有 hook 必须无条件按固定顺序调用；这里提前 return 只影响
 * 本组件（不调业务 hooks），业务 hooks 在 ConsoleContent 内稳定执行。
 */
export function ConsolePage() {
  const guard = useRequireServer();

  // Provider 化后实例列表已在 AppLayout 顶层加载完成——守卫壳只处理 empty/missing/ready 三态
  if (guard.status !== "ready") {
    return (
      <NoInstanceGuide
        reason={guard.status === "missing" ? "missing" : "empty"}
      />
    );
  }

  return <ConsoleContent serverId={guard.serverId} />;
}

/**
 * 控制台内容组件——持有全部业务 hooks 与 JSX。
 * serverId 由守卫壳校验后传入，此处恒有效；hooks 无条件执行（修复 React #310）。
 */
function ConsoleContent({ serverId }: { serverId: string }) {
  const { servers } = useServer();
  const { setCurrentServerId } = useCurrentServer();

  const currentServer = servers.find((s) => s.id === serverId);
  const isServerRunning = currentServer?.state === "RUNNING";
  // 拉取已保存的终端会话列表（面板重启后保留 tab 列表）
  const { saved: savedSessions } = useSessionManager();
  // xterm 实例由 Terminal 组件 onReady 暴露，写入回调包成 sinks 注入 useConsole
  const termRef = useRef<XTerm | null>(null);
  const {
    sendCommand,
    clearLines,
    connected,
    sendTerminalInput,
    save,
    shutdown,
  } = useConsole(serverId, {
    onChunk: (chunk) => termRef.current?.write(chunk),
    onLine: (line) => termRef.current?.write(line),
    onClear: () => termRef.current?.clear(),
  });

  const [input, setInput] = useState("");
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [showConfirm, setShowConfirm] = useState("");
  // ★ ws-wrapper-design §6 阶段 4：ACK 操作的确认弹窗 + 进行中状态
  const [confirmAction, setConfirmAction] = useState<"shutdown" | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandHistory = useRef<string[]>([]);

  /** ACK 调用的统一反馈：业务错误/超时/断线都弹人话 toast（界面文案规范） */
  const runAck = useCallback(
    async (
      actionKey: string,
      run: () => Promise<{ ok: boolean; error?: { message: string } }>,
      okMessage: string,
    ) => {
      setPendingAction(actionKey);
      try {
        const result = await run();
        if (result.ok) {
          toast.success(okMessage);
        } else {
          toast.error(result.error?.message ?? "操作失败");
        }
      } catch (err) {
        // 超时 / 断线 reject——message 是 WebSocketContext 给的中文
        toast.error(err instanceof Error ? err.message : "操作失败");
      } finally {
        setPendingAction(null);
      }
    },
    [],
  );

  /** 存档（ACK）——等服务端确认看到保存完成信号 */
  const handleSave = useCallback(() => {
    void runAck("save", save, "存档完成");
  }, [runAck, save]);

  /**
   * 关服（ACK）——先存档再倒计时关服，等服务端确认进程退出。
   * delaySeconds 客户端钳制 0–600（服务端同规则二次钳制）。
   */
  const handleShutdown = useCallback(
    (delaySeconds: number, reason?: string) => {
      const delay = Math.min(Math.max(Math.trunc(delaySeconds) || 0, 0), 600);
      const toastId = toast.loading(`正在关服（${delay} 秒倒计时）…`);
      void runAck(
        "shutdown",
        () => shutdown(delay, reason),
        "服务端已停止",
      ).finally(() => toast.dismiss(toastId));
    },
    [runAck, shutdown],
  );

  /** 关闭控制台进程（ACK）——核选项：服务端进程被终止且不自动存档 */
  // ★ 2026-08-14 移除：「关闭控制台」按钮已删除。理由：U3DS 服务进程就是 PTY 终端
  // owner——终止它等于停服，与「关服」功能重复且更危险（不存档不倒计时）。
  // 若 PTY 真卡死，运维应去宿主机排查而非面板提供更激进的终止路径。

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

      // ★ ws-wrapper-design §6 阶段 4：手敲 Shutdown 命令确认后走 ACK——
      // 用户能拿到「服务端已停止 / 关服超时」的明确反馈，不再是发了就干等。
      if (cmdName === "shutdown") {
        const parts = command.split(/\s+/).slice(1);
        let delaySeconds = DEFAULT_SHUTDOWN_DELAY_S;
        const first = parts[0];
        if (first !== undefined && /^\d+$/.test(first)) {
          delaySeconds = parseInt(parts.shift() ?? "", 10);
        }
        const reason =
          parts.join(" ").replace(/^"|"$/g, "").trim() || undefined;
        handleShutdown(delaySeconds, reason);
        return;
      }

      await sendCommand(command, isDangerous);
    },
    [input, sendCommand, showConfirm, handleShutdown],
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
              {connected ? "控制台已连接" : "控制台未连接"}
            </span>
            {/* ★ S4 修复：服务器未运行时明确提示——PTY 没跑时敲命令静默丢失 */}
            {currentServer && !isServerRunning && (
              <span className="text-xs" style={{ color: "#EF4444" }}>
                · 当前服务器未运行（状态：{currentServer.state ?? "未知"}），请先启动
              </span>
            )}
          </div>
        </div>

        {/* Server switcher */}
        <div className="flex items-center gap-1">
          {servers.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setCurrentServerId(s.id);
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

      {/* ADR-0005 Phase 7.2：已保存的终端会话（PTY 已断开的会话列表） */}
      {savedSessions.length > 0 && (
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <span className="text-xs" style={{ color: "#64748B" }}>
            历史控制台:
          </span>
          {savedSessions
            .filter((s) => s.id !== serverId)
            .map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  toast.error("这个控制台已经断开，点「启动」重新打开", {
                    duration: 4000,
                  });
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors"
                style={{
                  backgroundColor: "transparent",
                  color: "#64748B",
                  border: "1px dashed #334155",
                }}
                title={`最后活跃: ${new Date(s.lastActivity).toLocaleString("zh-CN")}`}
              >
                <TerminalIcon size={11} />
                {s.name || s.id}
              </button>
            ))}
        </div>
      )}

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
        {/* ★ ws-wrapper-design §6 阶段 4：ACK 操作按钮——有明确成功/失败反馈 */}
        <button
          onClick={handleSave}
          disabled={pendingAction !== null}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "#1E293B",
            color: "#94A3B8",
            border: "1px solid #334155",
          }}
          title="保存世界数据到磁盘（等服务端确认）"
        >
          <Save size={12} />
          {pendingAction === "save" ? "存档中…" : "存档"}
        </button>
        <button
          onClick={() => setConfirmAction("shutdown")}
          disabled={pendingAction !== null}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "#EF444420",
            color: "#EF4444",
            border: "1px solid #EF444440",
          }}
          title={`先存档，再倒计时 ${DEFAULT_SHUTDOWN_DELAY_S} 秒关服（等服务端确认）`}
        >
          <AlertTriangle size={11} />
          <Power size={12} />
          关服
        </button>
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
      <div className="relative flex-1 min-h-0">
        <HudDecoration intensity="normal" />
        <Terminal
          onReady={(term) => {
            termRef.current = term;
          }}
          onInput={sendTerminalInput}
          connected={connected}
        />
      </div>

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
            placeholder="输入命令...（写入控制台）"
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

      {/* ★ ws-wrapper-design §6 阶段 4：ACK 操作的确认弹窗——有明确成功/失败反馈 */}
      <ConfirmDialog
        open={confirmAction === "shutdown"}
        title="关服确认"
        message={`先保存世界数据，再倒计时 ${DEFAULT_SHUTDOWN_DELAY_S} 秒停止服务端。确认关服？`}
        confirmLabel="确认关服"
        variant="danger"
        icon={Power}
        onConfirm={() => {
          setConfirmAction(null);
          handleShutdown(DEFAULT_SHUTDOWN_DELAY_S);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
