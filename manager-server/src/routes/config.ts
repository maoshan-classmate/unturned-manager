import { Router } from 'express';
import type { IConfigService } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createConfigRouter(configService: IConfigService): Router {
  const router = Router();
  router.use(authenticateToken);

  // Commands.dat
  router.get('/:id/commands', async (req, res) => {
    try {
      const data = await configService.readCommandsDat(req.params.id as never);
      res.json({ data });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '读取 Commands.dat 失败' } });
    }
  });

  router.put('/:id/commands', async (req, res) => {
    try {
      await configService.writeCommandsDat(req.params.id as never, req.body, req.body.expectedVersion);
      res.json({ data: { message: 'Commands.dat 已保存' } });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '写入 Commands.dat 失败' } });
    }
  });

  // Config.txt
  router.get('/:id/txt', async (req, res) => {
    try {
      const data = await configService.readConfigTxt(req.params.id as never);
      res.json({ data });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '读取 Config.txt 失败' } });
    }
  });

  router.put('/:id/txt', async (req, res) => {
    try {
      await configService.writeConfigTxt(req.params.id as never, req.body, req.body.expectedVersion);
      res.json({ data: { message: 'Config.txt 已保存' } });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '写入 Config.txt 失败' } });
    }
  });

  // WorkshopDownloadConfig.json
  router.get('/:id/workshop', async (req, res) => {
    try {
      const data = await configService.readWorkshopConfig(req.params.id as never);
      res.json({ data });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '读取 Workshop 配置失败' } });
    }
  });

  router.put('/:id/workshop', async (req, res) => {
    try {
      await configService.writeWorkshopFileIds(req.params.id as never, req.body.fileIds, req.body.expectedVersion);
      res.json({ data: { message: 'Workshop File IDs 已更新' } });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '更新 Workshop 配置失败' } });
    }
  });

  return router;
}
