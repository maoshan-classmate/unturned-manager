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
 * ★ 2026-08-14：加 defaultVal 参数——文件缺失（section 无此字段）时返回 SDK 官方默认值，
 * 而不是恒 false。Config.txt 空值语义 = 使用官方默认（server-configuration.rst:10），
 * 前端 UI 必须把「未配置」显示为 SDK 默认，否则 toggle 全 false 误导用户。
 *
 * @param section - 后端返回的 ConfigSection（可能 undefined=section 不存在）
 * @param key - 字段 key（SDK 英文名，与 `PlayConfigData.cs` 对应 C# 字段名一致）
 * @param defaultVal - 该字段的 SDK 官方默认值（section/key 缺失时返回）
 * @returns bool 字段值；section/key 缺失返回 defaultVal（缺省 false 向后兼容）
 */
export function readBoolEntry(
  section: ApiConfigSection | undefined,
  key: string,
  defaultVal = false,
): boolean {
  if (!section) return defaultVal;
  const entry = section.entries.find((e) => e.key === key);
  if (!entry) return defaultVal;
  if (entry.value === null) {
    // U3-SDK 原生格式：裸 key（无 value）= 使用该字段的官方默认值。
    // 面板序列化时 bool 勾选 → 裸 key（value null），未勾选 → "false"。
    // 所以裸 key 应返回该字段的默认值（defaultVal），而非写死 true——
    // 否则默认 false 的字段（如 Friendly_Fire）裸 key 会被误判为「开」。
    return defaultVal;
  }
  // 后端若写入 "true"/"false" 字符串，按字面真值判断
  return Boolean(entry.value) && entry.value !== "false";
}

/**
 * 构造一条 bool 字段 entry。
 *
 * ★ 2026-08-14 原生格式语义修正：U3-SDK `DatValueEx.cs:134-160` 裸 key（value null）
 * = 该字段默认值（parse 失败回落 defaultValue），**不是强制 true**。
 * 面板 bool 是二态 switch——为「所见即所得」：
 *   勾选 → `key true`（强制 true，不依赖默认）
 *   取消 → `key false`（强制 false，保留 key——CLAUDE.md「保留已知键」原则）
 * 裸 key 仅当字段从未被面板保存、或用户在服务端手写默认时出现，读侧用 defaultVal 显示。
 */
export function boolEntry(key: string, enabled: boolean): ConfigEntry {
  return {
    key,
    value: enabled ? "true" : "false",
    comment: null,
    known: true,
    type: "bool",
  };
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
 * Browser / Server / Items / Gameplay 对应 PlayConfigData.cs 的 BrowserConfigData / ServerConfigData / ItemsConfigData / GameplayConfigData。
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
        boolEntry(
          "Enable_Scheduled_Shutdown",
          fields.Enable_Scheduled_Shutdown,
        ),
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
        boolEntry(
          "Allow_Freeform_Buildables",
          fields.Allow_Freeform_Buildables,
        ),
        boolEntry("Friendly_Fire", fields.Friendly_Fire),
        boolEntry("Can_Suicide", fields.Can_Suicide),
      ],
    },
  ];
}

/**
 * ★ 2026-08-14 方案 1：合并保存——只覆盖 UI 托管字段，保留未托管 section/键/注释/rawBlocks。
 *
 * 真实 U3DS Config.txt 有 13 个 section、约 295 个字段，面板 UI 只展示/编辑 18 个托管字段。
 * 若保存时只用 buildTxtSections 的 4 个 section 覆盖整个文件，会删掉 9 个 section + 约 277 个
 * 未托管字段 + 全部注释——数据丢失。本函数把 18 个 UI 值合并进原始 sections（改 value、保留
 * comment），其余原样保留。
 *
 * @param rawSections - 后端 readConfigTxt 返回的完整 sections（含未托管内容）
 * @param fields - 前端 UI 的 18 个托管值
 * @returns 合并后的完整 sections（供 writeConfigTxt 整体写回）
 */
export function mergeTxtSections(
  rawSections: Record<string, ApiConfigSection>,
  fields: ConfigTxtFields,
): Record<string, ApiConfigSection> {
  const merged: Record<string, ApiConfigSection> = {};
  // 深拷贝——不修改入参（React 状态不可变）
  for (const [name, section] of Object.entries(rawSections)) {
    merged[name] = {
      name: section.name,
      entries: section.entries.map((e) => ({ ...e })),
      rawBlocks: section.rawBlocks ? [...section.rawBlocks] : undefined,
    };
  }

  // UI 托管字段 → (section, key, value) 覆盖表
  const managed: Array<[string, string, ConfigEntry]> = [
    // Browser
    ["Browser", "Login_Token", stringEntry("Login_Token", fields.Login_Token)],
    ["Browser", "Desc_Full", stringEntry("Desc_Full", fields.Desc_Full)],
    [
      "Browser",
      "Desc_Server_List",
      stringEntry("Desc_Server_List", fields.Desc_Server_List),
    ],
    ["Browser", "Icon", stringEntry("Icon", fields.Icon)],
    ["Browser", "Thumbnail", stringEntry("Thumbnail", fields.Thumbnail)],
    // Server
    ["Server", "VAC_Secure", boolEntry("VAC_Secure", fields.VAC_Secure)],
    [
      "Server",
      "BattlEye_Secure",
      boolEntry("BattlEye_Secure", fields.BattlEye_Secure),
    ],
    [
      "Server",
      "Max_Ping_Milliseconds",
      stringEntry("Max_Ping_Milliseconds", fields.Max_Ping_Milliseconds),
    ],
    [
      "Server",
      "Enable_Scheduled_Shutdown",
      boolEntry("Enable_Scheduled_Shutdown", fields.Enable_Scheduled_Shutdown),
    ],
    [
      "Server",
      "Enable_Update_Shutdown",
      boolEntry("Enable_Update_Shutdown", fields.Enable_Update_Shutdown),
    ],
    // Items
    ["Items", "Spawn_Chance", stringEntry("Spawn_Chance", fields.Spawn_Chance)],
    [
      "Items",
      "Has_Durability",
      boolEntry("Has_Durability", fields.Has_Durability),
    ],
    [
      "Items",
      "Despawn_Dropped_Time",
      stringEntry("Despawn_Dropped_Time", fields.Despawn_Dropped_Time),
    ],
    ["Items", "Respawn_Time", stringEntry("Respawn_Time", fields.Respawn_Time)],
    // Gameplay
    [
      "Gameplay",
      "Allow_Shoulder_Camera",
      boolEntry("Allow_Shoulder_Camera", fields.Allow_Shoulder_Camera),
    ],
    [
      "Gameplay",
      "Allow_Freeform_Buildables",
      boolEntry("Allow_Freeform_Buildables", fields.Allow_Freeform_Buildables),
    ],
    [
      "Gameplay",
      "Friendly_Fire",
      boolEntry("Friendly_Fire", fields.Friendly_Fire),
    ],
    ["Gameplay", "Can_Suicide", boolEntry("Can_Suicide", fields.Can_Suicide)],
  ];

  for (const [sectionName, key, entry] of managed) {
    const section = merged[sectionName];
    if (!section) {
      // section 不存在（原文件可能没这个节）——新建
      merged[sectionName] = {
        name: sectionName,
        entries: [entry],
        rawBlocks: undefined,
      };
      continue;
    }
    const exists = section.entries.some((e) => e.key === key);
    if (exists) {
      // ★ 2026-08-15 Bug 修复：更新所有同 key entry（不只第一个）——U3DS 解析重复 key 时
      // 最后一个生效（DatParser.cs:145），只更新第一个会让用户值被第二份旧值覆盖。
      // 保留原 comment（U3DS 自动生成的 // > 默认值说明不能丢），只更新 value/type。
      section.entries = section.entries.map((e) =>
        e.key === key ? { ...entry, comment: e.comment ?? entry.comment } : e,
      );
    } else {
      // key 不在原文件——追加
      section.entries.push(entry);
    }
  }

  return merged;
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
  VAC_Secure: true, // SDK ServerConfigData.cs:402
  BattlEye_Secure: true, // 实机 U3DS Config.txt 注释「Default: True」
  Max_Ping_Milliseconds: "",
  Enable_Scheduled_Shutdown: false, // SDK ServerConfigData 未初始化=false
  Enable_Update_Shutdown: false, // SDK 同上
  Spawn_Chance: "",
  Has_Durability: true, // SDK ItemsConfigData:673（Normal 默认）
  Despawn_Dropped_Time: "",
  Respawn_Time: "",
  Allow_Shoulder_Camera: true, // SDK GameplayConfigData:2446
  Allow_Freeform_Buildables: true, // SDK GameplayConfigData:2457
  Friendly_Fire: false, // SDK GameplayConfigData:2448
  Can_Suicide: true, // SDK GameplayConfigData:2447
};

/**
 * 各 UI 字段的 SDK 官方默认值——placeholder 预览用（★ 2026-08-14 新增）。
 *
 * 真源（U3DS 实机 Config.txt 注释「// > Default: ...」+ PlayConfigData.cs 构造函数）：
 *   - 固定 bool/数值：直接写死
 *   - per-mode 字段（Spawn_Chance / Respawn_Time / Has_Durability）：依赖 Commands.dat Mode，
 *     用 getModeDefault() 按当前 mode 动态取。
 *   - Browser 段 string（Login_Token 等）：SDK 无默认值，placeholder 留空。
 *
 * key 与 ConfigTxtFields 一致（SDK 英文名）。
 */
export const TXT_FIELD_DEFAULTS: Record<string, string | boolean> = {
  VAC_Secure: true, // ServerConfigData.cs:402
  BattlEye_Secure: true, // 实机注释「Default: True」
  Max_Ping_Milliseconds: "750", // ServerConfigData.cs:403
  Enable_Scheduled_Shutdown: false,
  Enable_Update_Shutdown: false,
  Despawn_Dropped_Time: "600", // ItemsConfigData.cs:596
};

/**
 * per-mode 字段在 Easy/Normal/Hard 下的 SDK 默认值。
 * 真源：ItemsConfigData(EGameMode) 构造函数（PlayConfigData.cs:594-680）。
 * Spawn_Chance / Respawn_Time / Has_Durability 依赖 Commands.dat 的 Mode。
 *
 * @param mode - Commands.dat 的 Mode 值（Easy/Normal/Hard；未知值按 Normal 兜底）
 * @returns per-mode 默认值映射表（key → 默认值）
 */
export function getModeDefaults(
  mode: string,
): Record<string, string | boolean> {
  const normalized = mode?.trim().toLowerCase();
  switch (normalized) {
    case "easy":
      return {
        Spawn_Chance: "0.35",
        Respawn_Time: "50",
        Has_Durability: false,
      };
    case "hard":
      return {
        Spawn_Chance: "0.15",
        Respawn_Time: "150",
        Has_Durability: true,
      };
    case "normal":
    default:
      return {
        Spawn_Chance: "0.35",
        Respawn_Time: "100",
        Has_Durability: true,
      };
  }
}
