/**
 * 统一业务错误类。
 *
 * 路由层抛出后由全局 errorHandler 捕获，返回 `{ error: { code, message } }`。
 * 禁止 `throw new Error()` 裸抛—— 路由无法区分错误类型。
 */

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  /**
   * @param code - 错误码（kebab-case，如 `server-not-found`）
   * @param message - 面向用户的中文错误描述
   * @param status - HTTP 状态码，默认 500
   */
  constructor(code: string, message: string, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AppError';
  }
}
