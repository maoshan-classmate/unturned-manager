import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Server,
  Download,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { STEAM_APP_IDS, type U3dsStatus } from "@unturned-manager/shared";
import { Card } from "../shared/Card.js";
import { Button } from "../ui/button.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { apiClient } from "@/api/client";
import { useSteamCmdProgress } from "@/hooks/useSteamCmdProgress";

// 注：U3dsStatus 类型从 @unturned-manager/shared 导入（shared/types/domain.ts）——
// 与后端 U3dsStatusProvider 返回的契约是同一份，避免前后端漂移

interface U3dsCardProps {
  status: U3dsStatus | null;
  /**
   * 状态回写回调——安装/更新/校验完成后由父组件重拉真实状态。
   * 父组件传了就用：安装后立刻能看到「已安装」而不用手动刷页面。
   * 不传就保持向后兼容（只显示内部状态）。
   */
  onStatusChange?: (next: U3dsStatus) => void;
}

/**
 * Card - U3DS:Figma 9:15563 — AppID + 版本 + 路径 + 模组数 + 上次更新 + 更新/验证按钮。
 * 真实数据来自后端 `/u3ds/status` 端点。
 */
export function U3dsCard({ status, onStatusChange }: U3dsCardProps) {
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [validating, setValidating] = useState(false);
  const [checking, setChecking] = useState(false);

  // fallback 数据：后端 /u3ds/status 不存在时，默认占位
  const data: U3dsStatus = status ?? {
    appId: STEAM_APP_IDS.U3DS_SERVER,
    version: "—",
    isInstalled: false,
    installPath: "/opt/unturned",
  };

  // BUG-2 修复：订阅 SteamCMD 进度（按 installDir 隔离）
  const installProgress = useSteamCmdProgress({
    jobId: `steamcmd-install-${data.installPath}`,
  });
  const updateProgress = useSteamCmdProgress({
    jobId: `steamcmd-update-${data.installPath}`,
  });

  // BUG-2 修复：进度条 toast 提示
  useEffect(() => {
    if (!installProgress) return;
    if (installProgress.stage === "completed") {
      toast.success(
        `Unturned 服务端安装完成${installProgress.percent != null ? `（${installProgress.percent}%）` : ""}`,
        { id: "u3ds-install" },
      );
      setInstalling(false);
      // 通知父组件重新拉状态——让卡片立刻从「未安装」翻到「已安装」
      onStatusChange?.({
        ...data,
        isInstalled: true,
      });
    } else if (installProgress.stage === "failed") {
      // BUG-2 附带：必须带 id 替换残留的 loading toast（否则"安装中… spawned"一直挂着）
      toast.error("Unturned 服务端安装失败", { id: "u3ds-install" });
      setInstalling(false);
    } else if (installing) {
      const pct =
        installProgress.percent != null ? ` ${installProgress.percent}%` : "";
      toast.loading(`Unturned 服务端安装中… ${installProgress.stage}${pct}`, {
        id: "u3ds-install",
      });
    }
  }, [installProgress, installing]);

  useEffect(() => {
    if (!updateProgress) return;
    if (updateProgress.stage === "completed") {
      toast.success(
        `Unturned 服务端更新完成${updateProgress.percent != null ? `（${updateProgress.percent}%）` : ""}`,
        { id: "u3ds-update" },
      );
      setUpdating(false);
      onStatusChange?.({ ...data });
    } else if (updateProgress.stage === "failed") {
      // BUG-2 附带：带 id 替换残留的 loading toast
      toast.error("Unturned 服务端更新失败", { id: "u3ds-update" });
      setUpdating(false);
    } else if (updating) {
      const pct =
        updateProgress.percent != null ? ` ${updateProgress.percent}%` : "";
      toast.loading(`Unturned 服务端更新中… ${updateProgress.stage}${pct}`, {
        id: "u3ds-update",
      });
    }
  }, [updateProgress, updating]);

  const handleInstall = async () => {
    setInstalling(true);
    setInstallConfirmOpen(false);
    try {
      await apiClient.post("/steamcmd/install-u3ds", {
        installDir: data.installPath,
      });
      toast.loading("Unturned 服务端安装已启动...", { id: "u3ds-install" });
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      // BUG-2 附带：带 id 替换 loading toast（HTTP 报错时进度 toast 必须消失）
      toast.error(msg ?? "Unturned 服务端安装失败", { id: "u3ds-install" });
      setInstalling(false);
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    setUpdateConfirmOpen(false);
    try {
      // Phase 0：HTTP 立即返回 jobId，进度/完成/失败由 WS steamcmd_progress 接管
      const res = await apiClient.post<{ data: { jobId?: string } }>(
        "/steamcmd/update",
        { installDir: data.installPath },
      );
      if (!res.data.data?.jobId) {
        toast.error("更新启动失败", { id: "u3ds-update" });
        setUpdating(false);
        return;
      }
      toast.loading("Unturned 服务端更新已提交…", { id: "u3ds-update" });
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      toast.error(msg ?? "更新失败", { id: "u3ds-update" });
      setUpdating(false);
    }
  };

  // BUG-1（第四版）：check-update 查的是 U3DS（AppID 1110390）buildid，不是 SteamCMD 自身版本。
  // 按钮放 U3DS 卡片（Unturned 专用服务器）而非 SteamCMD 卡片——语义对齐。
  // Phase 0：check-update 改异步——HTTP 立即返回 jobId，结果（latestVersion）通过 WS steamcmd_progress 广播，
  // 前端订阅后弹 toast「U3DS 最新版本: xxx」。
  const checkProgress = useSteamCmdProgress({
    jobId: `steamcmd-check-${data.installPath}`,
  });
  useEffect(() => {
    if (!checkProgress || !checking) return;
    if (checkProgress.stage === "completed") {
      toast.success(
        checkProgress.latestVersion
          ? `Unturned 服务端最新版本:${checkProgress.latestVersion}`
          : "Unturned 服务端已是最新版本",
        { id: "u3ds-check" },
      );
      setChecking(false);
    } else if (checkProgress.stage === "failed") {
      toast.error("检查 Unturned 服务端更新失败", { id: "u3ds-check" });
      setChecking(false);
    }
  }, [checkProgress, checking]);

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const res = await apiClient.post<{ data: { jobId?: string } }>(
        "/steamcmd/check-update",
        { installDir: data.installPath },
      );
      const { jobId } = res.data.data ?? {};
      if (!jobId) {
        toast.error("检查更新启动失败", { id: "u3ds-check" });
        setChecking(false);
        return;
      }
      toast.loading("Unturned 服务端检查更新中…", { id: "u3ds-check" });
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      toast.error(msg ?? "检查 Unturned 服务端更新失败", { id: "u3ds-check" });
      setChecking(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      await apiClient.post("/steamcmd/validate", {
        installDir: data.installPath,
      });
      toast.success("文件校验通过");
      onStatusChange?.({ ...data });
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      toast.error(msg ?? "校验失败");
    } finally {
      setValidating(false);
    }
  };

  return (
    <>
      <Card icon={Server} title="Unturned 服务端">
        <div className="space-y-2 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">AppID</span>
            <span className="text-slate-100 font-mono">{data.appId}</span>
            <span className="text-slate-500">版本:</span>
            <span className="text-slate-100">{data.version}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">状态</span>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: data.isInstalled ? "#22C55E" : "#EF4444",
              }}
            />
            <span style={{ color: data.isInstalled ? "#22C55E" : "#EF4444" }}>
              {data.isInstalled ? "已安装" : "未安装"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">路径</span>
            <span className="text-slate-100 font-mono truncate flex-1">
              {data.installPath}
            </span>
            {data.modCount != null && (
              <span className="text-slate-500">模组: {data.modCount}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-slate-500 shrink-0">上次更新</span>
            <span className="text-slate-100">
              {data.lastUpdated
                ? new Date(data.lastUpdated).toLocaleString("zh-CN")
                : "—"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          {data.isInstalled ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setUpdateConfirmOpen(true)}
              disabled={updating}
              className="h-8 text-sm gap-1"
            >
              <Download size={12} /> {updating ? "更新中..." : "更新 Unturned 服务端"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setInstallConfirmOpen(true)}
              disabled={installing}
              className="h-8 text-sm gap-1"
            >
              <Download size={12} /> {installing ? "安装中..." : "安装 Unturned 服务端"}
            </Button>
          )}
          {data.isInstalled && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCheckUpdate}
              disabled={checking}
              className="h-8 text-sm gap-1"
            >
              <RefreshCw size={12} className={checking ? "animate-spin" : ""} />{" "}
              检查更新
            </Button>
          )}
          {data.isInstalled && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleValidate}
              disabled={validating}
              className="h-8 text-sm gap-1"
            >
              <ShieldCheck
                size={12}
                className={validating ? "animate-pulse" : ""}
              />{" "}
              验证文件
            </Button>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={updateConfirmOpen}
        title="更新 Unturned 服务端"
        message="将通过 SteamCMD 重新下载 Unturned 服务端二进制（约 10GB）。期间需停服,确定继续?"
        confirmLabel="更新"
        variant="danger"
        icon={AlertCircle}
        loading={updating}
        onConfirm={handleUpdate}
        onCancel={() => setUpdateConfirmOpen(false)}
      />

      <ConfirmDialog
        open={installConfirmOpen}
        title="安装 Unturned 服务端"
        message="将通过 SteamCMD 下载 Unturned 服务端二进制（约 10GB）到当前安装路径。安装期间需停服,确定继续?"
        confirmLabel="安装"
        variant="danger"
        icon={AlertCircle}
        loading={installing}
        onConfirm={handleInstall}
        onCancel={() => setInstallConfirmOpen(false)}
      />
    </>
  );
}
