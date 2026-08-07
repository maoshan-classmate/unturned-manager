import { Router } from 'express';
import type { IFilesService } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createFilesRouter(filesService: IFilesService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get('/:id', async (req, res) => {
    try {
      const relativePath = (req.query.path as string) || '';
      const entries = await filesService.listDirectory(req.params.id as never, relativePath);
      res.json({ data: entries });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '读取目录失败' } });
    }
  });

  // 读取文件内容
  router.get('/:id/content', async (req, res) => {
    try {
      const relativePath = req.query.path as string;
      if (!relativePath) {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供文件路径' } });
        return;
      }
      const content = await filesService.readFile(req.params.id as never, relativePath);
      const text = new TextDecoder().decode(content);
      res.json({ data: text });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '读取文件失败';
      const status = (err as { statusCode?: number }).statusCode === 403 ? 403 : 500;
      res.status(status).json({ error: { code: 'server_error', message: msg } });
    }
  });

  // 上传文件
  router.post('/:id/upload', async (req, res) => {
    try {
      const { path: relativePath, content } = req.body;
      if (!relativePath || content === undefined) {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供路径和内容' } });
        return;
      }
      const data = new TextEncoder().encode(String(content));
      await filesService.writeFile(req.params.id as never, relativePath, data);
      res.json({ data: { message: '文件已上传' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败';
      const status = (err as { statusCode?: number }).statusCode === 403 ? 403 : 500;
      res.status(status).json({ error: { code: 'server_error', message: msg } });
    }
  });

  // 创建目录
  router.post('/:id/mkdir', async (req, res) => {
    try {
      const { path: relativePath } = req.body;
      if (!relativePath) {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供目录路径' } });
        return;
      }
      await filesService.createDirectory(req.params.id as never, relativePath);
      res.status(201).json({ data: { message: '目录已创建' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建目录失败';
      res.status(500).json({ error: { code: 'server_error', message: msg } });
    }
  });

  // 删除
  router.delete('/:id', async (req, res) => {
    try {
      const relativePath = req.query.path as string;
      if (!relativePath) {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供路径' } });
        return;
      }
      await filesService.deleteEntry(req.params.id as never, relativePath);
      res.json({ data: { message: '已删除' } });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '删除失败' } });
    }
  });

  // 重命名
  router.put('/:id/rename', async (req, res) => {
    try {
      const { path: relativePath, newName } = req.body;
      if (!relativePath || !newName) {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供原路径和新名称' } });
        return;
      }
      await filesService.renameEntry(req.params.id as never, relativePath, newName);
      res.json({ data: { message: '已重命名' } });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '重命名失败' } });
    }
  });

  return router;
}
