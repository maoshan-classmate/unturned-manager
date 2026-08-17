/**
 * Steam WebAPI 的 ELanguage 枚举值——用于 IPublishedFileService/QueryFiles 与 GetDetails 的
 * `language` 参数（决定服务端返回 title/file_description 用作者上传的哪个语言版本）。
 * 取值与 .research/dst-management-platform-api/app/mod/utils.go:90-96 对齐：
 *   0=english / 6=schinese / 7=tchinese。
 */
export const STEAM_LANG = {
  english: 0,
  schinese: 6,
  tchinese: 7,
} as const;

/**
 * 从 Express req.headers 读取 `X-I18n-Lang`（zh/en），映射到 Steam ELanguage 整数值；
 * 缺失或未知回落 schinese (6)——与前端 axios 拦截器默认值一致。
 *
 * @param req - Express 请求对象（结构类型——避免与 express 类型硬耦合）
 * @returns Steam ELanguage 整数值（0=english / 6=schinese）
 *
 * @example
 * ```typescript
 * const lang = reqLangToSteam(req);
 * url.searchParams.set('language', String(lang));
 * ```
 */
export function reqLangToSteam(
  req: { headers: Record<string, string | string[] | undefined> },
): number {
  const raw = req.headers["x-i18n-lang"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "en") return STEAM_LANG.english;
  return STEAM_LANG.schinese;
}