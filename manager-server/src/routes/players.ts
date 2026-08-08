import { Router } from 'express';
import type { IRconManager, ServerId } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

const ParamsSchema = z.object({ id: z.string().min(1) });

/**
 * 解析 RCON `Players` 命令输出（参见 reference_console_commands.md §11）。
 * 格式：Player Name (SteamID) | Character Name | Ping | Time Online
 *
 * 解析失败行 → 跳过；整段解析失败 → 返回空数组。
 */
function parsePlayersOutput(raw: string): Array<{
  name: string;
  steamId: string;
  character: string;
  ping: number;
  timeOnline: string;
}> {
  if (!raw) return [];
  const players: Array<{
    name: string;
    steamId: string;
    character: string;
    ping: number;
    timeOnline: string;
  }> = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('|')) continue;

    const parts = trimmed.split('|').map((s) => s.trim());
    if (parts.length < 4) continue;

    const name = parts[0]!;
    // parts[1] 是 `Player Name (SteamID64)` 格式
    const steamIdMatch = /(\d{17})/.exec(parts[1]!);
    const steamId = steamIdMatch ? steamIdMatch[1]! : parts[1]!;
    const character = parts[2]!;
    const ping = parseInt(parts[3]!, 10) || 0;
    const timeOnline = parts[4] ?? '';

    players.push({ name, steamId, character, ping, timeOnline });
  }
  return players;
}

export function createPlayersRouter(rconManager: IRconManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    '/:id/players',
    validate(ParamsSchema, 'params'),
    asyncHandler(async (req, res) => {
      const { id: serverId } = req.params as { id: string };

      // 兜底：RCON 不可达 → 200 + 空数组，前端降级显示 demoPlayers
      if (!rconManager.isReachable(serverId as ServerId)) {
        res.json({
          data: {
            serverId,
            players: [],
            fetchedAt: new Date().toISOString(),
            reachable: false,
          },
        });
        return;
      }

      try {
        const raw = await rconManager.execute(serverId as ServerId, 'Players');
        const players = parsePlayersOutput(raw);
        res.json({
          data: {
            serverId,
            players,
            fetchedAt: new Date().toISOString(),
            reachable: true,
          },
        });
      } catch (err) {
        logger.warn({ serverId, err }, 'Players 查询失败，返回空数组');
        res.json({
          data: {
            serverId,
            players: [],
            fetchedAt: new Date().toISOString(),
            reachable: false,
          },
        });
      }
    }),
  );

  return router;
}
