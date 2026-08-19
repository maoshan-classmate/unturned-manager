import { Router } from 'express';
import { z } from 'zod';
import type { IConfigService } from '@unturned-manager/shared';
import {
  WriteCommandsDatSchema,
  WriteConfigTxtSchema,
  WriteWorkshopFileIdsSchema,
} from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export function createConfigRouter(configService: IConfigService): Router {
  const router = Router();
  router.use(authenticateToken);

  // Commands.dat
  router.get(
    '/:id/config/commands',
    asyncHandler(async (req, res) => {
      const data = await configService.readCommandsDat(req.params.id as never);
      res.json({ data });
    }),
  );

  router.put(
    '/:id/config/commands',
    validate(WriteCommandsDatSchema),
    asyncHandler(async (req, res) => {
      // body 用 schema 推断类型：手写 cast 会漏掉 loadouts 字段，导致「保存配置后 Loadout 未写入 Commands.dat」。
      const body = req.body as z.infer<typeof WriteCommandsDatSchema>;
      await configService.writeCommandsDat(
        req.params.id as never,
        {
          known: body.known,
          unknown: body.unknown,
          comments: body.comments ?? [],
          loadouts: body.loadouts,
        },
        body.expectedMtime,
      );
      res.json({ data: { message: 'Commands.dat 已保存' } });
    }),
  );

  // Config.txt
  router.get(
    '/:id/config/txt',
    asyncHandler(async (req, res) => {
      const data = await configService.readConfigTxt(req.params.id as never);
      res.json({ data });
    }),
  );

  router.put(
    '/:id/config/txt',
    validate(WriteConfigTxtSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as { sections: Record<string, { name: string; entries: Array<{ key: string; value: string | null; comment: string | null; known: boolean; type?: 'string' | 'bool' | 'int' }> }>; expectedMtime?: number };
      await configService.writeConfigTxt(req.params.id as never, { sections: body.sections as never }, body.expectedMtime);
      res.json({ data: { message: 'Config.txt 已保存' } });
    }),
  );

  // WorkshopDownloadConfig.json
  router.get(
    '/:id/config/workshop',
    asyncHandler(async (req, res) => {
      const data = await configService.readWorkshopConfig(req.params.id as never);
      res.json({ data });
    }),
  );

  router.put(
    '/:id/config/workshop',
    validate(WriteWorkshopFileIdsSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as { fileIds: string[]; expectedMtime?: number };
      await configService.writeWorkshopFileIds(req.params.id as never, body.fileIds as never, body.expectedMtime);
      res.json({ data: { message: 'Workshop File IDs 已更新' } });
    }),
  );

  return router;
}
