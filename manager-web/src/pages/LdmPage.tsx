/**
 * LDM Mod 框架页面——已装插件 / 框架配置 / 权限组 三 Tab。
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Package,
  Settings,
  Shield,
  RefreshCw,
  Power,
  PowerOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { apiClient } from "../api/client.js";
import { Button } from "../components/ui/button.js";
import { TabBar } from "../components/shared/TabBar.js";
import { PageState } from "../components/shared/PageState.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.js";
import { NoInstanceGuide } from "../components/shared/NoInstanceGuide.js";
import { SearchInput } from "../components/shared/SearchInput.js";
import { LdmStatusCard } from "../components/ldm/LdmStatusCard.js";
import type { PluginRuntimeStatus } from "@unturned-manager/shared";
import { OnboardingSopCard } from "../components/ldm/OnboardingSopCard.js";
import { FrameworkConfigTab } from "../components/ldm/FrameworkConfigTab.js";
import { PermissionsTab } from "../components/ldm/PermissionsTab.js";
import { formatSize, formatDate, errorMessage } from "../lib/utils.js";
import { useRequireServer } from "../hooks/useRequireServer.js";

// ─── 类型 ────────────────────────────────────────────────

interface InstalledPlugin {
  name: string;
  version: string | null;
  sizeBytes: number;
  hasConfig: boolean;
  modifiedAtIso: string;
  runtimeStatus: "loaded" | "unloaded" | "failure" | "cancelled" | "unknown";
}

interface InstalledPluginsResponse {
  serverId: string;
  plugins: InstalledPlugin[];
  ldmNotDetected: boolean;
  detectedAtIso: string;
}

// ─── 组件 ────────────────────────────────────────────────

/**
 * 守卫壳——只做实例守卫，业务 hooks 全在 LdmContent 内。
 * 无实例时内容区渲染占位卡（NoInstanceGuide）引导去创建，统一走 PageState 显示加载中。
 * React hooks 规则：所有 hook 必须无条件按固定顺序调用；这里提前 return 只影响
 * 本组件（不调业务 hooks），业务 hooks 在 LdmContent 内稳定执行。
 */
export function LdmPage() {
  const guard = useRequireServer();

  if (guard.status === "loading") {
    return <PageState loading error={null} empty={false} loadingText="加载中...">{null}</PageState>;
  }

  if (guard.status !== "ready") {
    return (
      <NoInstanceGuide
        reason={guard.status === "missing" ? "missing" : "empty"}
      />
    );
  }

  return <LdmContent serverId={guard.serverId} />;
}

/** LdmContent 持有全部业务 hooks 与 JSX；serverId 由守卫壳校验后传入，此处恒有效。 */
function LdmContent({ serverId }: { serverId: string }) {
  const [activeTab, setActiveTab] = useState<
    "installed" | "framework" | "permissions"
  >("installed");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "#F1F5FB" }}>
          Mod 框架
        </h1>
      </div>
      <OnboardingSopCard />
      <TabBar
        active={activeTab}
        onChange={(k) =>
          setActiveTab(
            k as "installed" | "framework" | "permissions",
          )
        }
        tabs={[
          { key: "installed", label: "已装插件", icon: Package },
          { key: "framework", label: "框架配置", icon: Settings },
          { key: "permissions", label: "权限组", icon: Shield },
        ]}
      />
      {activeTab === "installed" && <InstalledTab serverId={serverId} />}
      {activeTab === "framework" && <FrameworkConfigTab serverId={serverId} />}
      {activeTab === "permissions" && <PermissionsTab />}
    </div>
  );
}

// ─── Tab 1: 已装插件 ─────────────────────────────────────

// 状态筛选枚举映射（前端展示 → 后端 status 值）
const RUNTIME_STATUS_OPTIONS = [
  { value: null as PluginRuntimeStatus | null, label: "全部" },
  { value: "loaded" as PluginRuntimeStatus, label: "已加载" },
  { value: "unloaded" as PluginRuntimeStatus, label: "未加载" },
  { value: "failure" as PluginRuntimeStatus, label: "加载失败" },
  { value: "cancelled" as PluginRuntimeStatus, label: "已取消" },
  { value: "unknown" as PluginRuntimeStatus, label: "未知" },
];

export function InstalledTab({ serverId }: { serverId: string }) {
  // Phase 4b：搜索/筛选 state（query 即时更新 + debounce 300ms 触发后端查询）
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PluginRuntimeStatus | null>(null);
  // 标记是否启用筛选（避免无筛选时也打后端——保持原 /installed 路径）
  const searchEnabled = debouncedQuery !== "" || statusFilter !== null;
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(queryInput.trim()), 300);
    return () => clearTimeout(t);
  }, [queryInput]);

  // 主列表 useQuery（无筛选时走 /installed；筛选时走 /plugins/search）
  const installedQuery = useQuery({
    queryKey: ["ldm", "installed", serverId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: InstalledPluginsResponse }>(
        `/servers/${serverId}/ldm/installed`,
      );
      return res.data.data;
    },
    enabled: !!serverId && !searchEnabled,
    staleTime: 60_000,
  });

  // 搜索 useQuery（筛选时启用）
  const searchQuery = useQuery({
    queryKey: ["ldm", "search", serverId, debouncedQuery, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("query", debouncedQuery);
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiClient.get<{ data: InstalledPlugin[] }>(
        `/servers/${serverId}/ldm/plugins/search?${params.toString()}`,
      );
      return res.data.data;
    },
    enabled: !!serverId && searchEnabled,
    staleTime: 60_000,
  });

  // 统一当前展示的列表/loading/error/refetch
  const data = searchEnabled
    ? {
        serverId,
        plugins: searchQuery.data ?? [],
        ldmNotDetected: false,
        detectedAtIso: new Date().toISOString(),
      }
    : installedQuery.data;
  const isLoading = searchEnabled ? searchQuery.isLoading : installedQuery.isLoading;
  const error = searchEnabled ? searchQuery.error : installedQuery.error;
  const refetch = () => {
    if (searchEnabled) searchQuery.refetch();
    else installedQuery.refetch();
  };
  const isRefetching = searchEnabled
    ? searchQuery.isFetching
    : installedQuery.isFetching;

  const commandMutation = useMutation({
    mutationFn: async (vars: { pluginName: string; action: "load" | "unload" | "reload" }) => {
      const url = `/servers/${serverId}/ldm/${vars.action}-plugin`;
      const res = await apiClient.post<{ data: { outcome: string; ldmOutput: string } }>(
        url,
        { pluginName: vars.pluginName },
      );
      return res.data.data;
    },
    onSuccess: (data, vars) => {
      const pastTense = vars.action === "load" ? "加载" : vars.action === "unload" ? "卸载" : "重新加载";
      if (data.outcome === "success") {
        // 成功零日志——命令已接受即提示「已触发」（非「已完成」）
        toast.success(`${vars.pluginName} 已${vars.action === "reload" ? "触发重新加载" : pastTense}`);
      } else {
        toast.warning(`${pastTense}未完成：${data.ldmOutput || "无详情"}`);
      }
      // reload 后刷新——主列表路径（search 时不刷新避免 query 状态混乱）
      if (!searchEnabled) installedQuery.refetch();
      else searchQuery.refetch();
    },
    onError: (err) => toast.error(errorMessage(err, "操作失败")),
  });

  // B1 上传 .dll → Rocket/Plugins/—— 走 Files API（POST /files/raw 原二进制）
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { getAccessToken } = await import("../api/client.js");
      const token = getAccessToken() ?? "";
      const path = `Rocket/Plugins/${file.name}`;
      const res = await fetch(
        `/api/servers/${serverId}/files/raw?path=${encodeURIComponent(path)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
          },
          body: file,
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      return { fileName: file.name };
    },
    onSuccess: ({ fileName }) => {
      toast.success(`${fileName} 已上传，正在刷新列表`);
      refetch();
    },
    onError: (err) => toast.error(`上传失败：${errorMessage(err)}`),
  });

  return (
    <div className="space-y-3">
      <LdmStatusCard serverId={serverId} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs" style={{ color: "#64748B" }}>
          {searchEnabled
            ? `匹配 ${data?.plugins.length ?? 0} 个插件（筛选中）`
            : data
              ? `共 ${data.plugins.length} 个插件 · 检测于 ${formatDate(data.detectedAtIso)}`
              : "加载中…"}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput
            value={queryInput}
            onChange={setQueryInput}
            placeholder="搜索 .dll 名或版本"
            width={220}
          />
          <div className="flex items-center gap-1">
            {RUNTIME_STATUS_OPTIONS.map((opt) => {
              const active = statusFilter === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(opt.value)}
                  className="px-2 h-7 rounded text-xs transition-colors"
                  style={{
                    backgroundColor: active ? "#22C55E" : "#0F172A",
                    color: active ? "#F1F5FB" : "#94A3B8",
                    border: "1px solid #334059",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <UploadButton
            disabled={uploadMutation.isPending}
            onSelect={(file) => uploadMutation.mutate(file)}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw size={14} className={isRefetching ? "animate-spin" : ""} />
            刷新
          </Button>
        </div>
      </div>
      <PageState
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        empty={!data || data.plugins.length === 0}
        emptyText={
          searchEnabled
            ? "无匹配插件"
            : data?.ldmNotDetected
              ? "LDM 主框架未安装"
              : "当前未安装任何插件"
        }
        emptyAction={data?.ldmNotDetected ? (
          <div className="text-xs space-y-2 text-left max-w-md mx-auto" style={{ color: "#94A3B8" }}>
            <p>请按以下步骤激活 Mod 框架：</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>确保 Unturned 服务端已安装（Steam AppID 1110390）</li>
              <li>从游戏目录的 Extras/Rocket.Unturned 复制到 Modules/</li>
              <li>启动一次服务端让 Rocket 目录自动生成</li>
            </ol>
          </div>
        ) : null}
      >
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.plugins.map((p) => (
              <PluginCard
                key={p.name}
                plugin={p}
                loading={commandMutation.isPending}
                onLoad={() => commandMutation.mutate({ pluginName: p.name, action: "load" })}
                onUnload={() => commandMutation.mutate({ pluginName: p.name, action: "unload" })}
                onReload={() => commandMutation.mutate({ pluginName: p.name, action: "reload" })}
              />
            ))}
          </div>
        )}
      </PageState>
    </div>
  );
}

// ─── 子组件：已装插件卡片 ─────────────────────────────────

export function PluginCard({
  plugin: p,
  loading,
  onLoad,
  onUnload,
  onReload,
}: {
  plugin: InstalledPlugin;
  loading: boolean;
  onLoad: () => void;
  onUnload: () => void;
  onReload?: () => void;
}) {
  const [confirm, setConfirm] = useState<"load" | "unload" | "reload" | null>(null);
  const isLoaded = p.runtimeStatus === "loaded";
  const isFailed = p.runtimeStatus === "failure" || p.runtimeStatus === "cancelled";

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{ backgroundColor: "#1E293B", border: "1px solid #334059" }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate" style={{ color: "#F1F5FB" }}>
            {p.name}
          </h3>
          <p className="text-xs" style={{ color: "#64748B" }}>
            {p.version ?? "版本未知"} · {formatSize(p.sizeBytes)}
          </p>
        </div>
        <RuntimeStatusBadge status={p.runtimeStatus} />
      </div>
      <div className="flex items-center gap-1 text-xs" style={{ color: "#64748B" }}>
        {p.hasConfig && (
          <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: "#0F172A" }}>
            有配置
          </span>
        )}
        <span>{formatDate(p.modifiedAtIso)}</span>
      </div>
      <div className="flex gap-2">
        {isLoaded && onReload && (
          <Button
            size="sm"
            variant="secondary"
            disabled={loading}
            onClick={() => setConfirm("reload")}
            aria-label={`重新加载 ${p.name}`}
          >
            <RefreshCw size={14} /> 重新加载
          </Button>
        )}
        {isLoaded ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={loading}
            onClick={() => setConfirm("unload")}
            className="flex-1"
          >
            <PowerOff size={14} /> 卸载
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={loading || isFailed}
            onClick={() => setConfirm("load")}
            className="flex-1"
          >
            <Power size={14} /> 加载
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => setConfirm(null)}
        title={
          confirm === "reload"
            ? "重新加载插件"
            : "确认操作"
        }
        message={
          confirm === "reload"
            ? `重新加载 ${p.name}？此操作不保证成功，可能破坏插件状态。建议仅在插件状态异常时使用。`
            : `将对 ${p.name} 执行${confirm === "load" ? "加载" : "卸载"}命令`
        }
        confirmLabel={
          confirm === "reload"
            ? "确认重新加载"
            : `确认${confirm === "load" ? "加载" : "卸载"}`
        }
        variant={confirm === "load" ? "default" : "danger"}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action === "load") onLoad();
          else if (action === "unload") onUnload();
          else if (action === "reload") onReload?.();
        }}
      />
    </div>
  );
}

function RuntimeStatusBadge({ status }: { status: InstalledPlugin["runtimeStatus"] }) {
  const map: Record<InstalledPlugin["runtimeStatus"], { label: string; color: string; icon: typeof CheckCircle2 }> = {
    loaded: { label: "已加载", color: "#22C55E", icon: CheckCircle2 },
    unloaded: { label: "未加载", color: "#64748B", icon: XCircle },
    failure: { label: "加载失败", color: "#EF4444", icon: AlertTriangle },
    cancelled: { label: "已取消", color: "#F59E0B", icon: AlertTriangle },
    unknown: { label: "未知", color: "#64748B", icon: XCircle },
  };
  const { label, color, icon: Icon } = map[status];
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color }}>
      <Icon size={12} />
      {label}
    </span>
  );
}

// ─── 子组件：上传 .dll 按钮 ──────────────────────────────

/**
 * 上传 .dll 按钮——点击弹出文件选择器，选中后回调 onSelect。
 * 仅接受 .dll 扩展名（Linux 大小写敏感，B1 约束）。input 隐藏在 label 后面。
 *
 * @param props - 组件属性
 * @param props.onSelect - 用户选中文件回调，传入原生 File 对象
 * @param props.disabled - 上传中禁用
 * @returns 上传按钮 + 隐藏 file input
 */
export function UploadButton({
  onSelect,
  disabled,
}: {
  onSelect: (file: File) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex items-center gap-1 rounded text-white transition-colors ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-90"
      }`}
      style={{
        height: 32,
        padding: "0 12px",
        fontSize: 13,
        backgroundColor: "#22C55E",
        border: "none",
      }}
    >
      <Upload size={14} />
      上传 .dll
      <input
        type="file"
        accept=".dll"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
          // 重置 input 允许同一文件再选
          e.target.value = "";
        }}
      />
    </label>
  );
}

