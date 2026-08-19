import { useQuery } from "@tanstack/react-query";
import { Info, AlertTriangle } from "lucide-react";
import { apiClient } from "../../api/client.js";
import { Card } from "../shared/Card.js";

/** LDM 版本信息（GET /api/servers/:id/ldm/version） */
interface LdmVersionInfo {
  serverId: string;
  ldmVersion: string | null;
  gameVersion: string | null;
  raw: string;
}

/** 模块加载状态（GET /api/servers/:id/ldm/modules-state） */
interface ModulesState {
  serverId: string;
  rocketUnturnedLoaded: boolean;
  raw: string;
}

/**
 * 关于 LDM 卡片——展示 LDM 主框架版本 + Rocket.Unturned 模块加载状态。
 * 安装在「框架配置」Tab 顶部。
 *
 * 数据源：
 * - `GET /api/servers/:id/ldm/version`
 * - `GET /api/servers/:id/ldm/modules-state`
 *
 * 两个端点都依赖实例 RUNNING（PTY 写命令需要运行中）；非 RUNNING 时后端抛
 * `server-not-running` 409，前端用 `errorMessage` 取出用户可见文案（来自
 * `backend-development.md` 错误处理节），不阻塞 UI 渲染。
 *
 * @param props - 组件属性
 * @param props.serverId - 实例标识
 * @returns 卡片 React 元素
 *
 * @example
 * ```tsx
 * <LdmAboutCard serverId="MyServer" />
 * ```
 */
export function LdmAboutCard({ serverId }: { serverId: string }) {
  const versionQuery = useQuery({
    queryKey: ["ldm", "version", serverId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: LdmVersionInfo }>(
        `/servers/${serverId}/ldm/version`,
      );
      return res.data.data;
    },
    enabled: !!serverId,
    staleTime: 60_000,
    retry: false,
  });

  const modulesQuery = useQuery({
    queryKey: ["ldm", "modules-state", serverId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ModulesState }>(
        `/servers/${serverId}/ldm/modules-state`,
      );
      return res.data.data;
    },
    enabled: !!serverId,
    staleTime: 60_000,
    retry: false,
  });

  // /status 端点不依赖 PTY——可在 RUNNING 守卫前给出「主框架未装」fallback
  // 区分「根本没装」与「装了但未运行」两种情况（仅靠 PTY 数据无法区分）
  const statusQuery = useQuery({
    queryKey: ["ldm", "status", serverId],
    queryFn: async () => {
      const res = await apiClient.get<{
        data: { ldmInstalled: boolean };
      }>(`/servers/${serverId}/ldm/status`);
      return res.data.data;
    },
    enabled: !!serverId,
    staleTime: 60_000,
    retry: false,
  });

  const versionError = versionQuery.error;
  const modulesError = modulesQuery.error;
  // axios 错误码路径：err.response.data.error.code（与 LaunchCommandsDialog 等组件惯例一致）
  const errorCodeOf = (err: unknown): string | undefined => {
    const e = err as { response?: { data?: { error?: { code?: string } } } } | null;
    return e?.response?.data?.error?.code;
  };
  const isServerNotRunning =
    errorCodeOf(versionError) === "server-not-running" ||
    errorCodeOf(modulesError) === "server-not-running";

  // /status 不依赖 PTY——作为「主框架未装」fallback 信号
  const ldmInstalled = statusQuery.data?.ldmInstalled;

  return (
    <Card title="关于 LDM">
      {ldmInstalled === false && (
        <div
          className="flex items-center gap-1.5 text-xs mb-3"
          style={{ color: "#F59E0B" }}
        >
          <AlertTriangle size={12} />
          Mod 框架主框架未安装（先激活：cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/）
        </div>
      )}
      {isServerNotRunning && (
        <div
          className="flex items-center gap-1.5 text-xs mb-3"
          style={{ color: "#F59E0B" }}
        >
          <AlertTriangle size={12} />
          实例未运行，无法读取版本信息（启动后再试）
        </div>
      )}
      <div className="space-y-2">
        <FieldRow
          icon={Info}
          label="主框架版本"
          loading={versionQuery.isLoading}
          error={!!versionError && !isServerNotRunning}
        >
          {versionQuery.data?.ldmVersion && versionQuery.data?.gameVersion ? (
            <span style={{ color: "#F1F5FB" }}>
              Rocket v{versionQuery.data.ldmVersion} for Unturned v
              {versionQuery.data.gameVersion}
            </span>
          ) : versionQuery.data?.raw ? (
            <span style={{ color: "#64748B" }}>{versionQuery.data.raw}</span>
          ) : (
            <span style={{ color: "#64748B" }}>未读取到</span>
          )}
        </FieldRow>

        <FieldRow
          icon={Info}
          label="Mod 框架模块"
          loading={modulesQuery.isLoading}
          error={!!modulesError && !isServerNotRunning}
        >
          {modulesQuery.data ? (
            modulesQuery.data.rocketUnturnedLoaded ? (
              <span style={{ color: "#22C55E" }}>已加载</span>
            ) : (
              <span style={{ color: "#EF4444" }}>未加载</span>
            )
          ) : (
            <span style={{ color: "#64748B" }}>未知</span>
          )}
        </FieldRow>
      </div>
    </Card>
  );
}

/** 字段行：图标 + 标签 + 内容/loading/error */
function FieldRow({
  icon: Icon,
  label,
  loading,
  error,
  children,
}: {
  icon: typeof Info;
  label: string;
  loading?: boolean;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon size={12} style={{ color: "#94A3B8" }} />
      <span style={{ color: "#94A3B8" }} className="min-w-[100px]">
        {label}
      </span>
      <span
        style={{ color: error ? "#EF4444" : "#F1F5FB" }}
        className="flex-1"
      >
        {loading ? "读取中…" : children}
      </span>
    </div>
  );
}