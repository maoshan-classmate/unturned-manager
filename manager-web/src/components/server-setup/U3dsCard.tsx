import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Server, Download, ShieldCheck, AlertCircle } from "lucide-react";
import { Card } from "../shared/Card.js";
import { Button } from "../ui/button.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { apiClient } from "@/api/client";
import { useSteamCmdProgress } from "@/hooks/useSteamCmdProgress";

interface U3dsStatus {
  appId: string;
  version: string;
  isInstalled: boolean;
  installPath: string;
  modCount?: number;
  lastUpdated?: string;
}

interface U3dsCardProps {
  status: U3dsStatus | null;
}

/**
 * Card - U3DS:Figma 9:15563 — AppID + 版本 + 路径 + 模组数 + 上次更新 + 更新/验证按钮。
 * 后端暂无独立 `/u3ds/status` 端点;走 fallback 复用 `/steamcmd/status` 数据,字段补默认。
 */
export function U3dsCard({ status }: U3dsCardProps) {
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [validating, setValidating] = useState(false);

  // fallback 数据：后端 /u3ds/status 不存在时，默认占位
  const data: U3dsStatus = status ?? {
    appId: "1110390",
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
        `U3DS 安装完成${installProgress.percent != null ? `（${installProgress.percent}%）` : ""}`,
        { id: "u3ds-install" },
      );
      setInstalling(false);
    } else if (installProgress.stage === "failed") {
      // BUG-2 附带：必须带 id 替换残留的 loading toast（否则"安装中… spawned"一直挂着）
      toast.error("U3DS 安装失败", { id: "u3ds-install" });
      setInstalling(false);
    } else if (installing) {
      const pct =
        installProgress.percent != null ? ` ${installProgress.percent}%` : "";
      toast.loading(`U3DS 安装中… ${installProgress.stage}${pct}`, {
        id: "u3ds-install",
      });
    }
  }, [installProgress, installing]);

  useEffect(() => {
    if (!updateProgress) return;
    if (updateProgress.stage === "completed") {
      toast.success(
        `U3DS 更新完成${updateProgress.percent != null ? `（${updateProgress.percent}%）` : ""}`,
        { id: "u3ds-update" },
      );
      setUpdating(false);
    } else if (updateProgress.stage === "failed") {
      // BUG-2 附带：带 id 替换残留的 loading toast
      toast.error("U3DS 更新失败", { id: "u3ds-update" });
      setUpdating(false);
    } else if (updating) {
      const pct =
        updateProgress.percent != null ? ` ${updateProgress.percent}%` : "";
      toast.loading(`U3DS 更新中… ${updateProgress.stage}${pct}`, {
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
      toast.loading("U3DS 安装已启动...", { id: "u3ds-install" });
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      // BUG-2 附带：带 id 替换 loading toast（HTTP 报错时进度 toast 必须消失）
      toast.error(msg ?? "U3DS 安装失败", { id: "u3ds-install" });
      setInstalling(false);
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    setUpdateConfirmOpen(false);
    try {
      await apiClient.post("/steamcmd/update", {
        installDir: data.installPath,
      });
      toast.success("U3DS 更新已提交");
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      toast.error(msg ?? "更新失败", { id: "u3ds-update" });
      setUpdating(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      await apiClient.post("/steamcmd/validate", {
        installDir: data.installPath,
      });
      toast.success("文件校验通过");
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
      <Card icon={Server} title="Unturned 专用服务器">
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
              <Download size={12} /> {updating ? "更新中..." : "更新 U3DS"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setInstallConfirmOpen(true)}
              disabled={installing}
              className="h-8 text-sm gap-1"
            >
              <Download size={12} /> {installing ? "安装中..." : "安装 U3DS"}
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
        title="更新 U3DS"
        message="将通过 SteamCMD 重新下载 U3DS 二进制（约 10GB）。期间需停服,确定继续?"
        confirmLabel="更新"
        variant="danger"
        icon={AlertCircle}
        loading={updating}
        onConfirm={handleUpdate}
        onCancel={() => setUpdateConfirmOpen(false)}
      />

      <ConfirmDialog
        open={installConfirmOpen}
        title="安装 U3DS"
        message="将通过 SteamCMD 下载 U3DS 二进制（约 10GB）到当前安装路径。安装期间需停服,确定继续?"
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
