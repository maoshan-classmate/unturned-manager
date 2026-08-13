/**
 * Config.txt schema adapter（BUG-2 闭环，2026-08-13；Bug B-1 英文 key 重构 2026-08-13）。
 *
 * 后端 shared/schemas/config.schema.ts ConfigSectionSchema = { name, entries: ConfigEntry[] }
 * UI 用扁平 ConfigTxtFields；本文件负责 UI ↔ schema 互转。
 *
 * Bug B-1 修复：字段名 + entry key + section name 全部对齐 SDK 英文真源（PlayConfigData.cs 各 ConfigData 类的 C# 字段名）。
 * 写入文件后 U3DS `PlayConfigUtils.ParseCategory`（PlayConfigData.cs:2613-2678）按 C# 反射 FieldInfo.Name 匹配，
 * 中文 key 会被 TryGetNode 返回 false 静默丢弃——本文件确保所有写入 key 都用 SDK 英文。
 *
 * 颗粒度最小：只 ConfigPage 一处消费，但 helper 必须可独立单测（owner 网），
 * 故放在页面同级独立文件而不是内联。CLAUDE.md §lib/utils 触发条件 = ≥2 模块共用，
 * 本文件当前不满足，**不**入 lib/utils。
 */
import type {
  ConfigEntry,
  ConfigSection as ApiConfigSection,
} from "@unturned-manager/shared";

/**
 * 从 ConfigSection.entries 读 string 字段值。
 *
 * value=null 含义：string 字段未设置（视作空串）。
 *
 * 颗粒度说明：与 readBoolEntry 分开为独立函数——避免 TS 重载在运行时被忽略、
 * isBool 参数歧义导致返回类型错配的坑（BUG-2 修复时单测抓住过）。
 *
 * @param section - 后端返回的 ConfigSection（可能 undefined=section 不存在）
 * @param key - 字段 key（SDK 英文名，与 `PlayConfigData.cs` 对应 C# 字段名一致）
 * @returns string 字段值；section/key 缺失统一返回 ""
 */
export function readStringEntry(
  section: ApiConfigSection | undefined,
  key: string,
): string {
  if (!section) return "";
  const entry = section.entries.find((e) => e.key === key);
  if (!entry) return "";
  return entry.value ?? "";
}

/**
 * 从 ConfigSection.entries 读 bool 字段值。
 *
 * value=null 含义：bool 字段勾选为 true（U3DS 配置文件中 bool 开关 = 裸 key 行）。
 * value 非 null（"true"/"false"/其他）：按字面字符串真值判断——保守走 Boolean()。
 *
 * @param section - 后端返回的 ConfigSection
 * @param key - 字段 key（SDK 英文名）
 * @returns bool 字段值；section/key 缺失统一返回 false
 */
export function readBoolEntry(
  section: ApiConfigSection | undefined,
  key: string,
): boolean {
  if (!section) return false;
  const entry = section.entries.find((e) => e.key === key);
  if (!entry) return false;
  if (entry.value === null) return true;
  // 后端若写入 "true"/"false" 字符串（非裸行形态），按字面真值判断
  return Boolean(entry.value) && entry.value !== "false";
}

/**
 * 构造一条 bool 字段 entry——
 *   勾选 → value=null + type=bool（后端 serializeConfigTxt 写为裸 key 行 = 开关）
 *   未勾选 → value="false" + type=bool（保留 key，强制 false——U3DS 配置文件语义）
 *
 * 颗粒度说明：保留未勾选条目而非删除，是为了让面板「保留已知键」原则生效
 * （CLAUDE.md §unturned-sop：解析器契约必须保留未知键——面板不能把不认识的指令删了）。
 * bool 字段是已知键，保留=显式 false 比删除更稳。
 */
export function boolEntry(key: string, enabled: boolean): ConfigEntry {
  return enabled
    ? { key, value: null, comment: null, known: true, type: "bool" }
    : { key, value: "false", comment: null, known: true, type: "bool" };
}

/** string 字段 entry——空串归一为 null（后端 serializeConfigTxt 写时不带等号） */
export function stringEntry(key: string, value: string): ConfigEntry {
  const v = value.length > 0 ? value : null;
  return { key, value: v, comment: null, known: true, type: "string" };
}

/**
 * UI 字段全集 → 4 个 section 的 ConfigSection[]。
 *
 * Bug B-1 修复后：section 名 + entry key 都用 SDK 英文真源——
 * [Browser] / [Server] / [Items] / [Gameplay] 对应 PlayConfigData.cs 的 BrowserConfigData / ServerConfigData / ItemsConfigData / GameplayConfigData。
 *
 * UI 字段清单（与 ConfigTxtFields 同步）——新增 UI 字段必须同步加到这里。
 */
export function buildTxtSections(fields: ConfigTxtFields): ApiConfigSection[] {
  return [
    {
      name: "Browser",
      entries: [
        stringEntry("Login_Token", fields.Login_Token),
        stringEntry("Desc_Full", fields.Desc_Full),
        stringEntry("Desc_Server_List", fields.Desc_Server_List),
        stringEntry("Icon", fields.Icon),
        stringEntry("Thumbnail", fields.Thumbnail),
      ],
    },
    {
      name: "Server",
      entries: [
        boolEntry("VAC_Secure", fields.VAC_Secure),
        boolEntry("BattlEye_Secure", fields.BattlEye_Secure),
        stringEntry("Max_Ping_Milliseconds", fields.Max_Ping_Milliseconds),
        boolEntry("Enable_Scheduled_Shutdown", fields.Enable_Scheduled_Shutdown),
        boolEntry("Enable_Update_Shutdown", fields.Enable_Update_Shutdown),
      ],
    },
    {
      name: "Items",
      entries: [
        stringEntry("Spawn_Chance", fields.Spawn_Chance),
        boolEntry("Has_Durability", fields.Has_Durability),
        stringEntry("Despawn_Dropped_Time", fields.Despawn_Dropped_Time),
        stringEntry("Respawn_Time", fields.Respawn_Time),
      ],
    },
    {
      name: "Gameplay",
      entries: [
        boolEntry("Allow_Shoulder_Camera", fields.Allow_Shoulder_Camera),
        boolEntry("Allow_Freeform_Buildables", fields.Allow_Freeform_Buildables),
        boolEntry("Friendly_Fire", fields.Friendly_Fire),
        boolEntry("Can_Suicide", fields.Can_Suicide),
      ],
    },
  ];
}

/**
 * ConfigTxtFields 形态——Bug B-1 修复后所有字段名与 SDK C# 字段名一致。
 *
 * 中文 label 仅在前端 ConfigPage.tsx 的 TxtSection field 数组里出现（display-only），
 * 本 interface 与 buildTxtSections 全部用英文 key——保证写入 Config.txt 的字段名
 * 等于 SDK `PlayConfigData.cs` 反射匹配的 FieldInfo.Name。
 *
 * 字段名 → SDK 真源：
 *   Login_Token             :124 BrowserConfigData.Login_Token
 *   Desc_Full               :113 BrowserConfigData.Desc_Full
 *   Desc_Server_List        :118 BrowserConfigData.Desc_Server_List
 *   Icon                     :98 BrowserConfigData.Icon
 *   Thumbnail               :103 BrowserConfigData.Thumbnail
 *   VAC_Secure              :402 ServerConfigData.VAC_Secure
 *   BattlEye_Secure         未在 SDK 本地副本找到（需实机验证）
 *   Max_Ping_Milliseconds   :404 ServerConfigData.Max_Ping_Milliseconds
 *   Enable_Scheduled_Shutdown :318 ServerConfigData.Enable_Scheduled_Shutdown
 *   Enable_Update_Shutdown  :350 ServerConfigData.Enable_Update_Shutdown
 *   Spawn_Chance            :487 ItemsConfigData.Spawn_Chance
 *   Has_Durability          :554 ItemsConfigData.Has_Durability
 *   Despawn_Dropped_Time    :492 ItemsConfigData.Despawn_Dropped_Time
 *   Respawn_Time            :504 ItemsConfigData.Respawn_Time
 *   Allow_Shoulder_Camera   :2215 GameplayConfigData.Allow_Shoulder_Camera
 *   Allow_Freeform_Buildables :2250 GameplayConfigData.Allow_Freeform_Buildables
 *   Friendly_Fire           :2225 GameplayConfigData.Friendly_Fire（UI label「玩家伤害」取反）
 *   Can_Suicide             :2220 GameplayConfigData.Can_Suicide
 */
export interface ConfigTxtFields {
  Login_Token: string;
  Desc_Full: string;
  Desc_Server_List: string;
  Icon: string;
  Thumbnail: string;
  VAC_Secure: boolean;
  BattlEye_Secure: boolean;
  Max_Ping_Milliseconds: string;
  Enable_Scheduled_Shutdown: boolean;
  Enable_Update_Shutdown: boolean;
  Spawn_Chance: string;
  Has_Durability: boolean;
  Despawn_Dropped_Time: string;
  Respawn_Time: string;
  Allow_Shoulder_Camera: boolean;
  Allow_Freeform_Buildables: boolean;
  Friendly_Fire: boolean;
  Can_Suicide: boolean;
}

/** 空 ConfigTxtFields——helper 单测起点（Bug B-1 修复后全部英文 key） */
export const EMPTY_TXT_FIELDS: ConfigTxtFields = {
  Login_Token: "",
  Desc_Full: "",
  Desc_Server_List: "",
  Icon: "",
  Thumbnail: "",
  VAC_Secure: false,
  BattlEye_Secure: false,
  Max_Ping_Milliseconds: "",
  Enable_Scheduled_Shutdown: false,
  Enable_Update_Shutdown: false,
  Spawn_Chance: "",
  Has_Durability: false,
  Despawn_Dropped_Time: "",
  Respawn_Time: "",
  Allow_Shoulder_Camera: false,
  Allow_Freeform_Buildables: false,
  Friendly_Fire: false,
  Can_Suicide: false,
};
