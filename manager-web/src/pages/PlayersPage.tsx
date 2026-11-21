import { useState } from "react";
import { toast } from "sonner";
import {
  Users,
  Shield,
  ShieldOff,
  LogOut,
  Ban,
  RotateCcw,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import type { PlayerAction } from "@unturned-manager/shared";
import { useRequireServer } from "../hooks/useRequireServer.js";
import { usePlayers } from "../hooks/usePlayers.js";
import { PageState } from "../components/shared/PageState.js";
import { NoInstanceGuide } from "../components/shared/NoInstanceGuide.js";
import { Button } from "../components/ui/button.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.js";
import { cn } from "../lib/utils.js";

/** 待确认的操作 */
interface PendingAction {
  /** 玩家 SteamID */
  steamId: string;
  /** 玩家昵称 */
  name: string;
  /** 操作类型 */
  action: PlayerAction;
}

/**
 * 玩家列表页面——展示在线玩家，支持设为管理员、踢出、封禁等操作。
 *
 * 数据来自服务端对游戏日志的解析，5 秒自动刷新一次；服务端停止时显示空态。
 */
export function PlayersPage() {
  const guard = useRequireServer();
  if (guard.status !== "ready") {
    return <NoInstanceGuide reason={guard.status} />;
  }
  return <PlayersContent serverId={guard.serverId} />;
}

/** 页面主体——守卫通过后挂载，避免 Hooks 规则冲突 */
function PlayersContent({ serverId }: { serverId: string }) {
  const { data, loading, error, refresh, act, acting } = usePlayers(serverId);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const players = data?.players ?? [];
  const isLive = data?.live ?? false;

  const handleAction = async () => {
    if (!pending) return;
    const target = pending;
    setConfirmOpen(false);
    setPending(null);
    try {
      const message = await act(target.steamId, target.action);
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const confirmMeta = pending
    ? {
        admin: {
          title: "设为管理员",
          message: `确定把「${pending.name}」设为管理员吗？该玩家将拥有服务器管理权限。`,
          label: "设为管理员",
        },
        unadmin: {
          title: "取消管理员",
          message: `确定取消「${pending.name}」的管理员权限吗？`,
          label: "取消管理",
        },
        kick: {
          title: "踢出玩家",
          message: `确定把「${pending.name}」踢出服务器吗？`,
          label: "踢出",
        },
        ban: {
          title: "加入黑名单",
          message: `确定把「${pending.name}」永久加入黑名单吗？该玩家将无法再次连接。`,
          label: "封禁",
        },
        unban: {
          title: "移出黑名单",
          message: `确定把「${pending.name}」从黑名单移除吗？`,
          label: "解封",
        },
      }[pending.action]
    : null;

  return (
    <PageState
      loading={loading && !data}
      error={error}
      empty={false}
      errorText="无法获取玩家列表"
    >
      <div className="flex h-full flex-col gap-4">
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center gap-2">
          <Users size={22} className="text-emerald-500" />
          <h1 className="text-base font-medium text-slate-100">玩家列表</h1>
          <span className="ml-2 text-sm text-slate-500">
            {isLive ? `在线 ${players.length} 人` : "服务端未运行"}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void refresh()}
            className="ml-auto h-7 w-7 text-slate-500 hover:text-slate-300"
            aria-label="刷新玩家列表"
          >
            <RefreshCw size={14} />
          </Button>
        </div>

        {/* 玩家卡片列表 */}
        <div className="flex-1 overflow-auto">
          {!isLive ? (
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-12 text-center text-sm text-slate-500">
              服务端未运行，启动后即可查看在线玩家
            </div>
          ) : players.length === 0 ? (
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-12 text-center text-sm text-slate-500">
              当前没有玩家在线
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {players.map((player) => (
                <div
                  key={player.steamId}
                  className="rounded-lg border border-slate-700 bg-slate-800 p-4"
                >
                  {/* 玩家名与标识 */}
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        player.isAdmin
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-slate-700 text-slate-300",
                      )}
                    >
                      <Users size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">
                          {player.name || "未知玩家"}
                        </span>
                        {player.isAdmin && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-400">
                            管理员
                          </span>
                        )}
                        {player.isBanned && (
                          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-400">
                            黑名单
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-slate-500">
                        {player.steamId}
                      </p>
                      {player.character && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          角色：{player.character}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-700 pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={acting}
                      onClick={() => {
                        setPending({
                          steamId: player.steamId,
                          name: player.name,
                          action: player.isAdmin ? "unadmin" : "admin",
                        });
                        setConfirmOpen(true);
                      }}
                      className="h-7 gap-1 text-xs"
                    >
                      {player.isAdmin ? (
                        <ShieldOff size={12} />
                      ) : (
                        <Shield size={12} />
                      )}
                      {player.isAdmin ? "取消管理" : "设为管理"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={acting}
                      onClick={() => {
                        setPending({
                          steamId: player.steamId,
                          name: player.name,
                          action: "kick",
                        });
                        setConfirmOpen(true);
                      }}
                      className="h-7 gap-1 text-xs"
                    >
                      <LogOut size={12} /> 踢出
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={acting}
                      onClick={() => {
                        setPending({
                          steamId: player.steamId,
                          name: player.name,
                          action: player.isBanned ? "unban" : "ban",
                        });
                        setConfirmOpen(true);
                      }}
                      className="h-7 gap-1 text-xs"
                    >
                      {player.isBanned ? (
                        <RotateCcw size={12} />
                      ) : (
                        <Ban size={12} />
                      )}
                      {player.isBanned ? "移出黑名单" : "加入黑名单"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={confirmMeta?.title ?? "确认操作"}
        message={confirmMeta?.message ?? ""}
        confirmLabel={confirmMeta?.label ?? "确定"}
        variant="danger"
        icon={AlertCircle}
        loading={acting}
        onConfirm={() => void handleAction()}
        onCancel={() => {
          setConfirmOpen(false);
          setPending(null);
        }}
      />
    </PageState>
  );
}
