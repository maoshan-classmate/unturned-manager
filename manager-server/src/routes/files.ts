import { Router } from 'express';
import fs from 'fs/promises';
import { z } from 'zod';
import type { IFilesService } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import { resolveInstallDir } from '../modules/server/pathResolver.js';

const PathQuerySchema = z.object({ path: z.string().default('') });
const ReadQuerySchema = z.object({ path: z.string().min(1, '文件路径不能为空') });

/** Express 5 的 req.query.path 类型是 `string | ParsedQs | (string|ParsedQs)[] | undefined`——统一拍平为 string */
function readQueryString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return readQueryString(v[0]);
  return '';
}

/** 解析并校验文件路径白名单（与 FilesService 一致：realpath + 白名单前缀） */
async function resolveValidatedPath(serverId: string, relativePath: string): Promise<string> {
  const baseDir = path.resolve(resolveInstallDir(), 'Servers', serverId);
  const absPath = path.resolve(baseDir, relativePath);
  if (!absPath.startsWith(baseDir + path.sep) && absPath !== baseDir) {
    throw new AppError('path_forbidden', '路径越界', 403);
  }
  return absPath;
}

/**
 * 面板级文件浏览路由（sc:design §7.6）——GET /api/files?path=...
 * 不依赖具体实例，浏览 installDir 根目录；路径经 FilesService.validatePanelPath 限定在 installDir 内。
 */
export function createPanelFilesRouter(filesService: IFilesService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    '/',
    validate(PathQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { path: relativePath } = req.query as unknown as { path: string };
      const result = await filesService.listPanelDirectory(relativePath);
      res.json({ data: result });
    }),
  );

  return router;
}

export function createFilesRouter(filesService: IFilesService): Router {
  const router = Router();
  router.use(authenticateToken);

  // 列表（保留原路径）
  router.get(
    '/:id',
    validate(PathQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { path: relativePath } = req.query as unknown as { path: string };
      const entries = await filesService.listDirectory(req.params.id as never, relativePath);
      res.json({ data: entries });
    }),
  );

  // 读取文本文件
  router.get(
    '/:id/content',
    validate(ReadQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { path: relativePath } = req.query as unknown as { path: string };
      const content = await filesService.readFile(req.params.id as never, relativePath);
      const text = new TextDecoder().decode(content);
      res.json({ data: text });
    }),
  );

  // 文本上传（保留 JSON 路径，前端 FilesPage.tsx:184 在用）
  const UploadBodySchema = z.object({
    path: z.string().min(1, '文件路径不能为空'),
    content: z.string(),
  });
  router.post(
    '/:id/upload',
    validate(UploadBodySchema),
    asyncHandler(async (req, res) => {
      const { path: relativePath, content } = req.body as { path: string; content: string };
      const data = new TextEncoder().encode(content);
      await filesService.writeFile(req.params.id as never, relativePath, data);
      res.json({ data: { message: '文件已上传' } });
    }),
  );

  // Phase 0 新增：二进制文件上传（修复 C7）
  router.post(
    '/:id/files/raw',
    asyncHandler(async (req, res) => {
      const serverId = String(req.params.id);
      const relativePath = readQueryString(req.query.path);
      if (!relativePath) {
        throw new AppError('invalid_request', '请提供路径（?path=）', 400);
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError('invalid_request', '请求体为空或非二进制', 400);
      }
      const absPath = await resolveValidatedPath(serverId, relativePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      const tmpPath = absPath + '.tmp.' + Date.now();
      await fs.writeFile(tmpPath, req.body);
      await fs.rename(tmpPath, absPath);
      logger.info({ serverId, relativePath, size: req.body.length }, '二进制文件已上传');
      res.json({ data: { message: '文件已上传', size: req.body.length } });
    }),
  );

  // Phase 0 顺手做：二进制下载 + Range 头（HTTP 标准，无额外状态）
  router.get(
    '/:id/files/raw',
    asyncHandler(async (req, res) => {
      const serverId = String(req.params.id);
      const relativePath = readQueryString(req.query.path);
      if (!relativePath) {
        throw new AppError('invalid_request', '请提供路径（?path=）', 400);
      }
      const absPath = await resolveValidatedPath(serverId, relativePath);
      const stat = await fs.stat(absPath);
      const total = stat.size;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'application/octet-stream');

      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
        if (match) {
          const start = parseInt(match[1]!, 10);
          const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : Math.min(start + 16 * 1024 * 1024, total - 1);
          if (start >= total || end < start) {
            res.status(416).json({ error: { code: 'range_not_satisfiable', message: 'Range 超出文件大小' } });
            return;
          }
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', end - start + 1);
          const fd = await fs.open(absPath);
          try {
            const buf = Buffer.alloc(end - start + 1);
            await fd.read(buf, 0, buf.length, start);
            res.end(buf);
          } finally {
            await fd.close();
          }
          return;
        }
      }

      // 整文件下载
      res.setHeader('Content-Length', total);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(absPath)}"`);
      const buf = await fs.readFile(absPath);
      res.end(buf);
    }),
  );

  // 创建目录
  const MkdirBodySchema = z.object({ path: z.string().min(1) });
  router.post(
    '/:id/mkdir',
    validate(MkdirBodySchema),
    asyncHandler(async (req, res) => {
      const { path: relativePath } = req.body as { path: string };
      await filesService.createDirectory(req.params.id as never, relativePath);
      res.status(201).json({ data: { message: '目录已创建' } });
    }),
  );

  // 删除
  router.delete(
    '/:id',
    validate(PathQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { path: relativePath } = req.query as unknown as { path: string };
      if (!relativePath) {
        throw new AppError('invalid_request', '请提供路径（?path=）', 400);
      }
      await filesService.deleteEntry(req.params.id as never, relativePath);
      res.json({ data: { message: '已删除' } });
    }),
  );

  // 重命名
  const RenameBodySchema = z.object({
    path: z.string().min(1, '原路径不能为空'),
    newName: z.string().min(1, '新名称不能为空'),
  });
  router.put(
    '/:id/rename',
    validate(RenameBodySchema),
    asyncHandler(async (req, res) => {
      const { path: relativePath, newName } = req.body as { path: string; newName: string };
      await filesService.renameEntry(req.params.id as never, relativePath, newName);
      res.json({ data: { message: '已重命名' } });
    }),
  );

  return router;
}
