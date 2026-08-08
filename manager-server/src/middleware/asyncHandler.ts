import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * 包装异步路由——自动捕获 Promise reject 转发到 next()。
 * 消除路由内 try/catch 样板。
 *
 * @example
 * ```ts
 * router.get('/', asyncHandler(async (req, res) => {
 *   const data = await service.list();
 *   res.json({ data });
 * }));
 * ```
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
