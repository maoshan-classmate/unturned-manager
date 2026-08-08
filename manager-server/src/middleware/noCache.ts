import type { Request, Response, NextFunction } from 'express';

/**
 * 全局禁用 HTTP 缓存。
 * 系统代理（如 Clash）可能对带 ETag 的响应返回 304，导致前端收到空 body。
 * 此中间件禁用 ETag 并强制 no-cache，确保每次请求都返回完整 JSON。
 */
export function noCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}
