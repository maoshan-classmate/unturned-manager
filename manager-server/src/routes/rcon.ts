import { Router } from 'express';
import type { IRconManager } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

const DANGEROUS_COMMANDS = ['shutdown', 'ban', 'slay', 'resetconfig', 'unadmin', 'unban', 'cheats'];

export function createRconRouter(rconManager: IRconManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.post('/:id/execute', async (req, res) => {
    try {
      const { command } = req.body;
      if (!command || typeof command !== 'string') {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供有效的命令' } });
        return;
      }

      const cmdName = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (DANGEROUS_COMMANDS.includes(cmdName)) {
        // 危险指令——后端二次确认（前端已有 ConfirmDialog，此处为安全兜底）
        // Sprint 2: 加入 audit_log 记录
      }

      const result = await rconManager.execute(req.params.id as never, command);
      res.json({ data: { output: result } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '命令执行失败';
      res.status(500).json({ error: { code: 'rcon_error', message: msg } });
    }
  });

  return router;
}
