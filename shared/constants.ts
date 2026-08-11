/**
 * Steam AppID 全局唯一真源——禁止在模块内手写 appid 字面量。
 *
 * 分工（2026-08-11 实机教训，钉死）：
 * - `U3DS_SERVER` = `1110390`：专用服务端工具——`app_update` 安装/更新、
 *   `app_info_print` 查 buildid 用它。
 * - `UNTURNED_GAME` = `304930`：游戏本体——Workshop 内容归属此 appid，
 *   `workshop_download_item`、content 目录、`appworkshop_*.acf`、WebAPI 搜索全用它。
 *   （1110390 名下无 workshop；误用只能拿到元数据缓存、拿不到内容——BUG-5/6「假成功」总根因）
 */
export const STEAM_APP_IDS = {
  /** U3DS 专用服务端工具（app_update 安装/更新、app_info_print 查版本） */
  U3DS_SERVER: '1110390',
  /** Unturned 游戏本体（workshop 下载/落盘/acf/WebAPI 搜索） */
  UNTURNED_GAME: '304930',
} as const;

/** Steam AppID 字面量联合类型（'1110390' | '304930'） */
export type SteamAppId = (typeof STEAM_APP_IDS)[keyof typeof STEAM_APP_IDS];
