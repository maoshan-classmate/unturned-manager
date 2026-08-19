import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Download, Pencil, AlertCircle } from "lucide-react";
import { Card } from "../shared/Card.js";
import { Button } from "../ui/button.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { apiClient } from "@/api/client";
import { useSteamCmdProgress } from "@/hooks/useSteamCmdProgress";
import { SteamCmdPathDialog } from "./SteamCmdPathDialog.js";

interface SteamCmdStatus {
  isInstalled: boolean;
  installPath?: string;
  version?: string;
  lastChecked?: string;
}

interface SteamCmdCardProps {
  status: SteamCmdStatus | null;
  onStatusChange: (next: SteamCmdStatus) => void;
}

/**
 * Card - SteamCMD:Figma 9:15562 — 版本/状态/路径/上次检查 + 重装按钮。
 * 路径旁 pencil icon 触发路径编辑 Dialog。
 * 「检查 U3DS 更新」按钮在 U3dsCard（Unturned 专用服务器）那边——它查的是 U3DS 版本，不是 SteamCMD。
 *
 * reinstall 走异步——HTTP 立即返回 jobId，完成/失败经 WS steamcmd_progress
 * 广播，前端订阅后弹 toast「SteamCMD 重装完成」。
 */
export function SteamCmdCard({ status, onStatusChange }: SteamCmdCardProps) {
  const [pathDialogOpen, setPathDialogOpen] = useState(false);
  const [reinstallConfirmOpen, setReinstallConfirmOpen] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);

  // fallback 数据：后端 /steamcmd/status 不存在时，默认占位
  const data: SteamCmdStatus = status ?? {
    isInstalled: false,
    version: "—",
    installPath: "/opt/steamcmd",
  };

  // 订阅 reinstall 进度（按 installPath 隔离）——完成后弹 toast，不靠 HTTP 响应
  const reinstallProgress = useSteamCmdProgress({
    jobId: status?.installPath
      ? `steamcmd-reinstall-${status.installPath}`
      : undefined,
  });
  useEffect(() => {
    if (!reinstallProgress || !reinstalling) return;
    if (reinstallProgress.stage === "completed") {
      toast.success("SteamCMD 重装完成", { id: "steamcmd-reinstall" });
      setReinstalling(false);
    } else if (reinstallProgress.stage === "failed") {
      toast.error("SteamCMD 重装失败", { id: "steamcmd-reinstall" });
      setReinstalling(false);
    }
  }, [reinstallProgress, reinstalling]);

  const handleReinstall = async () => {
    setReinstalling(true);
    setReinstallConfirmOpen(false);
    try {
      const res = await apiClient.post<{ data: { jobId?: string } }>(
        "/steamcmd/reinstall",
      );
      const { jobId } = res.data.data ?? {};
      if (!jobId) {
        toast.error("重装启动失败");
        setReinstalling(false);
        return;
      }
      toast.loading("SteamCMD 重装已提交…", { id: "steamcmd-reinstall" });
      // 不立即关闭 — 等 WS 广播 completed/failed 再切换按钮态（见 useEffect）
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      toast.error(msg ?? "重装失败", { id: "steamcmd-reinstall" });
      setReinstalling(false);
    }
  };

  return (
    <>
      <Card icon={Download} title="SteamCMD">
        <div className="space-y-2 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">版本</span>
            <span className="text-slate-100">{data.version ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">状态</span>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: data.isInstalled ? "#22C55E" : "#EF4444",
              }}
            />
            <span
              style={{ color: data.isInstalled ? "#22C55E" : "#EF4444" }}
            >
              {data.isInstalled ? "已安装" : "未安装"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">路径</span>
            <span className="text-slate-100 font-mono truncate flex-1">
              {data.installPath ?? "—"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setPathDialogOpen(true)}
              className="h-6 w-6 text-slate-500 hover:text-slate-300"
              aria-label="编辑安装路径"
            >
              <Pencil size={14} />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">上次检查</span>
            <span className="text-slate-100">
              {data.lastChecked
                ? new Date(data.lastChecked).toLocaleString("zh-CN")
                : "—"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReinstallConfirmOpen(true)}
            className="h-8 text-sm gap-1"
          >
            <Download size={12} />{" "}
            {data.isInstalled ? "重装 SteamCMD" : "安装 SteamCMD"}
          </Button>
        </div>
      </Card>

      <SteamCmdPathDialog
        open={pathDialogOpen}
        currentPath={status?.installPath ?? ""}
        onClose={() => setPathDialogOpen(false)}
        onSaved={(newPath) =>
          onStatusChange({
            ...(status ?? { isInstalled: false }),
            installPath: newPath,
          })
        }
      />

      <ConfirmDialog
        open={reinstallConfirmOpen}
        title="重装 SteamCMD"
        message="将删除现有 SteamCMD 并重新下载,期间无法使用 SteamCMD 相关功能。是否继续?"
        confirmLabel="重装"
        variant="danger"
        icon={AlertCircle}
        loading={reinstalling}
        onConfirm={handleReinstall}
        onCancel={() => setReinstallConfirmOpen(false)}
      />
    </>
  );
}
