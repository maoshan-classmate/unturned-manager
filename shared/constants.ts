/**
 * Steam AppID 全局唯一真源——禁止在模块内手写 appid 字面量。
 *
 * 分工（钉死）：
 * - `U3DS_SERVER` = `1110390`：专用服务端工具——`app_update` 安装/更新、
 *   `app_info_print` 查 buildid 用它。
 * - `UNTURNED_GAME` = `304930`：游戏本体——Workshop 内容归属此 appid，
 *   `workshop_download_item`、content 目录、`appworkshop_*.acf`、WebAPI 搜索全用它。
 *   （1110390 名下无 workshop；误用只能拿到元数据缓存、拿不到内容）
 */
export const STEAM_APP_IDS = {
  /** U3DS 专用服务端工具（app_update 安装/更新、app_info_print 查版本） */
  U3DS_SERVER: "1110390",
  /** Unturned 游戏本体（workshop 下载/落盘/acf/WebAPI 搜索） */
  UNTURNED_GAME: "304930",
} as const;

/** Steam AppID 字面量联合类型（'1110390' | '304930'） */
export type SteamAppId = (typeof STEAM_APP_IDS)[keyof typeof STEAM_APP_IDS];

/**
 * Commands.dat 固定枚举——全局唯一真源（前后端共享，禁止在页面里手写枚举字面量）。
 *
 * 真源：
 * - `Mode`——`EGameMode.cs` 枚举 EASY/NORMAL/HARD/ANY/TUTORIAL；专用服务器可用范围
 *   Easy|Normal|Hard（`reference_config_files.md` §1.2），ANY 为活动 filter 不列入下拉。
 * - `Perspective`——`ECameraMode.cs` 枚举 FIRST/THIRD/BOTH/VEHICLE/ANY（ANY 为 filter）；
 *   专用服务器可用 First|Third|Both|Vehicle（`Provider.cs:6645` 默认 FIRST）。
 * - `Map`——官方地图指令值（unturned.wiki.gg/wiki/Maps + 服务器指令参考）：
 *   官方地图 PEI/Washington/Russia/Germany/Greece/Hawaii + 策展地图 Arid/Elver/Kuwait/Buak/Carpat。
 *   datalist 仅作建议，不限制输入（已安装地图优先）。
 *
 * value 一律用 U3DS 能识别的原始枚举名；label 是给玩家看的界面文案。
 */
export const COMMANDS_DAT_ENUMS = {
  /** Mode 难度下拉选项 */
  Mode: [
    { value: "Easy", label: "简单" },
    { value: "Normal", label: "普通" },
    { value: "Hard", label: "困难" },
  ],
  /** Perspective 视角限制下拉选项 */
  Perspective: [
    { value: "First", label: "第一人称" },
    { value: "Third", label: "第三人称" },
    { value: "Both", label: "两者" },
    { value: "Vehicle", label: "载具" },
  ],
  /** Map 官方地图建议（datalist） */
  Map: [
    "PEI",
    "Washington",
    "Russia",
    "Germany",
    "Greece",
    "Hawaii",
    "Arid",
    "Elver",
    "Kuwait",
    "Buak",
    "Carpat",
  ],
} as const;

/** Commands.dat 固定枚举的字段名联合类型（'Mode' | 'Perspective' | 'Map'） */
export type CommandsDatEnumKey = keyof typeof COMMANDS_DAT_ENUMS;
