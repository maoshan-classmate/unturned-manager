/**
 * LDM Mod 框架页面——2 Tab：已装插件 / 插件来源。
 * 设计见 docs/architecture/ldm-integration-design.md §12.2 Phase 1。
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Package,
  Globe,
  Search,
  RefreshCw,
  Power,
  PowerOff,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiClient } from "../api/client.js";
import { Button } from "../components/ui/button.js";
import { TabBar } from "../components/shared/TabBar.js";
import { PageState } from "../components/shared/PageState.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.js";
import { InfoCard } from "../components/shared/InfoCard.js";
import { Input } from "../components/ui/input.js";
import { NoInstanceGuide } from "../components/shared/NoInstanceGuide.js";
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

interface CommunityPlugin {
  slug: string;
  name: string;
  author: string;
  description: string;
  repoUrl: string;
  latestVersion: string;
  updatedAtIso: string;
}

interface CommunityPluginsResponse {
  plugins: CommunityPlugin[];
  fetchedAtIso: string;
  stale: boolean;
}

interface PatTestResult {
  ok: boolean;
  code: "github-pat-invalid" | "network-error" | null;
  rateLimit: { limit: number; remaining: number; reset: number } | null;
  message: string | null;
}

// ─── PAT 表单 schema ─────────────────────────────────────

const patSchema = z.object({
  pat: z.string().min(1, "请输入 GitHub PAT"),
});
type PatFormValues = z.infer<typeof patSchema>;

// ─── 组件 ────────────────────────────────────────────────

export function LdmPage() {
  // 取值来源切到共享层（sc:design 第 4 阶段）
  const guard = useRequireServer();

  const [activeTab, setActiveTab] = useState<"installed" | "source">("installed");
  const [pat, setPat] = useState<string | null>(null);

  // PAT 从 localStorage 读（fallback，无后端持久化）
  useEffect(() => {
    const saved = localStorage.getItem("ldm.githubPat");
    if (saved) setPat(saved);
  }, []);

  // 无实例时内容区渲染占位卡引导（不再自动跳转 + toast）
  if (guard.status !== "ready") {
    return (
      <NoInstanceGuide
        reason={guard.status === "missing" ? "missing" : "empty"}
      />
    );
  }
  const serverId = guard.serverId;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "#F1F5FB" }}>
          Mod 框架
        </h1>
      </div>
      <TabBar
        active={activeTab}
        onChange={(k) => setActiveTab(k as "installed" | "source")}
        tabs={[
          { key: "installed", label: "已装插件", icon: Package },
          { key: "source", label: "插件来源", icon: Globe },
        ]}
      />
      {activeTab === "installed" ? (
        <InstalledTab serverId={serverId} />
      ) : (
        <SourceTab serverId={serverId} pat={pat} onPatChange={setPat} />
      )}
    </div>
  );
}

// ─── Tab 1: 已装插件 ─────────────────────────────────────

function InstalledTab({ serverId }: { serverId: string }) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["ldm", "installed", serverId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: InstalledPluginsResponse }>(
        `/servers/${serverId}/ldm/installed`,
      );
      return res.data.data;
    },
    enabled: !!serverId,
    staleTime: 60_000,
  });

  const commandMutation = useMutation({
    mutationFn: async (vars: { pluginName: string; action: "load" | "unload" }) => {
      const url = `/servers/${serverId}/ldm/${vars.action}-plugin`;
      const res = await apiClient.post<{ data: { outcome: string; ldmOutput: string } }>(
        url,
        { pluginName: vars.pluginName },
      );
      return res.data.data;
    },
    onSuccess: (data, vars) => {
      if (data.outcome === "success") {
        toast.success(`${vars.pluginName} 已${vars.action === "load" ? "加载" : "卸载"}`);
      } else {
        toast.warning(`${vars.action === "load" ? "加载" : "卸载"}未完成：${data.ldmOutput || "无详情"}`);
      }
      refetch();
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
    <PageState
      loading={isLoading}
      error={error ? errorMessage(error) : null}
      empty={!data || data.plugins.length === 0}
      emptyText={data?.ldmNotDetected ? "LDM 主框架未安装" : "当前未安装任何插件"}
      emptyAction={data?.ldmNotDetected ? (
        <div className="text-xs space-y-2 text-left max-w-md mx-auto" style={{ color: "#94A3B8" }}>
          <p>请按以下步骤激活 LDM（Legally-Distinct-Missile）框架：</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>确保 Unturned 服务端已安装（Steam AppID 1110390）</li>
            <li>从游戏目录的 Extras/Rocket.Unturned 复制到 Modules/</li>
            <li>启动一次服务端让 Rocket 目录自动生成</li>
          </ol>
        </div>
      ) : null}
    >
      {data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "#64748B" }}>
              共 {data.plugins.length} 个插件 · 检测于 {formatDate(data.detectedAtIso)}
            </p>
            <div className="flex gap-2">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.plugins.map((p) => (
              <PluginCard
                key={p.name}
                plugin={p}
                loading={commandMutation.isPending}
                onLoad={() => commandMutation.mutate({ pluginName: p.name, action: "load" })}
                onUnload={() => commandMutation.mutate({ pluginName: p.name, action: "unload" })}
              />
            ))}
          </div>
        </div>
      )}
    </PageState>
  );
}

// ─── Tab 2: 插件来源 ─────────────────────────────────────

function SourceTab({
  serverId: _serverId,
  pat,
  onPatChange,
}: {
  serverId: string;
  pat: string | null;
  onPatChange: (p: string | null) => void;
}) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["ldm", "community", pat ?? ""],
    queryFn: async () => {
      const res = await apiClient.get<{ data: CommunityPluginsResponse }>(
        `/ldm/community-plugins`,
        { headers: pat ? { "X-Github-Pat": pat } : {} },
      );
      return res.data.data;
    },
    staleTime: 5 * 60_000,
  });

  const form = useForm<PatFormValues>({
    resolver: zodResolver(patSchema),
    defaultValues: { pat: pat ?? "" },
  });

  const testPatMutation = useMutation({
    mutationFn: async (pat: string) => {
      const res = await apiClient.post<{ data: PatTestResult }>(
        "/ldm/community-plugins/test-pat",
        { pat },
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(`PAT 有效（剩余 ${data.rateLimit?.remaining ?? "?"} 次请求）`);
      } else {
        toast.warning(`PAT 测试失败：${data.message ?? data.code}`);
      }
    },
    onError: (err) => toast.error(errorMessage(err, "PAT 测试失败")),
  });

  const onSavePat = (vals: PatFormValues) => {
    localStorage.setItem("ldm.githubPat", vals.pat);
    onPatChange(vals.pat);
    testPatMutation.mutate(vals.pat);
    toast.success("PAT 已保存到本地");
  };

  // 「上传到此实例」共用 uploadMutation（与 InstalledTab 同一 Files API 路径）
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { getAccessToken } = await import("../api/client.js");
      const token = getAccessToken() ?? "";
      const path = `Rocket/Plugins/${file.name}`;
      const res = await fetch(
        `/api/servers/${_serverId}/files/raw?path=${encodeURIComponent(path)}`,
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
      toast.success(`${fileName} 已上传，可切到「已装插件」Tab 加载`);
    },
    onError: (err) => toast.error(`上传失败：${errorMessage(err)}`),
  });

  return (
    <div className="space-y-4">
      {/* PAT 配置卡（页面顶部固定） */}
      <div
        className="rounded-lg p-4 space-y-3"
        style={{ backgroundColor: "#1E293B", border: "1px solid #334059" }}
      >
        <div className="flex items-center gap-2">
          <KeyRound size={16} style={{ color: "#F59E0B" }} />
          <h3 className="text-sm font-medium" style={{ color: "#F1F5FB" }}>
            GitHub PAT（可选）
          </h3>
        </div>
        <p className="text-xs" style={{ color: "#94A3B8" }}>
          配置后 GitHub API 限流从 60/小时 提升到 5000/小时。PAT 仅存浏览器本地，不上传服务端。
        </p>
        <form onSubmit={form.handleSubmit(onSavePat)} className="flex gap-2">
          <Input
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            {...form.register("pat")}
            className="flex-1"
          />
          <Button type="submit" variant="secondary" disabled={testPatMutation.isPending}>
            {testPatMutation.isPending ? "测试中…" : "保存并测试"}
          </Button>
        </form>
        {form.formState.errors.pat && (
          <p className="text-xs" style={{ color: "#EF4444" }} role="alert">
            {form.formState.errors.pat.message}
          </p>
        )}
      </div>

      {/* 插件安装步骤说明卡（G5 决策 + B1/G3 落地 UX 引导） */}
      <InstallStepsCard />

      <PageState
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        empty={!data || data.plugins.length === 0}
        emptyText="暂未获取到插件列表"
      >
        {data && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: "#64748B" }}>
                共 {data.plugins.length} 个插件 · 缓存于 {formatDate(data.fetchedAtIso)}
                {data.stale && <span className="ml-2" style={{ color: "#F59E0B" }}>（缓存）</span>}
              </p>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.plugins.map((p) => (
                <CommunityCard
                  key={p.slug}
                  plugin={p}
                  uploading={uploadMutation.isPending}
                  onUpload={(file) => uploadMutation.mutate(file)}
                />
              ))}
            </div>
          </div>
        )}
      </PageState>
    </div>
  );
}

// ─── 子组件：已装插件卡片 ─────────────────────────────────

function PluginCard({
  plugin: p,
  loading,
  onLoad,
  onUnload,
}: {
  plugin: InstalledPlugin;
  loading: boolean;
  onLoad: () => void;
  onUnload: () => void;
}) {
  const [confirm, setConfirm] = useState<"load" | "unload" | null>(null);
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
        title="确认操作"
        message={`将对 ${p.name} 执行${confirm === "load" ? "加载" : "卸载"}命令`}
        confirmLabel={`确认${confirm === "load" ? "加载" : "卸载"}`}
        variant={confirm === "load" ? "default" : "danger"}
        onConfirm={() => {
          setConfirm(null);
          if (confirm === "load") onLoad();
          else if (confirm === "unload") onUnload();
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

// ─── 子组件：插件安装步骤说明卡 ─────────────────────────

/**
 * 插件安装步骤说明卡——告诉用户下载步骤 + 上传入口位置。
 * 容器复用 components/shared/InfoCard；UX 决策：面板不自动下载 .dll（G5：二进制风险），
 * 文件来自用户本地选择（B1/G3）。
 *
 * @returns 步骤说明卡 React 元素
 */
export function InstallStepsCard() {
  return (
    <InfoCard title="💡 插件安装步骤">
      <ol className="space-y-1.5 list-decimal list-inside">
        <li>在下方列表点「查看仓库」打开 GitHub Releases 页面</li>
        <li>
          下载需要的{" "}
          <code
            style={{ backgroundColor: "#0F172A", padding: "0 4px", borderRadius: 3 }}
          >
            .dll
          </code>{" "}
          文件（建议核对哈希值确认来源）
        </li>
        <li>回到本页「已装插件」Tab → 点「上传 .dll」按钮</li>
        <li>选择刚下载的文件 → 面板自动传到 Rocket/Plugins/ 目录</li>
        <li>列表刷新出现该插件 → 点「加载」生效</li>
      </ol>
      <p className="mt-2" style={{ color: "#64748B" }}>
        注：面板不会自动下载 .dll，以避免引入不受信任的二进制。
      </p>
    </InfoCard>
  );
}

/**
 * 社区插件卡片——展示插件名/作者/最新版本，「查看仓库」外链 GitHub Releases，
 * 「上传到此实例」按钮把用户本地 .dll 传到当前实例 Rocket/Plugins/（B1/G3）。
 *
 * @param props - 组件属性
 * @param props.plugin - 社区插件元数据
 * @param props.uploading - 是否正在上传（互斥锁，全局同一时间只一个上传动作）
 * @param props.onUpload - 用户选完 .dll 回调，传入原生 File 对象
 * @returns 社区插件卡片 React 元素
 */
export function CommunityCard({
  plugin: p,
  uploading,
  onUpload,
}: {
  plugin: CommunityPlugin;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  // 用户填的「预期文件名」—— GitHub Releases 上常见命名规则：插件名 + 版本号 + .dll
  // 用户在浏览器下载时看到实际文件名，落在 file.name 里，无需前端猜
  const suggestedName = `${p.name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+$/, "")}.dll`;
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
            {p.author}
          </p>
        </div>
        {p.latestVersion && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "#0F172A", color: "#94A3B8" }}>
            {p.latestVersion}
          </span>
        )}
      </div>
      {p.description && (
        <p className="text-xs line-clamp-2" style={{ color: "#94A3B8" }}>
          {p.description}
        </p>
      )}
      <div className="flex gap-2">
        <a
          href={p.repoUrl}
          target="_blank"
          rel="noreferrer"
          className="flex-1"
        >
          <Button size="sm" variant="ghost" className="w-full">
            <Search size={14} /> 查看仓库
          </Button>
        </a>
        <label
          className={`inline-flex items-center gap-1 rounded text-white transition-colors ${
            uploading ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-90"
          }`}
          style={{
            height: 32,
            padding: "0 12px",
            fontSize: 13,
            backgroundColor: "#22C55E",
            border: "none",
          }}
          title={`选择本地下载好的 .dll（建议文件名 ${suggestedName}）`}
        >
          <Upload size={14} />
          上传到此实例
          <input
            type="file"
            accept=".dll"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
