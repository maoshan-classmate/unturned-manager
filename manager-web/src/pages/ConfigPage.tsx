import { useState, useCallback, useEffect, useRef } from "react";
import { COMMANDS_DAT_ENUMS } from "@unturned-manager/shared";
import {
  Save,
  AlertCircle,
  Loader2,
  Check,
  FileText,
  Wrench,
  Cpu,
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
import { NoInstanceGuide } from "../components/shared/NoInstanceGuide.js";
import { useRequireServer } from "../hooks/useRequireServer.js";
import { useServer } from "../hooks/useServer.js";
import { apiClient } from "../api/client.js";
import { Button } from "../components/ui/button.js";
import {
  buildTxtSections,
  mergeTxtSections,
  readBoolEntry,
  readStringEntry,
  getModeDefaults,
  TXT_FIELD_DEFAULTS,
  EMPTY_TXT_FIELDS as EMPTY_TXT,
  type ConfigTxtFields,
} from "./configTxtAdapter.js";
import { TXT_FIELD_DEFS } from "./txtFieldDefs.js";
import { PER_MODE_DEFAULTS } from "./perModeDefaults.js";
import type { ConfigSection as ApiConfigSection } from "@unturned-manager/shared";

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

/**
 * 空白初始值——含 SDK 默认值（用于「预览 + 真实写入」）：
 * - 公共字段（Name/Port/MaxPlayers/Map/Mode/Perspective/Chatrate/Cycle/Timeout/Queue_Size/Bind）
 *   填入 SDK 默认值（reference_config_files.md §1.1-1.5 + Provider.cs:6615-6645），
 *   保存时 known.set 非空字段 → commands.dat 实际写入，UI 与磁盘一致；
 * - 私人字段（Owner/GSLT/Password）保持空串——不应自动落盘（玩家私人凭证）；
 * - Log / Votify 复合字段填 SDK 默认值（CommandWindow.cs:49-52 / ChatManager.cs:76-81），
 *   handleSave 硬编码 known.set 不受 if(val) 过滤。
 */
const EMPTY_FIELDS: CommandsFields = {
  Name: "Unturned",
  Port: "27015",
  MaxPlayers: "8",
  Map: "PEI",
  Mode: "Normal",
  Owner: "",
  Perspective: "First",
  Chatrate: "0.25",
  Cycle: "3600",
  Timeout: "750",
  Queue_Size: "8",
  GSLT: "",
  Password: "",
  PvE: false,
  Bind: "0",
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
 * 守卫壳组件——只做实例守卫，业务 hooks 全在 ConfigContent 内。
 * 无实例时内容区渲染占位卡（NoInstanceGuide）引导去创建，不再自动跳转 + toast。
 * React hooks 规则：所有 hook 必须无条件按固定顺序调用；这里提前 return 只影响
 * 本组件（不调业务 hooks），业务 hooks 在 ConfigContent 内稳定执行（修复 React #310）。
 */
export function ConfigPage() {
  const guard = useRequireServer();

  if (guard.status !== "ready") {
    return (
      <NoInstanceGuide
        reason={guard.status === "missing" ? "missing" : "empty"}
      />
    );
  }

  return <ConfigContent serverId={guard.serverId} />;
}

/** 配置内容组件——持有全部业务 hooks 与 JSX；serverId 由守卫壳校验后传入，此处恒有效 */
function ConfigContent({ serverId }: { serverId: string }) {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers.find((s) => s.id === serverId);

  const [tab, setTab] = useState<ConfigTab>("commands");
  const [fields, setFields] = useState<CommandsFields>(EMPTY_FIELDS);
  const [txtFields, setTxtFields] = useState<ConfigTxtFields>(EMPTY_TXT);
  // ★ 2026-08-14 方案 2：全部配置（13 节 295 字段）的可编辑副本——「显示全部配置」展开区直接改它
  const [allTxtSections, setAllTxtSections] = useState<Record<
    string,
    ApiConfigSection
  > | null>(null);
  const [workshopRows, setWorkshopRows] = useState<WorkshopRow[]>([]);
  const [workshopSearch, setWorkshopSearch] = useState("");
  const [workshopStatusFilter] = useState("全部状态");
  const [workshopPage, setWorkshopPage] = useState(1);

  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
  // ★ 2026-08-14 方案 1：保存 Config.txt 时保留原始完整 sections（13 节约 295 字段）——
  // 只用 18 个 UI 字段覆盖会删掉未托管 section/键/注释（数据丢失）。加载时记录原始 sections，
  // 保存时 mergeTxtSections 合并后再整体写回。
  const originalTxtSectionsRef = useRef<Record<string, ApiConfigSection>>({});

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
              const parts = known.Log.split("/");
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
          // ★ 2026-08-14 方案 1：记录原始完整 sections——保存时 merge 合并，不丢未托管内容
          const rawSections = raw.sections as Record<string, ApiConfigSection>;
          originalTxtSectionsRef.current = rawSections;
          // 方案 2：可编辑副本（深拷贝，不引用原始 ref）
          setAllTxtSections(
            Object.fromEntries(
              Object.entries(rawSections).map(([name, sec]) => [
                name,
                {
                  name: sec.name,
                  entries: sec.entries.map((e) => ({ ...e })),
                  rawBlocks: sec.rawBlocks ? [...sec.rawBlocks] : undefined,
                },
              ]),
            ),
          );
          // BUG-2 闭环 + Bug B-1 修复：read 侧走 helper 解 entries[]——
          // Bug B-1 改用 SDK 英文 section 名（[Browser]/[Server]/[Items]/[Gameplay]）+ SDK 英文 key（PlayConfigData.cs C# 字段名）
          const b = raw.sections["Browser"],
            s = raw.sections["Server"];
          const i = raw.sections["Items"],
            g = raw.sections["Gameplay"];
          setTxtFields({
            ...EMPTY_TXT,
            Login_Token: readStringEntry(b, "Login_Token"),
            Desc_Full: readStringEntry(b, "Desc_Full"),
            Desc_Server_List: readStringEntry(b, "Desc_Server_List"),
            Icon: readStringEntry(b, "Icon"),
            Thumbnail: readStringEntry(b, "Thumbnail"),
            // ★ 2026-08-14：readBoolEntry 传 SDK 默认值——文件缺失时显示官方默认而非恒 false
            VAC_Secure: readBoolEntry(s, "VAC_Secure", true),
            BattlEye_Secure: readBoolEntry(s, "BattlEye_Secure", true),
            Max_Ping_Milliseconds: readStringEntry(s, "Max_Ping_Milliseconds"),
            Enable_Scheduled_Shutdown: readBoolEntry(s, "Enable_Scheduled_Shutdown", false),
            Enable_Update_Shutdown: readBoolEntry(s, "Enable_Update_Shutdown", false),
            Spawn_Chance: readStringEntry(i, "Spawn_Chance"),
            Has_Durability: readBoolEntry(i, "Has_Durability", true),
            Despawn_Dropped_Time: readStringEntry(i, "Despawn_Dropped_Time"),
            Respawn_Time: readStringEntry(i, "Respawn_Time"),
            Allow_Shoulder_Camera: readBoolEntry(g, "Allow_Shoulder_Camera", true),
            Allow_Freeform_Buildables: readBoolEntry(g, "Allow_Freeform_Buildables", true),
            Friendly_Fire: readBoolEntry(g, "Friendly_Fire", false),
            Can_Suicide: readBoolEntry(g, "Can_Suicide", true),
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
        // Log 4 字段合成单行 'Y/N/Y/N/Y/N/Y/N'（Chat/JoinLeave/Death/Anticheat，`/` 分隔，CommandLog.cs:18 Parser.getComponentsFromSerial(_, '/')，长度必须 = 4）——总是写入，UI 默认 = SDK 默认（Y/Y/Y/N，CommandWindow.cs:49-52）
        const logLine = [
          fields.LogChat ? "Y" : "N",
          fields.LogJoin ? "Y" : "N",
          fields.LogDeath ? "Y" : "N",
          fields.LogAnticheat ? "Y" : "N",
        ].join("/");
        known.set("Log", logLine);
        // Votify 6 字段合成单行 'Y/PassCooldown/FailCooldown/Duration/Percentage/Players'——仅在启用投票时写入。
        // 关闭投票 → 不写 Votify 行，U3DS 走 SDK 默认（ChatManager.cs:76-81：voteAllowed=false + 5 数字默认），
        // 等价于「投票关闭 + 5 参数无意义」。避免面板留 5 个数字让玩家困惑。
        if (fields.VotifyAllow) {
          const votifyLine = [
            "Y",
            fields.VotifyPassCooldown || "5",
            fields.VotifyFailCooldown || "60",
            fields.VotifyDuration || "15",
            fields.VotifyPercentage || "75",
            fields.VotifyPlayers || "3",
          ].join("/");
          known.set("Votify", votifyLine);
        }
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
        // ★ 2026-08-14 方案 1+2：合并保存。
        // 基准 = allTxtSections（方案 2 可编辑副本，已含未托管 section/键的编辑）；
        // 再把 18 个 UI 托管字段 merge 覆盖（方案 1）——两类编辑都生效，未托管内容不丢。
        const base = allTxtSections ?? originalTxtSectionsRef.current;
        const merged = mergeTxtSections(base, txtFields);
        await apiClient.put(`/servers/${server.id}/config/txt`, {
          sections: merged,
        });
      } else if (tab === "workshop") {
        // v2.6：保存与重启解耦——只写 File_IDs（运行时安全，U3DS 只在启动时读）。
        // staging → content 移动在 ServerManager.startInternal 自动执行（U3DS STOPPED 时）。
        // 用户在控制台/首页手动「重启」后即生效。
        const fileIds = workshopRows
          .filter((r) => r.status !== "disabled")
          .map((r) => r.fileId);
        await apiClient.put(`/servers/${server.id}/config/workshop`, {
          fileIds,
        });
        toast.success("Mod 列表已保存，重启服务器后生效");
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

  /** ★ 2026-08-14 方案 2：编辑「全部配置」展开区里的未托管字段——直接改可编辑副本 */
  const updateRawEntry = useCallback(
    (sectionName: string, key: string, value: string | null) => {
      setAllTxtSections((prev) => {
        if (!prev) return prev;
        const section = prev[sectionName];
        if (!section) return prev;
        return {
          ...prev,
          [sectionName]: {
            ...section,
            entries: section.entries.map((e) =>
              e.key === key ? { ...e, value } : e,
            ),
          },
        };
      });
      setDirty(true);
    },
    [],
  );

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

  // ── 内容区加载 / 错误 ──
  // ★ 页面骨架（Header + TabBar + Tips）常驻不遮罩——只有 Main 内容区在加载/错误时切换显示。
  // Workshop 标签加载慢（/mods/downloaded 合并 acf + WebAPI 元数据），整页遮罩会把 TabBar 也盖住，
  // 用户无法切回其他标签；serverLoading 只在 useServer 列表未就绪（server 未找到）时兜底。
  const contentLoading = configLoading || (serverLoading && !server);
  const contentError = configError || serverError;

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
            { key: "commands", label: "基本设置", icon: FileText },
            { key: "txt", label: "高级设置", icon: Cpu },
            { key: "workshop", label: "Mod 列表", icon: Wrench },
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
        {/* Main——加载/错误只在内容区显示，Header/TabBar/Tips 常驻 */}
        <div className="flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-950 min-w-0">
          {contentLoading ? (
            <Centered>
              <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
              <span className="text-sm text-slate-400">加载中...</span>
            </Centered>
          ) : contentError ? (
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
          ) : (
            <>
              {tab === "commands" && (
                <CommandsTab fields={fields} onChange={handleFieldChange} />
              )}
              {tab === "txt" && (
                <ConfigTxtTab
                  fields={txtFields}
                  onChange={handleTxtChange}
                  currentMode={fields.Mode}
                  allSections={allTxtSections}
                  onUpdateRawEntry={updateRawEntry}
                />
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
            </>
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
                <div key={k}>
                  <ConfigField
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
                  {k === "GSLT" && (
                    <p
                      className="text-[11px] mt-1 leading-relaxed"
                      style={{ color: "#64748B" }}
                    >
                      也可在「Config.txt → 浏览器」页签的「Steam 浏览器登录令牌」处填写，两者等效；此处优先级更高。
                    </p>
                  )}
                </div>
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

/**
 * 难度值 → 中文标签。
 * ★ 2026-08-14：未配置难度时显示「官方默认（普通）」——U3DS 未写 Mode 命令默认 Normal
 * （EGameMode.cs），玩家不理解「未配置」意味着什么。
 *
 * @param mode - Commands.dat 的 Mode 值（Easy/Normal/Hard）；空/未知按官方默认 Normal 兜底
 * @returns 界面用语的中文难度标签
 */
function formatModeLabel(mode: string): string {
  const found = COMMANDS_DAT_ENUMS.Mode.find((m) => m.value === mode);
  if (found) return found.label;
  return "官方默认（普通）";
}

function ConfigTxtTab({
  fields,
  onChange,
  currentMode,
  allSections,
  onUpdateRawEntry,
}: {
  fields: ConfigTxtFields;
  onChange: (k: keyof ConfigTxtFields, v: string | boolean) => void;
  /** 当前 Commands.dat 的 Mode 值（Easy/Normal/Hard）——[Items]/[Gameplay] 写入值应用此 mode */
  currentMode: string;
  /** 全部配置（13 节）可编辑副本——未托管模块卡片用 */
  allSections: Record<string, ApiConfigSection> | null;
  /** 编辑全部配置里的未托管字段 */
  onUpdateRawEntry: (sectionName: string, key: string, value: string | null) => void;
}) {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="rounded-md border px-3 py-2" style={{ borderColor: "#334059", backgroundColor: "#1E293B" }}>
        <p className="text-xs" style={{ color: "#94A3B8" }}>
          当前生效难度：<span style={{ color: "#22C55E" }}>{formatModeLabel(currentMode)}</span>
        </p>
        <p className="mt-1 text-xs" style={{ color: "#64748B" }}>
          此页面的物品与玩法设置会应用到当前难度。留空的项目将采用 Unturned 官方默认值。
          如需切换难度，请到「Commands.dat」标签页修改「难度」并保存。
        </p>
      </div>
      <TxtSection
        title="浏览器"
        sectionName="Browser"
        fields={
          [
            [
              "Login_Token",
              "AppID 304930 申请的令牌；与 Commands.dat 的游戏服务器登录令牌选填其一即可",
            ],
            ["Desc_Full"],
            ["Desc_Server_List"],
            ["Icon"],
            ["Thumbnail"],
          ] as const
        }
        txtFields={fields}
        currentMode={currentMode}
        onChange={onChange}
      />
      <TxtSection
        title="服务器"
        sectionName="Server"
        fields={
          [
            ["VAC_Secure"],
            ["BattlEye_Secure"],
            ["Max_Ping_Milliseconds"],
            ["Enable_Scheduled_Shutdown"],
            ["Enable_Update_Shutdown"],
          ] as const
        }
        txtFields={fields}
        currentMode={currentMode}
        onChange={onChange}
      />
      <TxtSection
        title="物品"
        sectionName="Items"
        fields={
          [
            ["Spawn_Chance"],
            ["Has_Durability"],
            ["Despawn_Dropped_Time"],
            ["Respawn_Time"],
          ] as const
        }
        txtFields={fields}
        currentMode={currentMode}
        onChange={onChange}
      />
      <TxtSection
        title="玩法开关"
        sectionName="Gameplay"
        fields={
          [
            ["Allow_Shoulder_Camera"],
            ["Allow_Freeform_Buildables"],
            ["Friendly_Fire"],
            ["Can_Suicide"],
          ] as const
        }
        txtFields={fields}
        currentMode={currentMode}
        onChange={onChange}
      />

      {/* ★ 2026-08-14 方案 2：细节调整说明卡片（与「当前生效难度」同款）——下方为未托管模块，各自独立卡片默认收起 */}
      <div className="rounded-md border px-3 py-2" style={{ borderColor: "#334059", backgroundColor: "#1E293B" }}>
        <p className="text-xs" style={{ color: "#94A3B8" }}>
          细节调整
        </p>
        <p className="mt-1 text-xs" style={{ color: "#64748B" }}>
          以下按模块分组，展开可编辑高级选项。不了解含义的字段请保留默认（留空 = 使用官方默认值）。
        </p>
      </div>

      {/* 未托管模块各自独立卡片（载具/僵尸/玩家等），默认收起可展开编辑 */}
      {allSections &&
        Object.entries(allSections)
          .filter(([name]) => !["Browser", "Server", "Items", "Gameplay"].includes(name))
          .map(([name, section]) => (
            <RawSectionBlock
              key={name}
              sectionName={name}
              section={section}
              currentMode={currentMode}
              onUpdate={onUpdateRawEntry}
            />
          ))}
      {(!allSections ||
        Object.entries(allSections).filter(
          ([name]) => !["Browser", "Server", "Items", "Gameplay"].includes(name),
        ).length === 0) && (
        <p className="text-xs text-slate-500">
          暂无可展开的细节模块——请先保存一次配置后再查看
        </p>
      )}
    </div>
  );
}

/**
 * 取字段的 placeholder（SDK 官方默认值预览）。
 * ★ 2026-08-14：未填值时显示官方默认——固定值查 TXT_FIELD_DEFAULTS，
 * per-mode 字段（Spawn_Chance/Respawn_Time）按 currentMode 动态取。
 * 返回 undefined 表示无默认值（Browser 段 string 字段），不渲染 placeholder。
 */
function getFieldPlaceholder(
  key: string,
  mode: string,
): string | undefined {
  if (key in TXT_FIELD_DEFAULTS) return String(TXT_FIELD_DEFAULTS[key]);
  const modeDefaults = getModeDefaults(mode);
  if (key in modeDefaults) return String(modeDefaults[key]);
  return undefined;
}

/** 全部配置折叠面板——一个 section（模块）一组，默认收起，展开编辑字段 */
function RawSectionBlock({
  sectionName,
  section,
  currentMode,
  onUpdate,
}: {
  /** 模块名（SDK section 名，如 Vehicles/Zombies） */
  sectionName: string;
  /** 该模块的字段 */
  section: ApiConfigSection;
  /** 当前 Commands.dat Mode（Easy/Normal/Hard）——per-mode bool 默认值按它取 */
  currentMode: string;
  /** 编辑字段回调 */
  onUpdate: (sectionName: string, key: string, value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // 模块中文名映射（用户可读）；未知则用原始名
  const MODULE_LABELS: Record<string, string> = {
    Vehicles: "载具",
    Zombies: "僵尸",
    Animals: "动物",
    Barricades: "路障",
    Structures: "建筑",
    Players: "玩家",
    Objects: "物体",
    Events: "事件",
    UnityEvents: "内置事件",
    Gameplay: "玩法",
  };
  const label = MODULE_LABELS[sectionName] ?? sectionName;

  return (
    <ConfigSection
      title={`${label}（${sectionName}）`}
      actions={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] px-2 h-6 rounded"
          style={{ color: "#94A3B8" }}
        >
          {open ? "收起" : "展开"}
        </button>
      }
    >
      {!open ? (
        <p className="text-xs text-slate-500">
          {section.entries.length} 项设置——展开可编辑
        </p>
      ) : section.entries.length === 0 ? (
        <p className="text-xs text-slate-500">暂无字段</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {section.entries.map((entry) => (
            <RawEntryField
              key={entry.key}
              entry={entry}
              onUpdate={onUpdate}
              sectionName={sectionName}
              currentMode={currentMode}
            />
          ))}
        </div>
      )}
    </ConfigSection>
  );
}

/** 单个未托管字段的编辑控件——bool 用 ConfigToggle，非 bool 用 ConfigField（复用配置页统一组件） */
function RawEntryField({
  entry,
  sectionName,
  currentMode,
  onUpdate,
}: {
  entry: ApiConfigSection["entries"][number];
  sectionName: string;
  /** 当前 Commands.dat Mode（Easy/Normal/Hard）——per-mode bool 裸 key 时按它取默认开/关 */
  currentMode: string;
  onUpdate: (sectionName: string, key: string, value: string | null) => void;
}) {
  // 从定义表按 (section, key) 查字段类型/中文名——同名 key 跨模块以 section 区分
  const def = TXT_FIELD_DEFS.find(
    (d) => d.key === entry.key && d.section === sectionName,
  );
  const isBool = def?.type === "bool";
  const label = def?.label ?? entry.key;
  // 当前难度的默认值（PER_MODE_DEFAULTS 结构化查表，零字符串解析）
  const perMode = PER_MODE_DEFAULTS[`${sectionName}.${entry.key}`];
  const modeKey = currentMode?.trim().toLowerCase() as "easy" | "normal" | "hard";
  const modeDefault = perMode ? perMode[modeKey] ?? perMode.normal : undefined;
  // bool 当前值：
  // - value 有值（"true"/"false"）→ 按字面
  // - 裸 key（null = 用默认）→ 按定义表默认（per-mode 按当前难度取）
  const boolVal =
    entry.value === "true" ||
    (entry.value === null &&
      (def?.def === "开" || modeDefault === true));

  if (isBool) {
    return (
      <ConfigToggle
        label={label}
        checked={boolVal}
        onChange={(checked) =>
          onUpdate(sectionName, entry.key, checked ? "true" : "false")
        }
      />
    );
  }

  // 数值/文本 placeholder：显示默认值预览
  // - per-mode 数值 → 当前难度默认（PER_MODE_DEFAULTS 取）
  // - 非 per-mode 数值 → 定义表 def（纯值，如 "604800"）
  // - 文本 → 文件注释
  const defaultPreview =
    perMode && typeof modeDefault === "string"
      ? modeDefault
      : def && def.type === "number" && !def.def.includes("简单") && !def.def.includes("普通") && !def.def.includes("困难")
        ? def.def
        : undefined;
  const placeholder =
    defaultPreview !== undefined
      ? `默认 ${defaultPreview}`
      : entry.comment ?? undefined;

  // 数值 clamp：输入时按定义表 min/max 截断（0–1 输 2 → 1）
  const clampNumber = (raw: string): string => {
    if (def?.type !== "number" || def.min === undefined) return raw;
    const n = Number(raw);
    if (Number.isNaN(n)) return raw;
    let clamped = n;
    if (def.min !== undefined && clamped < def.min) clamped = def.min;
    if (def.max !== undefined && clamped > def.max) clamped = def.max;
    return String(clamped);
  };

  return (
    <ConfigField
      label={label}
      value={entry.value ?? ""}
      onChange={(v) => {
        const clamped = clampNumber(v.trim());
        onUpdate(sectionName, entry.key, clamped.length > 0 ? clamped : null);
      }}
      placeholder={placeholder}
    />
  );
}

function TxtSection({
  title,
  fields: fieldDefs,
  txtFields,
  currentMode,
  sectionName,
  onChange,
}: {
  title: string;
  /** [key, hint?]——label/type 从 TXT_FIELD_DEFS 按 (section, key) 查；hint 是固定文本提示，优先级高于 SDK 默认 placeholder */
  fields: readonly (readonly [keyof ConfigTxtFields, string?])[];
  txtFields: ConfigTxtFields;
  /** 当前 Commands.dat Mode——per-mode 字段（Spawn_Chance 等）placeholder 按它动态取 */
  currentMode: string;
  /** SDK section 名（Browser/Server/Items/Gameplay）——查定义表用 */
  sectionName: string;
  onChange: (k: keyof ConfigTxtFields, v: string | boolean) => void;
}) {
  return (
    <ConfigSection title={title}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {fieldDefs.map(([k, hint]) => {
          const def = TXT_FIELD_DEFS.find(
            (d) => d.key === k && d.section === sectionName,
          );
          const label = def?.label ?? k;
          const isToggle = def?.type === "bool";
          return isToggle ? (
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
              placeholder={hint ?? getFieldPlaceholder(k, currentMode)}
            />
          );
        })}
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
