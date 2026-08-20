import { useState, useCallback, useRef, useEffect } from "react";
import {
  Terminal as TerminalIcon,
  Send,
  Trash2,
  AlertTriangle,
  Save,
  Power,
  Megaphone,
  Users,
  UserMinus,
  Sun,
  Moon,
  Package,
  HelpCircle,
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
import { DialogShell } from "../components/shared/DialogShell.js";
import { Terminal } from "../components/console/Terminal.js";
import { HudDecoration } from "../components/shared/HudDecoration.js";
import { toast } from "sonner";

// ─── 预设命令 ──────────────────────────────────────────

interface PresetCommand {
  label: string;
  command: string;
  dangerous?: boolean;
  icon: typeof Megaphone;
}

// 存档/关服已从预设命令升级为带确认的 ACK 操作按钮（ws-wrapper-design §2.5/§6 阶段 4）
const PRESET_COMMANDS: PresetCommand[] = [
  { label: "广播", command: "Say ", icon: Megaphone },
  { label: "玩家列表", command: "Players", icon: Users },
  { label: "踢出", command: "Kick ", dangerous: true, icon: UserMinus },
  { label: "白天", command: "Day", icon: Sun },
  { label: "黑夜", command: "Night", icon: Moon },
  { label: "空投", command: "Airdrop", icon: Package },
  { label: "帮助", command: "Help", icon: HelpCircle },
];

/** ACK 关服默认倒计时（秒）——对齐 SOP 重启流水线 Shutdown 10 */
const DEFAULT_SHUTDOWN_DELAY_S = 10;

// ─── Console 页面 ──────────────────────────────────────

/**
 * Console 页面——Figma 2:3 🎨 Console。
 *
 * 输出区用 xterm.js <Terminal /> 渲染——U3DS 的 ANSI 彩色日志天然着色；
 * 终端里可直接键盘交互（onData → WS terminal_input → PTY stdin）。
 * 上方是「预设命令 + 清空 + 服务器切换」，底部是「输入框 + 发送」——所有命令
 * 经 WS terminal_input 写入 PTY 终端（owner-trust 模型），危险指令由前端
 * ConfirmDialog 拦截。
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
  // ACK 操作的确认弹窗 + 进行中状态
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

  // 发送命令——sendCommand 经 WS terminal_input 写入 PTY
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

      // 手敲 Shutdown 命令确认后走 ACK——用户能拿到「服务端已停止 / 关服超时」的明确反馈。
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
            {/* 服务器未运行时明确提示——PTY 没跑时敲命令静默丢失 */}
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
        {PRESET_COMMANDS.map(({ label, command, dangerous, icon: Icon }) => (
          <button
            key={label}
            onClick={() => {
              if (dangerous) {
                setShowConfirm(command);
              } else {
                setInput(command);
                inputRef.current?.focus();
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors hover:opacity-90"
            style={{
              backgroundColor: dangerous ? "#EF444420" : "#1E293B",
              color: dangerous ? "#EF4444" : "#94A3B8",
              border: `1px solid ${dangerous ? "#EF444440" : "#334059"}`,
            }}
            title={dangerous ? "危险指令——点击弹确认框" : undefined}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
        <div className="flex-1" />
        {/* ACK 操作按钮——有明确成功/失败反馈 */}
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

      {/* ── Output：xterm.js 终端 ── */}
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
      <div
        className="flex items-center gap-2 shrink-0 rounded-md px-3 py-2 transition-colors"
        style={{
          backgroundColor: "#0F172A",
          border: "1px solid #334059",
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = "#22C55E";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = "#334059";
        }}
      >
        <TerminalIcon size={14} style={{ color: "#22C55E" }} className="shrink-0" />
        <span style={{ color: "#22C55E" }} className="text-xs font-mono">
          &gt;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-xs font-mono"
          style={{ color: "#F1F5FB" }}
          placeholder="输入命令后回车发送（写入控制台）"
          aria-label="控制台命令输入"
          spellCheck={false}
          autoComplete="off"
        />
        {input.trim() && (
          <button
            onClick={() => handleSend()}
            aria-label="发送命令"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: "#22C55E",
              color: "#0F172A",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#16A34A";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#22C55E";
            }}
          >
            <Send size={12} />
            发送
          </button>
        )}
      </div>

      {/* 危险指令二次确认——含参数输入框（部分指令如 Kick/Ban/Slay 需 SteamID） */}
      <DangerCommandDialog
        open={!!showConfirm}
        command={showConfirm}
        onConfirm={(finalCommand) => handleSend(finalCommand)}
        onCancel={() => setShowConfirm("")}
      />

      {/* ACK 操作的确认弹窗——有明确成功/失败反馈 */}
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

/**
 * 危险指令二次确认弹窗——含参数输入框。
 *
 * 部分危险指令需要参数（如 `Kick <SteamID64>`、`Ban <SteamID64> <时长>`、`Slay <SteamID64>`），
 * 用户可在弹窗内填参数，确认后整条命令直接发送。无参数的危险指令（如 `Cheats`）留空发送。
 */
function DangerCommandDialog({
  open,
  command,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  command: string;
  onConfirm: (finalCommand: string) => void;
  onCancel: () => void;
}) {
  const [param, setParam] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时清空参数 + 自动 focus 输入框
  useEffect(() => {
    if (open) {
      setParam("");
      // 延迟一帧让 DialogShell 完成挂载再 focus
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const finalCommand = param.trim() ? `${command}${param.trim()}` : command.trim();
  const isEmpty = !finalCommand;

  return (
    <DialogShell open={open} onClose={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg p-6"
        style={{
          width: 420,
          backgroundColor: "#1E293B",
          border: "1px solid #334059",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={20} style={{ color: "#EF4444" }} />
          <h3 className="text-sm font-medium text-slate-100 m-0">危险指令确认</h3>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          此操作可能影响服务器运行。命令预览：
          <code
            className="ml-1 px-1.5 py-0.5 rounded font-mono"
            style={{ backgroundColor: "#0F172A", color: "#F1F5FB" }}
          >
            {finalCommand || "（空）"}
          </code>
        </p>
        <input
          ref={inputRef}
          type="text"
          value={param}
          onChange={(e) => setParam(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isEmpty) {
              onConfirm(finalCommand);
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          className="w-full rounded-md px-3 py-2 text-xs font-mono outline-none transition-colors"
          style={{
            backgroundColor: "#0F172A",
            border: "1px solid #334059",
            color: "#F1F5FB",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#EF4444";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#334059";
          }}
          placeholder="参数（如 SteamID64），无参数则留空"
          aria-label="危险指令参数输入"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="flex items-center gap-2 justify-end mt-4">
          <button
            onClick={onCancel}
            className="rounded-md text-slate-400 hover:text-slate-200 h-8 px-4 text-xs transition-colors"
            style={{ border: "1px solid #334059" }}
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(finalCommand)}
            disabled={isEmpty}
            className="rounded-md text-white h-8 px-4 text-xs font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#EF4444" }}
            onMouseEnter={(e) => {
              if (!isEmpty) {
                (e.currentTarget as HTMLElement).style.backgroundColor = "#DC2626";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#EF4444";
            }}
          >
            确认执行
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
