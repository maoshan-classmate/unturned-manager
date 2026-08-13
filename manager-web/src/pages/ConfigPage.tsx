import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { COMMANDS_DAT_ENUMS } from "@unturned-manager/shared";
import {
  Save,
  AlertCircle,
  Loader2,
  Check,
  FileText,
  Wrench,
  Cpu,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { TabBar } from "../components/shared/TabBar.js";
import { ConfigSection } from "../components/shared/ConfigSection.js";
import { ConfigField } from "../components/shared/ConfigField.js";
import { ConfigToggle } from "../components/shared/ConfigToggle.js";
import { SearchInput } from "../components/shared/SearchInput.js";
import {
  LoadoutEditor,
  type LoadoutEntry,
} from "../components/shared/LoadoutEditor.js";
import {
  DataTable,
  type DataTableColumn,
} from "../components/shared/DataTable.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.js";
import { useRequireServer } from "../hooks/useRequireServer.js";
import { useServer } from "../hooks/useServer.js";
import { apiClient } from "../api/client.js";
import { Button } from "../components/ui/button.js";
import {
  buildTxtSections,
  readBoolEntry,
  readStringEntry,
  EMPTY_TXT_FIELDS as EMPTY_TXT,
  type ConfigTxtFields,
} from "./configTxtAdapter.js";

type ConfigTab = "commands" | "txt" | "workshop";

// ─── Commands.dat fields ───────────────────────────────

interface CommandsFields {
  Name: string;
  Port: string;
  MaxPlayers: string;
  Map: string;
  Mode: string;
  Owner: string;
  Perspective: string;
  Chatrate: string;
  Cycle: string;
  Timeout: string;
  Queue_Size: string;
  GSLT: string;
  Password: string;
  /** PvE flag——true=PvE 模式，false=PvP 模式（SDK 默认 false）。面板勾选 = PvE */
  PvE: boolean;
  /** Bind 监听 IP（SDK 默认 0 = 0.0.0.0 监听所有接口，Provider.cs:6624） */
  Bind: string;
  /** Log 4 字段复合：依次为 Chat/Join/Death/Anticheat Y/N（SDK 默认 Y/Y/Y/N，CommandWindow.cs:49-52） */
  LogChat: boolean;
  LogJoin: boolean;
  LogDeath: boolean;
  LogAnticheat: boolean;
  /** Votify 6 字段复合（CommandVotify.cs:18-83）：Allow Y/N, PassCooldown(秒), FailCooldown(秒), Duration(秒), Percentage(0-100), Players */
  VotifyAllow: boolean;
  VotifyPassCooldown: string;
  VotifyFailCooldown: string;
  VotifyDuration: string;
  VotifyPercentage: string;
  VotifyPlayers: string;
  /** Loadout 重复行结构化结果——CommandLoadout.cs:13-49 + PlayerSkills.cs:43-97 */
  Loadout: LoadoutEntry[];
  Cheats: boolean;
  Filter: boolean;
  Whitelisted: boolean;
  Gold: boolean;
  Hide_Admins: boolean;
  Sync: boolean;
}

const FIELD_LABELS: Record<keyof CommandsFields, string> = {
  Name: "服务器名称",
  Port: "端口",
  MaxPlayers: "最大玩家数",
  Map: "地图",
  Mode: "难度",
  Owner: "服主 Steam ID",
  Perspective: "视角限制",
  Chatrate: "聊天冷却(秒)",
  Cycle: "昼夜循环(秒)",
  Timeout: "Ping 超时(ms)",
  Queue_Size: "排队上限",
  GSLT: "游戏服务器登录令牌",
  Password: "服务器密码",
  PvE: "PvE 模式",
  Bind: "监听 IP",
  LogChat: "记录聊天",
  LogJoin: "记录进/离",
  LogDeath: "记录死亡",
  LogAnticheat: "记录反作弊",
  VotifyAllow: "启用投票",
  VotifyPassCooldown: "通过冷却(秒)",
  VotifyFailCooldown: "失败冷却(秒)",
  VotifyDuration: "持续时长(秒)",
  VotifyPercentage: "通过百分比",
  VotifyPlayers: "最少玩家数",
  Loadout: "开局物品",
  Cheats: "启用作弊",
  Filter: "名称过滤",
  Whitelisted: "白名单模式",
  Gold: "仅 Gold 会员",
  Hide_Admins: "隐藏管理员",
  Sync: "跨服同步",
};

/** 空白初始值——除 Log 沿用 SDK 默认（Y/Y/Y/N）外其余字段从服务端文件读取 */
const EMPTY_FIELDS: CommandsFields = {
  Name: "",
  Port: "",
  MaxPlayers: "",
  Map: "",
  Mode: "",
  Owner: "",
  Perspective: "",
  Chatrate: "",
  Cycle: "",
  Timeout: "",
  Queue_Size: "",
  GSLT: "",
  Password: "",
  PvE: false,
  Bind: "",
  LogChat: true,
  LogJoin: true,
  LogDeath: true,
  LogAnticheat: false,
  VotifyAllow: false,
  VotifyPassCooldown: "5",
  VotifyFailCooldown: "60",
  VotifyDuration: "15",
  VotifyPercentage: "75",
  VotifyPlayers: "3",
  Loadout: [],
  Cheats: false,
  Filter: false,
  Whitelisted: false,
  Gold: false,
  Hide_Admins: false,
  Sync: false,
};

// ─── Config.txt fields ─────────────────────────────────

// ConfigTxtFields interface 与 EMPTY_TXT 默认值已迁移至 ./configTxtAdapter.ts
// ——helper 必须可独立单测（owner 网），不在 ConfigPage.tsx 内联。

// ─── Workshop row ──────────────────────────────────────

interface WorkshopRow {
  fileId: string;
  name: string;
  status: "enabled" | "disabled" | "pending_apply";
  selected: boolean;
  applied: boolean;
}

/** 后端 GET /mods/downloaded 响应项（BUG-6 修复后含 applied 字段） */
interface DownloadedMod {
  fileId: string;
  title?: string;
  authorName?: string;
  applied?: boolean;
  timeupdated?: number;
  size?: number;
}

const PAGE_SIZE = 10;

/**
 * 守卫壳组件——只做实例守卫 + 跳转副作用，业务 hooks 全在 ConfigContent 内。
 * React hooks 规则：所有 hook 必须无条件按固定顺序调用；这里提前 return 只影响
 * 本组件（不调业务 hooks），业务 hooks 在 ConfigContent 内稳定执行（修复 React #310）。
 */
export function ConfigPage() {
  const navigate = useNavigate();
  const guard = useRequireServer();
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (guard.status === "ready" || guard.status === "loading") {
      handledRef.current = null;
      return;
    }
    if (handledRef.current === guard.status) return;
    handledRef.current = guard.status;

    if (guard.status === "empty") {
      void navigate("/server-setup", { replace: true });
      toast.warning("请先选择一个实例");
    } else if (guard.status === "missing") {
      void navigate("/server-setup", { replace: true });
      toast.warning("该服务器实例不存在");
    }
  }, [guard.status, navigate]);

  if (guard.status !== "ready") return null;

  return <ConfigContent serverId={guard.serverId} />;
}

/** 配置内容组件——持有全部业务 hooks 与 JSX；serverId 由守卫壳校验后传入，此处恒有效 */
function ConfigContent({ serverId }: { serverId: string }) {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers.find((s) => s.id === serverId);

  const [tab, setTab] = useState<ConfigTab>("commands");
  const [fields, setFields] = useState<CommandsFields>(EMPTY_FIELDS);
  const [txtFields, setTxtFields] = useState<ConfigTxtFields>(EMPTY_TXT);
  const [workshopRows, setWorkshopRows] = useState<WorkshopRow[]>([]);
  const [workshopSearch, setWorkshopSearch] = useState("");
  const [workshopStatusFilter] = useState("全部状态");
  const [workshopPage, setWorkshopPage] = useState(1);

  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // v2.2：Workshop 应用变更（重启服务器）二次确认
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // ★ BUG-4：保存 Commands.dat 时保留原始未知键/注释（面板不认识但 U3DS 需要的行不能清掉）。
  // useRef 不触发渲染——只在加载时记录、保存时原样回传。
  const originalMetaRef = useRef<{
    unknown: Record<string, string>;
    comments: string[];
  }>({
    unknown: {},
    comments: [],
  });

  const fetchConfig = useCallback(async () => {
    if (!server) return;
    setConfigLoading(true);
    setConfigError(null);
    try {
      if (tab === "commands") {
        const res = await apiClient.get(
          `/servers/${server.id}/config/commands`,
        );
        const data = res.data.data;
        if (data) {
          // ★ BUG-4：记录原始未知键/注释——保存时原样回传，防止清空
          originalMetaRef.current = {
            unknown: data.unknown ?? {},
            comments: data.comments ?? [],
          };
          const known = data.known ?? {};
          const loadouts: LoadoutEntry[] = Array.isArray(data.loadouts)
            ? data.loadouts.map(
                (l: { skillsetId: number; itemIds: number[] }) => ({
                  skillsetId: Number(l.skillsetId),
                  itemIds: (l.itemIds ?? []).map(Number),
                }),
              )
            : [];
          setFields({
            ...EMPTY_FIELDS,
            ...Object.fromEntries(
              Object.entries(known).map(([k, v]) => [k, String(v)]),
            ),
            PvE: known.PvE !== undefined,
            // Log 字段：4 字段空格分隔 Y/N（CommandLog.cs:18-84），依次 Chat/Join/Death/Anticheat
            // 未配时回填 SDK 默认值 Y/Y/Y/N（CommandWindow.cs:49-52）——与 UI 默认一致
            ...(() => {
              if (known.Log === undefined) {
                return {
                  LogChat: true,
                  LogJoin: true,
                  LogDeath: true,
                  LogAnticheat: false,
                };
              }
              const parts = known.Log.split(/\s+/);
              return {
                LogChat: parts[0]?.toUpperCase() === "Y",
                LogJoin: parts[1]?.toUpperCase() === "Y",
                LogDeath: parts[2]?.toUpperCase() === "Y",
                LogAnticheat: parts[3]?.toUpperCase() === "Y",
              };
            })(),
            // Votify 字段：6 字段斜杠分隔（CommandVotify.cs:18），依次 Allow/PassCooldown/FailCooldown/Duration/Percentage/Players
            // 未配时回填 SDK 默认值（N/5/60/15/75/3，ChatManager.cs:76-81）——与 UI 默认一致
            ...(() => {
              if (known.Votify === undefined) {
                return {
                  VotifyAllow: false,
                  VotifyPassCooldown: "5",
                  VotifyFailCooldown: "60",
                  VotifyDuration: "15",
                  VotifyPercentage: "75",
                  VotifyPlayers: "3",
                };
              }
              const parts = known.Votify.split("/");
              return {
                VotifyAllow: parts[0]?.toUpperCase() === "Y",
                VotifyPassCooldown: parts[1] ?? "5",
                VotifyFailCooldown: parts[2] ?? "60",
                VotifyDuration: parts[3] ?? "15",
                VotifyPercentage: parts[4] ?? "75",
                VotifyPlayers: parts[5] ?? "3",
              };
            })(),
            Cheats: known.Cheats !== undefined,
            Filter: known.Filter !== undefined,
            Whitelisted: known.Whitelisted !== undefined,
            Gold: known.Gold !== undefined,
            Hide_Admins: known.Hide_Admins !== undefined,
            Sync: known.Sync !== undefined,
            Loadout: loadouts,
          });
        }
      } else if (tab === "txt") {
        const res = await apiClient.get(`/servers/${server.id}/config/txt`);
        const raw = res.data.data;
        if (raw?.sections) {
          // BUG-2 闭环：read 侧走 helper 解 entries[]——schema 真实形态是
          // sections[中文] = { name, entries: ConfigEntry[] }，不是裸 kv map
          const b = raw.sections["浏览器"],
            s = raw.sections["服务器"];
          const i = raw.sections["物品"],
            g = raw.sections["玩法开关"];
          setTxtFields({
            ...EMPTY_TXT,
            Login_Token: readStringEntry(b, "Login_Token"),
            完整描述: readStringEntry(b, "完整描述"),
            列表描述: readStringEntry(b, "列表描述"),
            图标URL: readStringEntry(b, "图标URL"),
            缩略图URL: readStringEntry(b, "缩略图URL"),
            VAC反作弊: readBoolEntry(s, "VAC反作弊"),
            BattlEye: readBoolEntry(s, "BattlEye"),
            最大Ping: readStringEntry(s, "最大Ping(ms)"),
            定时关机: readBoolEntry(s, "定时关机"),
            更新自动关机: readBoolEntry(s, "更新自动关机"),
            生成倍率: readStringEntry(i, "生成倍率"),
            物品耐久: readBoolEntry(i, "物品耐久"),
            掉落消失: readStringEntry(i, "掉落消失(s)"),
            重生时间: readStringEntry(i, "重生时间(s)"),
            肩后视角: readBoolEntry(g, "肩后视角"),
            自由建造: readBoolEntry(g, "自由建造"),
            玩家伤害: readBoolEntry(g, "玩家伤害"),
            允许自杀: readBoolEntry(g, "允许自杀"),
          });
        }
      } else {
        // v2.2 + BUG-6 修复：已下载 Mod 列表改走 /mods/downloaded（acf + File_IDs + WebAPI 元数据合并）
        const res = await apiClient.get(
          `/servers/${server.id}/mods/downloaded`,
        );
        const items: DownloadedMod[] = res.data.data ?? [];
        setWorkshopRows(
          items.map((item) => ({
            fileId: item.fileId,
            name: item.title || item.fileId,
            // ★ BUG-6 修复：3 态——applied=true(已应用) | applied=false(待应用)
            status: item.applied ? "enabled" : "pending_apply",
            applied: item.applied ?? false,
            selected: false,
          })),
        );
      }
      setDirty(false);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "加载配置失败");
    } finally {
      setConfigLoading(false);
    }
  }, [server, tab]);

  useEffect(() => {
    fetchConfig();
  }, [server?.id, tab]);

  const handleSave = async () => {
    if (!server) return;
    // v2.2：Workshop 分支先弹二次确认（apply 会重启服务器），确认后才执行
    if (tab === "workshop") {
      setApplyConfirmOpen(true);
      return;
    }
    setSaving(true);
    setConfigError(null);
    try {
      if (tab === "commands") {
        const known = new Map<string, string>();
        for (const [key, val] of Object.entries(fields)) {
          // Loadout 走独立 loadouts 字段，不进 known（避免空数组变成空字符串行）
          if (key === "Loadout") continue;
          if (
            [
              "PvE",
              "Cheats",
              "Filter",
              "Whitelisted",
              "Gold",
              "Hide_Admins",
              "Sync",
            ].includes(key)
          ) {
            if (val) known.set(key, "");
          } else if (val) known.set(key, String(val));
        }
        // Log 4 字段合成单行 'Y/N Y/N Y/N Y/N'（Chat/Join/Death/Anticheat）——总是写入，UI 默认 = SDK 默认（Y/Y/Y/N）
        const logLine = `${fields.LogChat ? "Y" : "N"} ${fields.LogJoin ? "Y" : "N"} ${fields.LogDeath ? "Y" : "N"} ${fields.LogAnticheat ? "Y" : "N"}`;
        known.set("Log", logLine);
        // Votify 6 字段合成单行 'Y/PassCooldown/FailCooldown/Duration/Percentage/Players'——总是写入，UI 默认 = SDK 默认（N/5/60/15/75/3，ChatManager.cs:76-81）
        const votifyLine = [
          fields.VotifyAllow ? "Y" : "N",
          fields.VotifyPassCooldown || "5",
          fields.VotifyFailCooldown || "60",
          fields.VotifyDuration || "15",
          fields.VotifyPercentage || "75",
          fields.VotifyPlayers || "3",
        ].join("/");
        known.set("Votify", votifyLine);
        await apiClient.put(`/servers/${server.id}/config/commands`, {
          known: Object.fromEntries(known),
          // ★ BUG-4：原样回传加载时记录的未知键/注释，防止保存把面板不认识的指令行清掉
          unknown: originalMetaRef.current.unknown,
          comments: originalMetaRef.current.comments,
          // Loadout 重复行独立上传——序列化时 ConfigService 按 loadouts 数组写多行
          loadouts: fields.Loadout,
        });
        // ★ 重启提示：Commands.dat 是服务端启动时读取的，改完要重启才生效（U3-SDK Provider.cs:6663-6700）
        toast.success("配置已保存，重启服务器后生效");
      } else if (tab === "txt") {
        // BUG-2 闭环：write 侧走 helper 包成 schema 真实形态——
        // sections: Record<sectionName, { name, entries: ConfigEntry[] }>
        const sections = buildTxtSections(txtFields);
        await apiClient.put(`/servers/${server.id}/config/txt`, {
          sections: Object.fromEntries(sections.map((s) => [s.name, s])),
        });
      }
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "保存配置失败");
    } finally {
      setSaving(false);
    }
  };

  /** v2.2：确认后执行 Workshop apply（触发重启流水线） */
  const handleApplyConfirm = async () => {
    if (!server) return;
    setApplyConfirmOpen(false);
    setSaving(true);
    setConfigError(null);
    try {
      const fileIds = workshopRows
        .filter((r) => r.status !== "disabled")
        .map((r) => r.fileId);
      await apiClient.post(`/servers/${server.id}/mods/apply`, { fileIds });
      toast.success("Mod 变更已提交，服务器正在重启应用...");
      setDirty(false);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "应用变更失败");
      toast.error(err instanceof Error ? err.message : "应用变更失败");
    } finally {
      setSaving(false);
    }
  };

  /** v2.2：删除 Mod——先确认，确认后调 DELETE 端点（acf + content + File_IDs 同步删） */
  const handleDeleteConfirm = async () => {
    if (!server || !deleteConfirm) return;
    const fileId = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await apiClient.delete(`/servers/${server.id}/mods/${fileId}`);
      setWorkshopRows((prev) => prev.filter((r) => r.fileId !== fileId));
      toast.success("Mod 已删除");
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "删除 Mod 失败");
      toast.error(err instanceof Error ? err.message : "删除 Mod 失败");
    }
  };

  const handleFieldChange = (
    key: keyof CommandsFields,
    value: string | boolean | LoadoutEntry[],
  ) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const handleTxtChange = (
    key: keyof ConfigTxtFields,
    value: string | boolean,
  ) => {
    setTxtFields((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const toggleWsSelect = (fileId: string) =>
    setWorkshopRows((prev) =>
      prev.map((r) =>
        r.fileId === fileId ? { ...r, selected: !r.selected } : r,
      ),
    );
  const toggleWsStatus = (fileId: string) => {
    setWorkshopRows((prev) => {
      setDirty(true);
      return prev.map((r) =>
        r.fileId === fileId
          ? {
              ...r,
              status: r.status === "enabled" ? "disabled" : "enabled",
              applied: r.status === "enabled" ? false : true,
            }
          : r,
      );
    });
  };
  const removeWs = (fileId: string) => {
    setDeleteConfirm(fileId);
  };

  const filteredWorkshop = workshopRows.filter((r) => {
    const m =
      r.name.toLowerCase().includes(workshopSearch.toLowerCase()) ||
      r.fileId.includes(workshopSearch);
    const s =
      workshopStatusFilter === "全部状态" ||
      (workshopStatusFilter === "已应用" && r.status === "enabled") ||
      (workshopStatusFilter === "待应用" && r.status === "pending_apply") ||
      (workshopStatusFilter === "未启用" && r.status === "disabled");
    return m && s;
  });
  const wsPaged = filteredWorkshop.slice(
    (workshopPage - 1) * PAGE_SIZE,
    workshopPage * PAGE_SIZE,
  );

  // ── Loading / Error ──
  if (serverLoading || configLoading)
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        <span className="text-sm text-slate-400">加载中...</span>
      </Centered>
    );
  if (serverError || configError)
    return (
      <Centered>
        <AlertCircle size={32} className="text-red-500" />
        <span className="text-sm text-slate-100">无法加载配置</span>
        <span className="text-xs text-slate-500">
          {serverError || configError}
        </span>
        <Button
          onClick={fetchConfig}
          variant="ghost"
          size="sm"
          className="text-slate-400"
        >
          重试
        </Button>
      </Centered>
    );
  // 无服务器时仍然渲染完整页面骨架，仅禁用保存

  return (
    <div className="flex flex-col h-full">
      {/* Header + TabBar */}
      <div className="shrink-0 px-4 md:px-6 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <h1 className="text-[15px] font-semibold text-slate-100">
            服务器配置
          </h1>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-500">
                <Check size={14} /> 已保存
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={!dirty || saving || !server}
              size="sm"
              className={`h-8 text-xs gap-1.5 ${dirty ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-500"}`}
            >
              <Save size={14} /> {saving ? "保存中..." : "保存配置"}
            </Button>
          </div>
        </div>
        <TabBar
          tabs={[
            { key: "commands", label: "Commands.dat", icon: FileText },
            { key: "txt", label: "Config.txt", icon: Cpu },
            { key: "workshop", label: "Workshop", icon: Wrench },
          ]}
          active={tab}
          onChange={(k) => {
            setTab(k as ConfigTab);
            setDirty(false);
          }}
        />
      </div>

      {/* Content: 左侧主表 + 右侧 Tips Panel（小屏隐藏 Tips） */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-4 p-4 md:p-6 pt-4">
        {/* Main */}
        <div className="flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-950 min-w-0">
          {tab === "commands" && (
            <CommandsTab fields={fields} onChange={handleFieldChange} />
          )}
          {tab === "txt" && (
            <ConfigTxtTab fields={txtFields} onChange={handleTxtChange} />
          )}
          {tab === "workshop" && (
            <WorkshopTab
              rows={filteredWorkshop}
              paged={wsPaged}
              search={workshopSearch}
              onSearch={setWorkshopSearch}
              statusFilter={workshopStatusFilter}
              page={workshopPage}
              onPage={setWorkshopPage}
              onToggleSelect={toggleWsSelect}
              onToggleStatus={toggleWsStatus}
              onRemove={removeWs}
            />
          )}
        </div>
        {/* Tips Panel — 小屏隐藏 */}
        <div
          className="hidden lg:block shrink-0 rounded-lg p-5 border border-slate-700 bg-slate-800 self-start"
          style={{ width: 292 }}
        >
          <h3 className="text-sm font-semibold text-slate-100 mb-3">
            💡 配置提示
          </h3>
          <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
            <p>修改配置后需点击「保存配置」才会生效。</p>
            <p>部分参数（端口、地图）需重启服务器才能应用。</p>
            <p>
              游戏服务器登录令牌在
              <a
                href="https://steamcommunity.com/dev/managegameservers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline"
              >
                Steam 服务器管理页面
              </a>
              申请（Steam 应用 ID 304930）。
            </p>
            <p>未知命令行参数会被保留，不会被面板删除。</p>
          </div>
        </div>
      </div>

      {/* v2.2：Workshop 应用变更确认（会重启服务器） */}
      <ConfirmDialog
        open={applyConfirmOpen}
        title="应用 Mod 变更"
        message="将保存 Mod 列表并重启服务器（存档 → 优雅关服 → 应用 Mod → 重启）。确认继续？"
        confirmLabel="确认重启"
        variant="default"
        icon={RefreshCw}
        loading={saving}
        onConfirm={handleApplyConfirm}
        onCancel={() => setApplyConfirmOpen(false)}
      />

      {/* v2.2：删除 Mod 确认（acf + content + File_IDs 同步删） */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="删除 Mod"
        message={`确定删除 Mod ${deleteConfirm}？将同时移除下载内容与启用列表。`}
        confirmLabel="删除"
        variant="danger"
        icon={AlertCircle}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

// ── Centered state ──
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

// ── Commands.dat tab ──
function CommandsTab({
  fields,
  onChange,
}: {
  fields: CommandsFields;
  onChange: (
    k: keyof CommandsFields,
    v: string | boolean | LoadoutEntry[],
  ) => void;
}) {
  return (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConfigSection title="身份">
          {(["Name", "Owner", "Password"] as const).map((k) => (
            <ConfigField
              key={k}
              label={FIELD_LABELS[k]}
              value={String(fields[k])}
              onChange={(v) => onChange(k, v)}
              type={k === "Password" ? "password" : "text"}
              placeholder={
                k === "Name"
                  ? "Unturned（5–50 字符）"
                  : k === "Owner"
                    ? "17 位 Steam ID"
                    : undefined
              }
            />
          ))}
        </ConfigSection>
        <ConfigSection title="地图与模式">
          {/* 地图：官方地图做建议（datalist 不限制输入——装了 Workshop 地图直接手输地图名即可） */}
          <ConfigField
            label={FIELD_LABELS.Map}
            value={String(fields.Map)}
            onChange={(v) => onChange("Map", v)}
            suggestions={COMMANDS_DAT_ENUMS.Map}
            placeholder="PEI"
          />
          {/* 难度/视角：固定枚举下拉，选项来自 shared 常量（EGameMode.cs / ECameraMode.cs 真源） */}
          <ConfigField
            label={FIELD_LABELS.Mode}
            value={String(fields.Mode)}
            onChange={(v) => onChange("Mode", v)}
            options={COMMANDS_DAT_ENUMS.Mode}
            placeholder="使用服务端默认（普通）"
          />
          <ConfigField
            label={FIELD_LABELS.Perspective}
            value={String(fields.Perspective)}
            onChange={(v) => onChange("Perspective", v)}
            options={COMMANDS_DAT_ENUMS.Perspective}
            placeholder="使用服务端默认（第一人称）"
          />
          <ConfigToggle
            label={FIELD_LABELS.PvE}
            checked={fields.PvE}
            onChange={(v) => onChange("PvE", v)}
          />
        </ConfigSection>
        <ConfigSection title="网络">
          {(
            ["Port", "MaxPlayers", "Timeout", "Queue_Size", "Bind"] as const
          ).map((k) => (
            <ConfigField
              key={k}
              label={FIELD_LABELS[k]}
              value={String(fields[k])}
              onChange={(v) => onChange(k, v)}
              placeholder={
                k === "Port"
                  ? "27015（查询端口 = Port+1）"
                  : k === "MaxPlayers"
                    ? "8（1–200）"
                    : k === "Timeout"
                      ? "750（ms）"
                      : k === "Queue_Size"
                        ? "8"
                        : k === "Bind"
                          ? "0.0.0.0（监听所有接口）"
                          : undefined
              }
            />
          ))}
        </ConfigSection>
        <ConfigSection title="安全与权限">
          {(
            [
              "Whitelisted",
              "Gold",
              "Hide_Admins",
              "Cheats",
              "Filter",
              "Sync",
            ] as const
          ).map((k) => (
            <ConfigToggle
              key={k}
              label={FIELD_LABELS[k]}
              checked={fields[k]}
              onChange={(v) => onChange(k, v)}
            />
          ))}
        </ConfigSection>
        <ConfigSection title="日志">
          <p className="text-xs mb-2" style={{ color: "#64748B" }}>
            默认值（与 Unturned
            服务端保持一致）：记录聊天/进离/死亡，不记录反作弊
          </p>
          {(["LogChat", "LogJoin", "LogDeath", "LogAnticheat"] as const).map(
            (k) => (
              <ConfigToggle
                key={k}
                label={FIELD_LABELS[k]}
                checked={fields[k]}
                onChange={(v) => onChange(k, v)}
              />
            ),
          )}
        </ConfigSection>
        <ConfigSection title="投票">
          <ConfigToggle
            label={FIELD_LABELS.VotifyAllow}
            checked={fields.VotifyAllow}
            onChange={(v) => onChange("VotifyAllow", v)}
          />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
            {(
              [
                [
                  "VotifyPassCooldown",
                  "通过冷却(秒)",
                  "5（ChatManager.cs:77）",
                ],
                [
                  "VotifyFailCooldown",
                  "失败冷却(秒)",
                  "60（ChatManager.cs:78）",
                ],
                ["VotifyDuration", "持续时长(秒)", "15（ChatManager.cs:79）"],
                [
                  "VotifyPercentage",
                  "通过百分比(0–100)",
                  "75（ChatManager.cs:80）",
                ],
                ["VotifyPlayers", "最少玩家数", "3（ChatManager.cs:81）"],
              ] as const
            ).map(([k, label, ph]) => (
              <ConfigField
                key={k}
                label={label}
                value={String(fields[k as keyof CommandsFields])}
                onChange={(v) => onChange(k as keyof CommandsFields, v)}
                placeholder={ph}
              />
            ))}
          </div>
        </ConfigSection>
        <div className="md:col-span-2">
          <ConfigSection title="游戏参数">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["Chatrate", "Cycle", "GSLT"] as const).map((k) => (
                <ConfigField
                  key={k}
                  label={FIELD_LABELS[k]}
                  value={String(fields[k])}
                  onChange={(v) => onChange(k, v)}
                  type={k === "GSLT" ? "password" : "text"}
                  placeholder={
                    k === "Chatrate"
                      ? "0.25（秒）"
                      : k === "Cycle"
                        ? "3600（秒/昼夜循环）"
                        : undefined
                  }
                />
              ))}
            </div>
          </ConfigSection>
        </div>
        <div className="md:col-span-2">
          <LoadoutEditor
            loadouts={fields.Loadout}
            onChange={(next) => onChange("Loadout", next)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Config.txt tab ──
function ConfigTxtTab({
  fields,
  onChange,
}: {
  fields: ConfigTxtFields;
  onChange: (k: keyof ConfigTxtFields, v: string | boolean) => void;
}) {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <TxtSection
        title="浏览器"
        fields={
          [
            ["Login_Token", "Steam 浏览器登录令牌", "text"],
            ["完整描述", "完整描述", "text"],
            ["列表描述", "列表描述", "text"],
            ["图标URL", "图标URL", "text"],
            ["缩略图URL", "缩略图URL", "text"],
          ] as const
        }
        txtFields={fields}
        onChange={onChange}
      />
      <TxtSection
        title="服务器"
        fields={
          [
            ["VAC反作弊", "VAC反作弊", "toggle"],
            ["BattlEye", "BattlEye", "toggle"],
            ["最大Ping", "最大Ping(ms)", "text"],
            ["定时关机", "定时关机", "toggle"],
            ["更新自动关机", "更新自动关机", "toggle"],
          ] as const
        }
        txtFields={fields}
        onChange={onChange}
      />
      <TxtSection
        title="物品"
        fields={
          [
            ["生成倍率", "生成倍率", "text"],
            ["物品耐久", "物品耐久", "toggle"],
            ["掉落消失", "掉落消失(s)", "text"],
            ["重生时间", "重生时间(s)", "text"],
          ] as const
        }
        txtFields={fields}
        onChange={onChange}
      />
      <TxtSection
        title="玩法开关"
        fields={
          [
            ["肩后视角", "肩后视角", "toggle"],
            ["自由建造", "自由建造", "toggle"],
            ["玩家伤害", "玩家伤害", "toggle"],
            ["允许自杀", "允许自杀", "toggle"],
          ] as const
        }
        txtFields={fields}
        onChange={onChange}
      />
    </div>
  );
}

function TxtSection({
  title,
  fields: fieldDefs,
  txtFields,
  onChange,
}: {
  title: string;
  fields: readonly (readonly [
    keyof ConfigTxtFields,
    string,
    "text" | "toggle",
  ])[];
  txtFields: ConfigTxtFields;
  onChange: (k: keyof ConfigTxtFields, v: string | boolean) => void;
}) {
  return (
    <ConfigSection title={title}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {fieldDefs.map(([k, label, type]) =>
          type === "toggle" ? (
            <ConfigToggle
              key={k}
              label={label}
              checked={!!txtFields[k]}
              onChange={(v) => onChange(k, v)}
            />
          ) : (
            <ConfigField
              key={k}
              label={label}
              value={String(txtFields[k] ?? "")}
              onChange={(v) => onChange(k, v)}
            />
          ),
        )}
      </div>
    </ConfigSection>
  );
}

// ── Workshop tab ──

const WS_COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Mod名称" },
  { key: "fileId", label: "Workshop ID" },
  { key: "status", label: "状态" },
  { key: "actions", label: "操作" },
];

function WorkshopTab({
  rows,
  paged,
  search,
  onSearch,
  statusFilter,
  page,
  onPage,
  onToggleSelect,
  onToggleStatus,
  onRemove,
}: {
  rows: WorkshopRow[];
  paged: WorkshopRow[];
  search: string;
  onSearch: (v: string) => void;
  statusFilter: string;
  page: number;
  onPage: (p: number) => void;
  onToggleSelect: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const rowData = paged.map((r) => ({
    _key: r.fileId,
    name: (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={r.selected}
          onChange={() => onToggleSelect(r.fileId)}
          className="w-4 h-4 rounded accent-emerald-500"
        />
        <span className="text-slate-200 truncate">{r.name}</span>
      </div>
    ),
    fileId: (
      <span className="font-mono text-xs text-slate-400">{r.fileId}</span>
    ),
    status: <StatusBadge status={r.status} />,
    actions: (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onToggleStatus(r.fileId)}
          className={`px-2.5 py-0.5 rounded text-[11px] text-white ${r.status === "enabled" ? "bg-red-500" : "bg-emerald-500"}`}
        >
          {r.status === "enabled" ? "禁用" : "启用"}
        </button>
        <button
          onClick={() => onRemove(r.fileId)}
          className="px-2.5 py-0.5 rounded text-[11px] bg-red-500 text-black"
        >
          移除
        </button>
      </div>
    ),
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="shrink-0 p-4 pb-2 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder="筛选Mod..."
          width={200}
        />
        <div
          className="flex items-center rounded-md px-3 h-9 text-sm text-slate-400 border border-slate-700 bg-slate-950"
          style={{ width: 120 }}
        >
          {statusFilter}
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          className="h-9 text-xs gap-1 bg-emerald-500 text-white"
        >
          一键更新
        </Button>
        <Button size="sm" variant="outline" className="h-9 text-xs gap-1">
          批量更新
        </Button>
      </div>
      <div className="shrink-0 mx-4 border-t border-slate-800" />
      <div className="flex flex-col flex-1 px-4">
        <DataTable
          columns={WS_COLUMNS}
          data={rowData}
          keyField="_key"
          emptyText="暂无创意工坊 Mod"
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: rows.length,
            onPageChange: onPage,
          }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: WorkshopRow["status"] }) {
  const map: Record<WorkshopRow["status"], string> = {
    enabled: "bg-emerald-500",
    disabled: "bg-slate-500",
    pending_apply: "bg-amber-500", // ★ BUG-6 修复：待应用状态
  };
  const text: Record<WorkshopRow["status"], string> = {
    enabled: "已应用",
    disabled: "未启用",
    pending_apply: "待应用",
  };
  return (
    <span
      className={`inline-flex px-2.5 py-0.5 rounded text-[10px] font-medium text-white ${map[status]}`}
    >
      {text[status]}
    </span>
  );
}
