import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { IRconManager } from '@unturned-manager/shared';
import { RconExecuteSchema } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getDb } from '../db/connection.js';

/**
 * 危险指令——需要前端 ConfirmDialog 确认后才允许执行。
 * 前端必须发送 `{ command, confirmed: true }` 才能执行危险指令。
 * CLAUDE.md §4.5: "危险指令 UI 上必须二次确认才让用"
 */
const DANGEROUS_COMMANDS = new Set([
  'shutdown', 'ban', 'slay', 'resetconfig', 'unadmin', 'unban', 'cheats',
]);

/**
 * Owner 专属指令——只有服主可以执行。
 * CLAUDE.md §4.5: "服务器主人专属指令（面板必须鉴权到主人才能用）"
 * reference_console_commands.md:503-509
 */
const OWNER_ONLY_COMMANDS = new Set(['owner', 'cheats', 'shutdown']);

export function createRconRouter(rconManager: IRconManager): Router {
  const router = Router();
  router.use(authenticateToken);

  // 抽成函数：/execute 与 /rcon/execute 共享（C1 修复——两个路径行为完全一致）
  const rconExecuteHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { command, confirmed } = req.body as { command: string; confirmed?: boolean };
      const cmdName = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

      // 危险指令门控：后端强制二次确认
      if (DANGEROUS_COMMANDS.has(cmdName) && confirmed !== true) {
        res.status(428).json({
          error: {
            code: 'confirmation_required',
            message: `指令 "${cmdName}" 是危险操作，请确认后重试`,
          },
        });
        return;
      }

      const serverId = req.params.id;

      // Owner 专属指令鉴权
      if (OWNER_ONLY_COMMANDS.has(cmdName)) {
        const user = (req as unknown as { user?: { role?: string } }).user;
        if (!user || user.role !== 'admin') {
          res.status(403).json({
            error: {
              code: 'owner_only',
              message: `指令 "${cmdName}" 仅限服主执行`,
            },
          });
          return;
        }
      }

      const result = await rconManager.execute(serverId as never, command);

      // 危险指令审计日志
      if (DANGEROUS_COMMANDS.has(cmdName)) {
        try {
          const db = getDb();
          db.prepare(
            'INSERT INTO audit_logs (server_id, action, actor, detail, ip_address, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
          ).run(
            serverId,
            `rcon.${cmdName}`,
            'admin',
            JSON.stringify({ command }),
            req.ip ?? '',
          );
        } catch { /* 审计日志写入失败不影响主流程 */ }
      }

      res.json({ data: { output: result } });
    } catch (err) {
      next(err);
    }
  };

  // /execute（v1 原路径，前端 ConsolePage 在用）
  router.post(
    '/:id/execute',
    validate(RconExecuteSchema),
    asyncHandler(rconExecuteHandler),
  );

  // /rcon/execute（Phase 0 别名，PlayersPage 在用——修复 C1）
  router.post(
    '/:id/rcon/execute',
    validate(RconExecuteSchema),
    asyncHandler(rconExecuteHandler),
  );

  return router;
}
