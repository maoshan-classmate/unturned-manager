import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Play, Square, RefreshCw, Save, Edit3, Loader2 } from "lucide-react";
import { Card } from "../shared/Card.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { apiClient } from "@/api/client";
import { useServer, useServerActions } from "@/hooks/useServer";
import { stateColor, formatStateBadge } from "@/lib/utils";
import { LaunchCommandsDialog } from "./LaunchCommandsDialog.js";

interface ServerControlCardProps {
  serverId: string;
  serverName: string;
  serverState: string;
  gamePort: number;
  queryPort?: number;
  commands: string;
  onCommandsSaved?: (commands: string) => void;
  /** U3DS 启动命令（ADR-0004 Phase 4）——持久化到 settings K-V */
  startCommand?: string;
  /** startCommand 持久化成功后的回调——父组件用于更新本地状态（可选） */
  onStartCommandSaved?: (startCommand: string) => void;
}

/**
 * Card - Server Control:Figma 9:15564 — 实例/运行状态/端口/启动命令 + 4 按钮。
 * 启动 / 停止 / 重启 走 useServerActions,删除/重启走 ConfirmDialog 二次确认。
 * "保存命令"按钮在 commands dirty 时才显示。
 *
 * ADR-0004 Phase 4：原硬编码「默认命令」span 改为 Input + 保存按钮（inline 编辑 startCommand），
 * 下方 LaunchCommandsDialog 入口改为「Commands.dat 参数」文案，避免与新加 Input 混淆。
 */
export function ServerControlCard({
  serverId,
  serverName,
  serverState,
  gamePort,
  queryPort,
  commands,
  onCommandsSaved,
  startCommand = "",
  onStartCommandSaved,
}: ServerControlCardProps) {
  const { start, stop, restart, pendingId } = useServerActions();
  const { updateServer } = useServer();
  const [draft, setDraft] = useState(commands);
  const [startCommandDraft, setStartCommandDraft] = useState(startCommand);
  const [startCommandSaving, setStartCommandSaving] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [commandsDialogOpen, setCommandsDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(commands);
  }, [commands]);
  useEffect(() => {
    setStartCommandDraft(startCommand);
  }, [startCommand]);

  const dirty = draft !== commands;
  const startCommandDirty = startCommandDraft !== startCommand;
  const pending = pendingId === serverId;
  const isRunning = serverState === "RUNNING";

  const handleStart = async () => {
    setActionError(null);
    try {
      await start(serverId);
      toast.success("已提交启动");
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "启动失败");
    }
  };

  const handleStop = async () => {
    setActionError(null);
    try {
      await stop(serverId);
      toast.success("已提交停止");
      setStopConfirmOpen(false);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "停止失败");
    }
  };

  const handleRestart = async () => {
    setActionError(null);
    try {
      await restart(serverId);
      toast.success("已提交重启");
      setRestartConfirmOpen(false);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "重启失败");
    }
  };

  const handleSaveCommands = async () => {
    setActionError(null);
    try {
      await apiClient.put(`/servers/${serverId}/config/commands`, {
        commands: draft,
      });
      toast.success("命令已保存");
      onCommandsSaved?.(draft);
    } catch (e: unknown) {
      const msg = (
        e as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      setActionError(msg ?? (e instanceof Error ? e.message : "保存失败"));
    }
  };

  // ADR-0004 Phase 4：startCommand 持久化走 PATCH /servers/:id，dirty 才允许保存
  const handleSaveStartCommand = async () => {
    if (!startCommandDirty) return;
    setActionError(null);
    setStartCommandSaving(true);
    try {
      await updateServer(serverId, { startCommand: startCommandDraft });
      toast.success("启动命令已保存");
      onStartCommandSaved?.(startCommandDraft);
    } catch (e: unknown) {
      const msg = (
        e as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      setActionError(
        msg ?? (e instanceof Error ? e.message : "保存启动命令失败"),
      );
    } finally {
      setStartCommandSaving(false);
    }
  };

  return (
    <>
      <Card icon={Play} title="服务器控制">
        <div className="space-y-2 text-sm text-slate-400">
          <div className="flex items-center justify-between">
            <span>
              实例:<span className="text-slate-100 ml-1">{serverName}</span>
            </span>
            <span
              className="text-xs font-medium tracking-wider"
              style={{ color: stateColor(serverState) }}
            >
              {formatStateBadge(serverState)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-slate-500 shrink-0">端口</span>
            <span className="text-slate-100">
              {gamePort}(游戏){queryPort ? ` / ${queryPort}(查询)` : ""}
            </span>
          </div>
          {/* ADR-0004 Phase 4：startCommand 可编辑输入框（替代硬编码 span） */}
          <div className="flex items-center gap-2">
            <span className="w-16 text-slate-500 shrink-0">启动命令</span>
            <Input
              value={startCommandDraft}
              onChange={(e) => setStartCommandDraft(e.target.value)}
              placeholder={`./ServerHelper.sh +InternetServer/${serverId} -ThreadedConsole`}
              disabled={startCommandSaving}
              className="h-7 text-xs font-mono flex-1"
              spellCheck={false}
              aria-label="Unturned 服务端启动命令"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSaveStartCommand}
              disabled={!startCommandDirty || startCommandSaving}
              className="h-7 text-sm gap-1"
              aria-label="保存启动命令"
            >
              {startCommandSaving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              保存
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Button
            size="sm"
            variant="glow"
            animation="glow-pulse"
            onClick={handleStart}
            disabled={pending || isRunning}
            className="h-9 text-sm gap-1"
          >
            {pending && !isRunning ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}{" "}
            启动
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStopConfirmOpen(true)}
            disabled={pending || !isRunning}
            className="h-9 text-sm gap-1"
          >
            <Square size={12} /> 停止
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRestartConfirmOpen(true)}
            disabled={pending || !isRunning}
            className="h-9 text-sm gap-1"
          >
            <RefreshCw size={12} /> 重启
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSaveCommands}
            disabled={!dirty}
            className="h-9 text-sm gap-1"
          >
            <Save size={12} /> 保存
          </Button>
        </div>

        {actionError && (
          <p className="text-sm mt-2" style={{ color: "#EF4444" }}>
            {actionError}
          </p>
        )}

        {/* ADR-0004 Phase 4：LaunchCommandsDialog 入口文案调整为「Commands.dat 参数」，
            避免与上方新加的「启动命令」Input 混淆（Commands.dat 是游戏内指令列表，
            与 PTY 启动 bash 命令是两件事）。 */}
        <div className="mt-4 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 flex items-center gap-2">
          <span className="text-sm text-slate-500 shrink-0">
            Commands.dat 参数
          </span>
          <span className="text-sm font-mono text-slate-300 truncate flex-1">
            {draft}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCommandsDialogOpen(true)}
            className="h-7 text-sm gap-1"
          >
            <Edit3 size={12} /> 编辑
          </Button>
        </div>
      </Card>

      <LaunchCommandsDialog
        open={commandsDialogOpen}
        serverId={serverId}
        currentCommands={commands}
        onClose={() => setCommandsDialogOpen(false)}
        onSaved={(next) => {
          setDraft(next);
          onCommandsSaved?.(next);
        }}
      />

      <ConfirmDialog
        open={stopConfirmOpen}
        title="停止服务器"
        message={`确定停止 ${serverName} 吗?在线玩家会被强制下线。`}
        confirmLabel="停止"
        variant="danger"
        loading={pending}
        onConfirm={handleStop}
        onCancel={() => setStopConfirmOpen(false)}
      />

      <ConfirmDialog
        open={restartConfirmOpen}
        title="重启服务器"
        message={`确定重启 ${serverName} 吗?重启期间玩家无法连接。`}
        confirmLabel="重启"
        variant="danger"
        loading={pending}
        onConfirm={handleRestart}
        onCancel={() => setRestartConfirmOpen(false)}
      />
    </>
  );
}
