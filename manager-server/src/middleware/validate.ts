import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from '../utils/AppError.js';

/**
 * Zod schema 校验中间件——校验通过后 req[source] 被净化为 schema 推断的类型。
 *
 * @param schema - Zod schema
 * @param source - 校验位置，默认 body
 *
 * @example
 * ```ts
 * router.post('/', validate(CreateServerSchema), asyncHandler(handler));
 * router.get('/', validate(ListSchema, 'query'), asyncHandler(handler));
 * ```
 */
export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return next(new AppError('validation_failed', `请求参数校验失败: ${issues}`, 400));
    }
    // 覆盖为校验后的值（类型收窄 + 净化未知字段）
    (req as unknown as Record<string, unknown>)[source] = result.data;
    next();
  };
}
