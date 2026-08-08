import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getDb } from '../db/connection.js';

const QuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  action: z.string().optional(),
  serverId: z.string().optional(),
});
type Query = z.infer<typeof QuerySchema>;

/**
 * 审计日志查询端点（Phase 0 新增——SettingsPage Card 4「面板日志」使用）。
 *
 * GET /api/audit-logs?limit=&offset=&action=&serverId=
 */
export function createAuditLogsRouter(): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    '/',
    validate(QuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { limit, offset, action, serverId } = req.query as unknown as Query;

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (action) {
        conditions.push('action = ?');
        params.push(action);
      }
      if (serverId) {
        conditions.push('server_id = ?');
        params.push(serverId);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const db = getDb();

      const rows = db
        .prepare(
          `SELECT id, server_id, action, actor, detail, ip_address, created_at
           FROM audit_logs
           ${where}
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
        id: number;
        server_id: string | null;
        action: string;
        actor: string;
        detail: string | null;
        ip_address: string | null;
        created_at: string;
      }>;

      const total = (db
        .prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`)
        .get(...params) as { count: number }).count;

      res.json({
        data: {
          items: rows.map((r) => ({
            id: r.id,
            serverId: r.server_id,
            action: r.action,
            actor: r.actor,
            detail: r.detail ? safeParseJson(r.detail) : null,
            ipAddress: r.ip_address,
            createdAt: r.created_at,
          })),
          total,
          limit,
          offset,
        },
      });
    }),
  );

  return router;
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
