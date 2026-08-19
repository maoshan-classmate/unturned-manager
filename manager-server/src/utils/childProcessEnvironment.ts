/**
 * 子进程环境变量构造器。
 *
 * 从 `process.env` 剥离面板专用 secret 后再传给 U3DS 子进程,
 * 防止 JWT/加密密钥泄漏到被管理的游戏进程。
 *
 * 剥离集按本项目 config.ts 的 secret key 定义（JWT_SECRET / ENCRYPTION_KEY）。
 */

const SERVER_ONLY_ENVIRONMENT_NAMES = new Set([
  'JWT_SECRET',
  'ENCRYPTION_KEY',
]);

/**
 * 构造子进程环境变量——剥离面板 secret 后合并 overrides。
 *
 * @param overrides - 显式覆盖的环境变量（优先于 process.env）
 * @returns 传给 spawn 的 env 对象
 *
 * @example
 * ```typescript
 * const env = buildChildProcessEnvironment();
 * spawn('ServerHelper.sh', args, { env });
 * ```
 */
export const buildChildProcessEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !SERVER_ONLY_ENVIRONMENT_NAMES.has(name),
    ),
  ),
  ...overrides,
});
