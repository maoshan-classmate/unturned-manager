import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * 全局错误处理中间件——注册在所有路由之后。
 *
 * - 已知业务错误（AppError）→ 用其 status/code/message 输出
 * - 未知错误 → 500，且生产环境不暴露原始 message
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  logger.error({ err }, '未捕获的错误');
  const message =
    config.nodeEnv === 'development' && err instanceof Error
      ? err.message
      : '服务器内部错误';
  res.status(500).json({ error: { code: 'internal_error', message } });
};
