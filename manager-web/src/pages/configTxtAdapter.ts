/**
 * Config.txt schema adapter（BUG-2 闭环，2026-08-13）。
 *
 * 后端 shared/schemas/config.schema.ts ConfigSectionSchema = { name, entries: ConfigEntry[] }
 * UI 用扁平 ConfigTxtFields；本文件负责 UI ↔ schema 互转。
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
 * @param key - 字段 key
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
 * @param key - 字段 key
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
 * UI 字段清单（与 ConfigTxtFields 同步）——新增 UI 字段必须同步加到这里。
 * 已知键列表参考 shared/schemas/config.schema.ts ConfigEntrySchema。
 */
export function buildTxtSections(fields: ConfigTxtFields): ApiConfigSection[] {
  return [
    {
      name: "浏览器",
      entries: [
        stringEntry("Login_Token", fields.Login_Token),
        stringEntry("完整描述", fields.完整描述),
        stringEntry("列表描述", fields.列表描述),
        stringEntry("图标URL", fields.图标URL),
        stringEntry("缩略图URL", fields.缩略图URL),
      ],
    },
    {
      name: "服务器",
      entries: [
        boolEntry("VAC反作弊", fields.VAC反作弊),
        boolEntry("BattlEye", fields.BattlEye),
        stringEntry("最大Ping(ms)", fields.最大Ping),
        boolEntry("定时关机", fields.定时关机),
        boolEntry("更新自动关机", fields.更新自动关机),
      ],
    },
    {
      name: "物品",
      entries: [
        stringEntry("生成倍率", fields.生成倍率),
        boolEntry("物品耐久", fields.物品耐久),
        stringEntry("掉落消失(s)", fields.掉落消失),
        stringEntry("重生时间(s)", fields.重生时间),
      ],
    },
    {
      name: "玩法开关",
      entries: [
        boolEntry("肩后视角", fields.肩后视角),
        boolEntry("自由建造", fields.自由建造),
        boolEntry("玩家伤害", fields.玩家伤害),
        boolEntry("允许自杀", fields.允许自杀),
      ],
    },
  ];
}

/**
 * ConfigTxtFields 形态（与 ConfigPage.tsx 内部 interface 同步——本文件独立测试需要它）——
 * 颗粒度最小：本地定义而非 import ConfigPage，避免循环依赖与"helper 反向依赖 UI"反模式。
 */
export interface ConfigTxtFields {
  Login_Token: string;
  完整描述: string;
  列表描述: string;
  图标URL: string;
  缩略图URL: string;
  VAC反作弊: boolean;
  BattlEye: boolean;
  最大Ping: string;
  定时关机: boolean;
  更新自动关机: boolean;
  生成倍率: string;
  物品耐久: boolean;
  掉落消失: string;
  重生时间: string;
  肩后视角: boolean;
  自由建造: boolean;
  玩家伤害: boolean;
  允许自杀: boolean;
}

/** 空 ConfigTxtFields——helper 单测起点 */
export const EMPTY_TXT_FIELDS: ConfigTxtFields = {
  Login_Token: "",
  完整描述: "",
  列表描述: "",
  图标URL: "",
  缩略图URL: "",
  VAC反作弊: false,
  BattlEye: false,
  最大Ping: "",
  定时关机: false,
  更新自动关机: false,
  生成倍率: "",
  物品耐久: false,
  掉落消失: "",
  重生时间: "",
  肩后视角: false,
  自由建造: false,
  玩家伤害: false,
  允许自杀: false,
};